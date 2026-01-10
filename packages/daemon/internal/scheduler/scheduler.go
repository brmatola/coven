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
	"github.com/coven/daemon/internal/workflow"
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
	workflowRunner    *WorkflowRunner
	agentRunner       *ProcessAgentRunner
	logger            *logging.Logger
	covenDir          string
	reconcileInterval time.Duration
	maxAgents         int
	running           bool
	stopCh            chan struct{}
	doneCh            chan struct{}
	agentCommand      string
	agentArgs         []string
	pendingResumes    map[string]*workflow.WorkflowState
}

// NewScheduler creates a new scheduler.
func NewScheduler(
	store *state.Store,
	beadsClient *beads.Client,
	processManager *agent.ProcessManager,
	worktreeManager *git.WorktreeManager,
	logger *logging.Logger,
	covenDir string,
) *Scheduler {
	// Default agent command
	agentCommand := "claude"
	agentArgs := []string{"-p"}

	// Create the agent runner adapter
	agentRunner := NewProcessAgentRunner(processManager, agentCommand, agentArgs)

	// Create the workflow runner
	workflowRunner := NewWorkflowRunner(covenDir, logger)

	return &Scheduler{
		store:             store,
		beadsClient:       beadsClient,
		processManager:    processManager,
		worktreeManager:   worktreeManager,
		workflowRunner:    workflowRunner,
		agentRunner:       agentRunner,
		logger:            logger,
		covenDir:          covenDir,
		reconcileInterval: DefaultReconcileInterval,
		maxAgents:         DefaultMaxAgents,
		agentCommand:      agentCommand,
		agentArgs:         agentArgs,
		pendingResumes:    make(map[string]*workflow.WorkflowState),
	}
}

// SetEventEmitter sets the event emitter for workflow events.
// This should be called before Start() to ensure events are emitted.
func (s *Scheduler) SetEventEmitter(emitter workflow.EventEmitter) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.workflowRunner != nil {
		s.workflowRunner.SetEventEmitter(emitter)
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
	// Update the agent runner as well
	s.agentRunner.SetCommand(cmd, args)
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

	// Check for and resume interrupted workflows
	s.resumeInterruptedWorkflows()

	go s.reconcileLoop()
	s.logger.Info("scheduler started", "max_agents", s.maxAgents)
}

// resumeInterruptedWorkflows checks for workflows that were interrupted and resumes them.
func (s *Scheduler) resumeInterruptedWorkflows() {
	statePersister := workflow.NewStatePersister(s.covenDir)
	interrupted, err := statePersister.ListInterrupted()
	if err != nil {
		s.logger.Error("failed to list interrupted workflows", "error", err)
		return
	}

	if len(interrupted) == 0 {
		return
	}

	s.logger.Info("found interrupted workflows", "count", len(interrupted))

	for _, state := range interrupted {
		s.logger.Info("scheduling workflow resume",
			"task_id", state.TaskID,
			"grimoire", state.GrimoireName,
			"step", state.CurrentStep,
		)

		// Find the task in the store
		tasks := s.store.GetTasks()
		var task *types.Task
		for _, t := range tasks {
			if t.ID == state.TaskID {
				task = &t
				break
			}
		}

		if task == nil {
			// Save as pending - will retry when tasks sync
			s.mu.Lock()
			s.pendingResumes[state.TaskID] = state
			s.mu.Unlock()
			s.logger.Info("interrupted workflow task not found, saved as pending",
				"task_id", state.TaskID,
			)
			continue
		}

		// Resume the workflow in background
		go s.resumeWorkflow(context.Background(), *task, state)
	}
}

// checkPendingResumes checks if any pending resumes can now proceed.
func (s *Scheduler) checkPendingResumes() {
	s.mu.RLock()
	if len(s.pendingResumes) == 0 {
		s.mu.RUnlock()
		return
	}

	// Copy pending to avoid holding lock during resume
	pending := make(map[string]*workflow.WorkflowState)
	for k, v := range s.pendingResumes {
		pending[k] = v
	}
	s.mu.RUnlock()

	tasks := s.store.GetTasks()
	taskMap := make(map[string]types.Task)
	for _, t := range tasks {
		taskMap[t.ID] = t
	}

	for taskID, state := range pending {
		task, found := taskMap[taskID]
		if !found {
			continue
		}

		// Remove from pending
		s.mu.Lock()
		delete(s.pendingResumes, taskID)
		s.mu.Unlock()

		s.logger.Info("resuming pending workflow",
			"task_id", taskID,
			"grimoire", state.GrimoireName,
		)

		// Resume the workflow in background
		go s.resumeWorkflow(context.Background(), task, state)
	}
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

	reconcileTicker := time.NewTicker(s.reconcileInterval)
	defer reconcileTicker.Stop()

	// Cleanup runs less frequently - once per hour
	cleanupTicker := time.NewTicker(1 * time.Hour)
	defer cleanupTicker.Stop()

	for {
		select {
		case <-s.stopCh:
			return
		case <-reconcileTicker.C:
			if err := s.Reconcile(ctx); err != nil {
				s.logger.Error("reconcile failed", "error", err)
			}
		case <-cleanupTicker.C:
			s.cleanupOldFiles()
		}
	}
}

