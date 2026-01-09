// Package scheduler handles task scheduling and agent orchestration.
package scheduler

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/coven/daemon/internal/agent"
	"github.com/coven/daemon/internal/beads"
	"github.com/coven/daemon/internal/git"
	"github.com/coven/daemon/internal/logging"
	"github.com/coven/daemon/internal/state"
	"github.com/coven/daemon/pkg/types"
)

const (
	// DefaultReconcileInterval is the default interval for reconciliation.
	DefaultReconcileInterval = 5 * time.Second

	// DefaultMaxAgents is the default maximum concurrent agents.
	DefaultMaxAgents = 3
)

// Scheduler manages task scheduling and agent orchestration.
type Scheduler struct {
	mu                sync.RWMutex
	store             *state.Store
	beadsClient       *beads.Client
	processManager    *agent.ProcessManager
	worktreeManager   *git.WorktreeManager
	logger            *logging.Logger
	reconcileInterval time.Duration
	maxAgents         int
	running           bool
	stopCh            chan struct{}
	doneCh            chan struct{}
	agentCommand      string
	agentArgs         []string
}

// NewScheduler creates a new scheduler.
func NewScheduler(
	store *state.Store,
	beadsClient *beads.Client,
	processManager *agent.ProcessManager,
	worktreeManager *git.WorktreeManager,
	logger *logging.Logger,
) *Scheduler {
	return &Scheduler{
		store:             store,
		beadsClient:       beadsClient,
		processManager:    processManager,
		worktreeManager:   worktreeManager,
		logger:            logger,
		reconcileInterval: DefaultReconcileInterval,
		maxAgents:         DefaultMaxAgents,
		agentCommand:      "claude",
		agentArgs:         []string{"-p"},
	}
}

// SetReconcileInterval sets the reconciliation interval.
func (s *Scheduler) SetReconcileInterval(d time.Duration) {
	s.mu.Lock()
	s.reconcileInterval = d
	s.mu.Unlock()
}

// SetMaxAgents sets the maximum concurrent agents.
func (s *Scheduler) SetMaxAgents(max int) {
	s.mu.Lock()
	s.maxAgents = max
	s.mu.Unlock()
}

// SetAgentCommand sets the command to run for agents.
func (s *Scheduler) SetAgentCommand(cmd string, args []string) {
	s.mu.Lock()
	s.agentCommand = cmd
	s.agentArgs = args
	s.mu.Unlock()
}

// Start starts the scheduler.
func (s *Scheduler) Start() {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	s.running = true
	s.stopCh = make(chan struct{})
	s.doneCh = make(chan struct{})
	s.mu.Unlock()

	// Set up process completion callback
	s.processManager.OnComplete(s.handleAgentComplete)

	go s.reconcileLoop()
	s.logger.Info("scheduler started", "max_agents", s.maxAgents)
}

// Stop stops the scheduler.
func (s *Scheduler) Stop() {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return
	}
	s.running = false
	close(s.stopCh)
	s.mu.Unlock()

	<-s.doneCh
	s.logger.Info("scheduler stopped")
}

// IsRunning checks if the scheduler is running.
func (s *Scheduler) IsRunning() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.running
}

func (s *Scheduler) reconcileLoop() {
	defer close(s.doneCh)

	// Do initial reconcile immediately
	ctx := context.Background()
	if err := s.Reconcile(ctx); err != nil {
		s.logger.Error("initial reconcile failed", "error", err)
	}

	ticker := time.NewTicker(s.reconcileInterval)
	defer ticker.Stop()

	for {
		select {
		case <-s.stopCh:
			return
		case <-ticker.C:
			if err := s.Reconcile(ctx); err != nil {
				s.logger.Error("reconcile failed", "error", err)
			}
		}
	}
}

// Reconcile performs a single reconciliation cycle.
func (s *Scheduler) Reconcile(ctx context.Context) error {
	s.mu.RLock()
	maxAgents := s.maxAgents
	s.mu.RUnlock()

	// Get running agents
	runningAgents := s.processManager.ListRunning()
	runningCount := len(runningAgents)

	s.logger.Debug("reconcile started",
		"running_agents", runningCount,
		"max_agents", maxAgents,
	)

	// If at capacity, nothing to do
	if runningCount >= maxAgents {
		return nil
	}

	// Get available slots
	availableSlots := maxAgents - runningCount

	// Get ready tasks from cache
	readyTasks := s.getReadyTasks()
	if len(readyTasks) == 0 {
		return nil
	}

	// Filter out tasks that already have running agents
	runningSet := make(map[string]bool)
	for _, taskID := range runningAgents {
		runningSet[taskID] = true
	}

	var tasksToStart []types.Task
	for _, task := range readyTasks {
		if !runningSet[task.ID] && len(tasksToStart) < availableSlots {
			tasksToStart = append(tasksToStart, task)
		}
	}

	// Start agents for ready tasks
	for _, task := range tasksToStart {
		if err := s.startAgent(ctx, task); err != nil {
			s.logger.Error("failed to start agent",
				"task_id", task.ID,
				"error", err,
			)
			continue
		}
	}

	return nil
}