// Reconcile performs a single reconciliation cycle.
func (s *Scheduler) Reconcile(ctx context.Context) error {
	// Check for pending workflow resumes
	s.checkPendingResumes()

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
	s.logger.Info("starting workflow for task", "task_id", task.ID, "title", task.Title)

	// Create worktree for the task
	wtInfo, err := s.worktreeManager.Create(ctx, task.ID)
	if err != nil {
		return fmt.Errorf("failed to create worktree: %w", err)
	}

	// Update task status to in_progress (local store for immediate visibility)
	s.store.UpdateTaskStatus(task.ID, types.TaskStatusInProgress)

	// Update task status in beads (persistent storage)
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

	// Update agent state to running
	s.store.UpdateAgentStatus(task.ID, types.AgentStatusRunning)

	// Run workflow in a goroutine
	go s.runWorkflow(ctx, task, wtInfo.Path)

	s.logger.Info("workflow started",
		"task_id", task.ID,
		"worktree", wtInfo.Path,
	)

	return nil
}

// runWorkflow executes the workflow for a task.
func (s *Scheduler) runWorkflow(ctx context.Context, task types.Task, worktreePath string) {
	taskID := task.ID

	// Set up the agent runner for this workflow
	s.agentRunner.SetTaskID(taskID)

	// Create workflow ID
	workflowID := fmt.Sprintf("wf-%s-%d", taskID, time.Now().UnixNano())

	// Run the workflow
	config := WorkflowConfig{
		WorktreePath: worktreePath,
		BeadID:       taskID,
		WorkflowID:   workflowID,
		AgentRunner:  s.agentRunner,
	}

	result, err := s.workflowRunner.Run(ctx, task, config)

	// Handle errors from workflow runner itself
	if err != nil {
		s.logger.Error("workflow runner error",
			"task_id", taskID,
			"error", err,
		)
		s.store.UpdateAgentStatus(taskID, types.AgentStatusFailed)
		s.store.SetAgentError(taskID, err.Error())
		s.beadsClient.UpdateStatus(ctx, taskID, types.TaskStatusBlocked)
		return
	}

	// Log workflow completion
	s.logger.Info("workflow completed",
		"task_id", taskID,
		"grimoire", result.GrimoireName,
		"status", result.Status,
		"duration", result.Duration,
		"steps", result.StepCount,
	)

	// Update agent status based on workflow result
	if result.Success {
		s.store.UpdateAgentStatus(taskID, types.AgentStatusCompleted)
	} else {
		s.store.UpdateAgentStatus(taskID, types.AgentStatusFailed)
		if result.Error != "" {
			s.logger.Error("workflow failed",
				"task_id", taskID,
				"error", result.Error,
			)
			s.store.SetAgentError(taskID, result.Error)
		}
	}

	// Convert workflow status to task status
	newStatus := StatusForResult(result)

	s.logger.Info("updating task status",
		"task_id", taskID,
		"new_status", newStatus,
	)

	// Update task status in local store (for immediate API visibility)
	s.store.UpdateTaskStatus(taskID, newStatus)

	// Update task status in beads (persistent storage)
	if updateErr := s.beadsClient.UpdateStatus(ctx, taskID, newStatus); updateErr != nil {
		s.logger.Error("failed to update task status in beads",
			"task_id", taskID,
			"status", newStatus,
			"error", updateErr,
		)
	} else {
		s.logger.Info("task status updated successfully",
			"task_id", taskID,
			"status", newStatus,
		)
	}
}

// resumeWorkflow resumes an interrupted workflow from saved state.
func (s *Scheduler) resumeWorkflow(ctx context.Context, task types.Task, state *workflow.WorkflowState) {
	taskID := task.ID

	s.logger.Info("resuming workflow",
		"task_id", taskID,
		"grimoire", state.GrimoireName,
		"from_step", state.CurrentStep+1,
		"worktree", state.WorktreePath,
	)

	// Update task status to in_progress
	s.store.UpdateTaskStatus(taskID, types.TaskStatusInProgress)
	s.beadsClient.UpdateStatus(ctx, taskID, types.TaskStatusInProgress)

	// Create agent record in state
	agentState := &types.Agent{
		TaskID:    taskID,
		Worktree:  state.WorktreePath,
		Status:    types.AgentStatusRunning,
		StartedAt: time.Now(),
	}
	s.store.AddAgent(agentState)

	// Set up the agent runner for this workflow
	s.agentRunner.SetTaskID(taskID)

	// Run the resumed workflow
	config := WorkflowConfig{
		WorktreePath: state.WorktreePath,
		BeadID:       taskID,
		WorkflowID:   state.WorkflowID,
		AgentRunner:  s.agentRunner,
		ResumeState:  state, // Pass the state for resumption
	}

	result, err := s.workflowRunner.RunFromState(ctx, task, config, state)

	// Handle errors from workflow runner itself
	if err != nil {
		s.logger.Error("resumed workflow error",
			"task_id", taskID,
			"error", err,
		)
		s.store.UpdateAgentStatus(taskID, types.AgentStatusFailed)
		s.store.SetAgentError(taskID, err.Error())
		s.beadsClient.UpdateStatus(ctx, taskID, types.TaskStatusBlocked)
		return
	}

	// Log workflow completion
	s.logger.Info("resumed workflow completed",
		"task_id", taskID,
		"grimoire", result.GrimoireName,
		"status", result.Status,
		"duration", result.Duration,
		"steps", result.StepCount,
	)

	// Update agent status based on workflow result
	if result.Success {
		s.store.UpdateAgentStatus(taskID, types.AgentStatusCompleted)
	} else {
		s.store.UpdateAgentStatus(taskID, types.AgentStatusFailed)
		if result.Error != "" {
			s.logger.Error("resumed workflow failed",
				"task_id", taskID,
				"error", result.Error,
			)
			s.store.SetAgentError(taskID, result.Error)
		}
	}

	// Convert workflow status to task status
	newStatus := StatusForResult(result)

	s.logger.Info("updating task status after resume",
		"task_id", taskID,
		"new_status", newStatus,
	)

	// Update task status
	s.store.UpdateTaskStatus(taskID, newStatus)
	if updateErr := s.beadsClient.UpdateStatus(ctx, taskID, newStatus); updateErr != nil {
		s.logger.Error("failed to update task status in beads",
			"task_id", taskID,
			"status", newStatus,
			"error", updateErr,
		)
	}
}