func (s *Scheduler) getReadyTasks() []types.Task {
	tasks := s.store.GetTasks()

	var ready []types.Task
	for _, task := range tasks {
		if task.Status == types.TaskStatusOpen {
			ready = append(ready, task)
		}
	}

	return ready
}

func (s *Scheduler) startAgent(ctx context.Context, task types.Task) error {
	s.logger.Info("starting agent for task", "task_id", task.ID, "title", task.Title)

	// Create worktree for the task
	wtInfo, err := s.worktreeManager.Create(ctx, task.ID)
	if err != nil {
		return fmt.Errorf("failed to create worktree: %w", err)
	}

	// Update task status to in_progress
	if err := s.beadsClient.UpdateStatus(ctx, task.ID, types.TaskStatusInProgress); err != nil {
		// Clean up worktree on failure
		s.worktreeManager.Remove(ctx, task.ID)
		return fmt.Errorf("failed to update task status: %w", err)
	}

	// Create agent record in state
	agentState := &types.Agent{
		TaskID:    task.ID,
		Worktree:  wtInfo.Path,
		Branch:    wtInfo.Branch,
		Status:    types.AgentStatusStarting,
		StartedAt: time.Now(),
	}
	s.store.AddAgent(agentState)

	// Build the prompt from task
	prompt := buildPromptFromTask(task)

	// Get command configuration
	s.mu.RLock()
	agentCmd := s.agentCommand
	agentArgs := append([]string{}, s.agentArgs...)
	s.mu.RUnlock()

	// Add prompt to args
	agentArgs = append(agentArgs, prompt)

	// Spawn the agent process
	info, err := s.processManager.Spawn(ctx, agent.SpawnConfig{
		TaskID:     task.ID,
		Command:    agentCmd,
		Args:       agentArgs,
		WorkingDir: wtInfo.Path,
	})
	if err != nil {
		// Update state on failure
		s.store.UpdateAgentStatus(task.ID, types.AgentStatusFailed)
		s.store.SetAgentError(task.ID, err.Error())
		return fmt.Errorf("failed to spawn agent: %w", err)
	}

	// Update agent state with PID
	s.store.UpdateAgentStatus(task.ID, types.AgentStatusRunning)
	// Update PID directly via agent access
	if agent := s.store.GetAgent(task.ID); agent != nil {
		agent.PID = info.PID
		s.store.AddAgent(agent)
	}

	s.logger.Info("agent started",
		"task_id", task.ID,
		"pid", info.PID,
		"worktree", wtInfo.Path,
	)

	return nil
}

func (s *Scheduler) handleAgentComplete(result *agent.ProcessResult) {
	s.logger.Info("agent completed",
		"task_id", result.TaskID,
		"exit_code", result.ExitCode,
		"duration", result.Duration,
	)

	// Get current agent state
	agentState := s.store.GetAgent(result.TaskID)
	if agentState == nil {
		s.logger.Warn("agent state not found", "task_id", result.TaskID)
		return
	}

	// Update agent status
	s.store.UpdateAgentStatus(result.TaskID, result.ToAgentStatus())
	s.store.SetAgentExitCode(result.TaskID, result.ExitCode)
	if result.Error != "" {
		s.store.SetAgentError(result.TaskID, result.Error)
	}

	// Update task status based on result
	ctx := context.Background()
	var newStatus types.TaskStatus
	if result.ExitCode == 0 {
		newStatus = types.TaskStatusClosed
	} else if result.Killed {
		newStatus = types.TaskStatusOpen // Return to open if killed
	} else {
		newStatus = types.TaskStatusOpen // Return to open on failure for retry
	}

	if err := s.beadsClient.UpdateStatus(ctx, result.TaskID, newStatus); err != nil {
		s.logger.Error("failed to update task status",
			"task_id", result.TaskID,
			"status", newStatus,
			"error", err,
		)
	}
}

// StopAgent stops a specific agent.
func (s *Scheduler) StopAgent(taskID string) error {
	return s.processManager.Stop(taskID)
}

// KillAgent forcefully kills a specific agent.
func (s *Scheduler) KillAgent(taskID string) error {
	return s.processManager.Kill(taskID)
}

// GetRunningAgents returns the list of running agent task IDs.
func (s *Scheduler) GetRunningAgents() []string {
	return s.processManager.ListRunning()
}

// StartAgentForTask manually starts an agent for a specific task.
// This bypasses the normal scheduler reconciliation.
func (s *Scheduler) StartAgentForTask(ctx context.Context, task types.Task) error {
	return s.startAgent(ctx, task)
}

// IsAgentRunning checks if an agent is running for the given task.
func (s *Scheduler) IsAgentRunning(taskID string) bool {
	return s.processManager.IsRunning(taskID)
}

// buildPromptFromTask creates a prompt string from a task.
func buildPromptFromTask(task types.Task) string {
	prompt := task.Title
	if task.Description != "" {
		prompt += "\n\n" + task.Description
	}
	return prompt
}