// statusForWorkflowResult is a local copy of StatusForResult for inline access.
// Note: beads doesn't support "pending_merge", so we map it to "blocked".
func statusForWorkflowResult(result *WorkflowResult) types.TaskStatus {
	if result == nil {
		return types.TaskStatusOpen
	}

	switch result.Status {
	case workflow.WorkflowCompleted:
		return types.TaskStatusClosed
	case workflow.WorkflowPendingMerge:
		// Map pending_merge to blocked for beads compatibility
		return types.TaskStatusBlocked
	case workflow.WorkflowBlocked:
		return types.TaskStatusBlocked
	case workflow.WorkflowCancelled:
		return types.TaskStatusOpen
	case workflow.WorkflowFailed:
		return types.TaskStatusBlocked
	default:
		return types.TaskStatusOpen
	}
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

// MergeApproval represents a pending or completed merge approval.
type MergeApproval struct {
	TaskID   string
	Approved bool
	Reason   string
	Ch       chan struct{}
}

// QueueWorkflowResume queues a blocked or failed workflow for resumption.
func (s *Scheduler) QueueWorkflowResume(state *workflow.WorkflowState) error {
	// Find the task
	tasks := s.store.GetTasks()
	var task *types.Task
	for _, t := range tasks {
		if t.ID == state.TaskID {
			task = &t
			break
		}
	}

	if task == nil {
		return fmt.Errorf("task %s not found", state.TaskID)
	}

	// Update state to running for resume
	statePersister := workflow.NewStatePersister(s.covenDir)
	state.Status = workflow.WorkflowRunning
	if err := statePersister.Save(state); err != nil {
		return fmt.Errorf("failed to update workflow state: %w", err)
	}

	// Resume the workflow in background
	go s.resumeWorkflow(context.Background(), *task, state)

	return nil
}

// ApproveMerge approves a pending merge for a workflow.
// Returns a MergeResult indicating success or conflicts.
// On success, the worktree branch is merged to main and cleaned up.
// On conflicts, returns the conflicting files so the user can resolve them.
func (s *Scheduler) ApproveMerge(taskID string) (*workflow.MergeResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Load the workflow state
	statePersister := workflow.NewStatePersister(s.covenDir)
	state, err := statePersister.Load(taskID)
	if err != nil {
		return nil, fmt.Errorf("failed to load workflow state: %w", err)
	}
	if state == nil {
		return nil, fmt.Errorf("workflow state not found for task %s", taskID)
	}

	if state.Status != workflow.WorkflowPendingMerge {
		return nil, fmt.Errorf("workflow is not pending merge (status: %s)", state.Status)
	}

	mergeRunner := &workflow.DefaultMergeRunner{}
	ctx := context.Background()

	// Step 1: Commit any uncommitted changes in the worktree
	if err := mergeRunner.CommitWorktree(ctx, state.WorktreePath); err != nil {
		return nil, fmt.Errorf("failed to commit worktree: %w", err)
	}

	// Step 2: Get worktree info for branch name
	wtInfo, err := s.worktreeManager.Get(taskID)
	if err != nil {
		return nil, fmt.Errorf("failed to get worktree info: %w", err)
	}

	// Step 3: Get the base branch (main/master)
	baseBranch, err := s.worktreeManager.GetBaseBranch(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get base branch: %w", err)
	}

	// Step 4: Merge the worktree branch to main
	mainRepoDir := s.worktreeManager.RepoPath()
	mergeResult, err := mergeRunner.MergeToMain(ctx, mainRepoDir, wtInfo.Branch, baseBranch)
	if err != nil {
		return nil, fmt.Errorf("merge failed: %w", err)
	}

	// If there are conflicts, return them to the user
	if mergeResult.HasConflicts {
		s.logger.Info("merge has conflicts",
			"task_id", taskID,
			"conflict_files", mergeResult.ConflictFiles,
		)
		return mergeResult, nil
	}

	// Step 5: Cleanup - remove worktree and branch
	if err := s.worktreeManager.Remove(ctx, taskID); err != nil {
		s.logger.Warn("failed to remove worktree", "task_id", taskID, "error", err)
	}
	if err := s.worktreeManager.DeleteBranch(ctx, wtInfo.Branch); err != nil {
		s.logger.Warn("failed to delete branch", "branch", wtInfo.Branch, "error", err)
	}

	// Step 6: Update state to running and increment step
	state.Status = workflow.WorkflowRunning
	state.CurrentStep++ // Move past the merge step
	if err := statePersister.Save(state); err != nil {
		return nil, fmt.Errorf("failed to save workflow state: %w", err)
	}

	// Find the task and resume the workflow
	tasks := s.store.GetTasks()
	var task *types.Task
	for _, t := range tasks {
		if t.ID == taskID {
			task = &t
			break
		}
	}

	if task == nil {
		return nil, fmt.Errorf("task %s not found", taskID)
	}

	// Resume the workflow in background (from after the merge step)
	go s.resumeWorkflow(context.Background(), *task, state)

	s.logger.Info("merge approved, workflow resuming",
		"task_id", taskID,
		"next_step", state.CurrentStep,
		"merge_commit", mergeResult.MergeCommit,
	)

	return mergeResult, nil
}

// RejectMerge rejects a pending merge and blocks the workflow.
func (s *Scheduler) RejectMerge(taskID string, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Load the workflow state
	statePersister := workflow.NewStatePersister(s.covenDir)
	state, err := statePersister.Load(taskID)
	if err != nil {
		return fmt.Errorf("failed to load workflow state: %w", err)
	}
	if state == nil {
		return fmt.Errorf("workflow state not found for task %s", taskID)
	}

	if state.Status != workflow.WorkflowPendingMerge {
		return fmt.Errorf("workflow is not pending merge (status: %s)", state.Status)
	}

	// Update state to blocked
	state.Status = workflow.WorkflowBlocked
	state.Error = reason
	if err := statePersister.Save(state); err != nil {
		return fmt.Errorf("failed to save workflow state: %w", err)
	}

	// Update task status to blocked
	s.store.UpdateTaskStatus(taskID, types.TaskStatusBlocked)
	ctx := context.Background()
	if err := s.beadsClient.UpdateStatus(ctx, taskID, types.TaskStatusBlocked); err != nil {
		s.logger.Error("failed to update task status in beads",
			"task_id", taskID,
			"error", err,
		)
	}

	s.logger.Info("merge rejected, workflow blocked",
		"task_id", taskID,
		"reason", reason,
	)

	return nil
}
