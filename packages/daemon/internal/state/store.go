package state

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/coven/daemon/pkg/types"
)

// Store provides thread-safe access to the daemon state with persistence.
type Store struct {
	mu       sync.RWMutex
	state    *types.DaemonState
	filePath string
	dirty    bool
}

// NewStore creates a new state store.
func NewStore(covenDir string) *Store {
	return &Store{
		state:    types.NewDaemonState(),
		filePath: filepath.Join(covenDir, "state.json"),
	}
}

// Load loads state from disk.
func (s *Store) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.filePath)
	if os.IsNotExist(err) {
		// No state file, start fresh
		s.state = types.NewDaemonState()
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to read state file: %w", err)
	}

	state := types.NewDaemonState()
	if err := json.Unmarshal(data, state); err != nil {
		return fmt.Errorf("failed to parse state file: %w", err)
	}

	s.state = state
	s.dirty = false
	return nil
}

// Save persists state to disk.
func (s *Store) Save() error {
	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal state: %w", err)
	}

	// Write to temp file first, then rename for atomic update
	tmpPath := s.filePath + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write state file: %w", err)
	}

	if err := os.Rename(tmpPath, s.filePath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("failed to rename state file: %w", err)
	}

	return nil
}

// GetState returns a copy of the current state.
func (s *Store) GetState() *types.DaemonState {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Deep copy the state
	stateCopy := &types.DaemonState{
		Agents:       make(map[string]*types.Agent, len(s.state.Agents)),
		Tasks:        make([]types.Task, len(s.state.Tasks)),
		LastTaskSync: s.state.LastTaskSync,
	}

	for k, v := range s.state.Agents {
		agentCopy := *v
		stateCopy.Agents[k] = &agentCopy
	}

	copy(stateCopy.Tasks, s.state.Tasks)

	// Derive workflow state from agents
	stateCopy.Workflow = s.deriveWorkflowState()

	return stateCopy
}

// deriveWorkflowState computes the workflow state from agents.
// Called with lock held.
func (s *Store) deriveWorkflowState() *types.WorkflowState {
	var runningAgent *types.Agent
	var mostRecentAgent *types.Agent

	for _, agent := range s.state.Agents {
		// Track running agent
		if agent.Status == types.AgentStatusRunning || agent.Status == types.AgentStatusStarting {
			runningAgent = agent
			break
		}
		// Track most recent agent for ID
		if mostRecentAgent == nil || agent.StartedAt.After(mostRecentAgent.StartedAt) {
			mostRecentAgent = agent
		}
	}

	// If there's a running agent, workflow is running
	if runningAgent != nil {
		return &types.WorkflowState{
			ID:        runningAgent.TaskID,
			Status:    types.WorkflowStatusRunning,
			StartedAt: &runningAgent.StartedAt,
		}
	}

	// No running agent - workflow is idle
	// Use most recent agent ID if available, otherwise empty
	workflowID := ""
	if mostRecentAgent != nil {
		workflowID = mostRecentAgent.TaskID
	}

	return &types.WorkflowState{
		ID:     workflowID,
		Status: types.WorkflowStatusIdle,
	}
}

// Agent operations

// GetAgent returns an agent by task ID.
func (s *Store) GetAgent(taskID string) *types.Agent {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if agent, ok := s.state.Agents[taskID]; ok {
		agentCopy := *agent
		return &agentCopy
	}
	return nil
}

// GetAllAgents returns a copy of all agents.
func (s *Store) GetAllAgents() map[string]*types.Agent {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make(map[string]*types.Agent, len(s.state.Agents))
	for k, v := range s.state.Agents {
		agentCopy := *v
		result[k] = &agentCopy
	}
	return result
}

// AddAgent adds a new agent.
func (s *Store) AddAgent(agent *types.Agent) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.state.Agents[agent.TaskID] = agent
	s.dirty = true
}

// UpdateAgentStatus updates an agent's status.
func (s *Store) UpdateAgentStatus(taskID string, status types.AgentStatus) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if agent, ok := s.state.Agents[taskID]; ok {
		agent.Status = status
		if status == types.AgentStatusCompleted || status == types.AgentStatusFailed || status == types.AgentStatusKilled {
			now := time.Now()
			agent.EndedAt = &now
		}
		s.dirty = true
	}
}

// SetAgentExitCode sets the exit code for an agent.
func (s *Store) SetAgentExitCode(taskID string, exitCode int) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if agent, ok := s.state.Agents[taskID]; ok {
		agent.ExitCode = &exitCode
		s.dirty = true
	}
}

// SetAgentError sets the error message for an agent.
func (s *Store) SetAgentError(taskID string, errMsg string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if agent, ok := s.state.Agents[taskID]; ok {
		agent.Error = errMsg
		s.dirty = true
	}
}

// SetAgentStepTaskID sets the current step's task ID for process tracking.
func (s *Store) SetAgentStepTaskID(taskID, stepTaskID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if agent, ok := s.state.Agents[taskID]; ok {
		agent.StepTaskID = stepTaskID
		s.dirty = true
	}
}

// SetAgentPID sets the PID for an agent.
func (s *Store) SetAgentPID(taskID string, pid int) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if agent, ok := s.state.Agents[taskID]; ok {
		agent.PID = pid
		s.dirty = true
	}
}

// RemoveAgent removes an agent from state.
func (s *Store) RemoveAgent(taskID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.state.Agents, taskID)
	s.dirty = true
}

// Task operations

// GetTasks returns a copy of all tasks.
func (s *Store) GetTasks() []types.Task {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]types.Task, len(s.state.Tasks))
	copy(result, s.state.Tasks)
	return result
}

// SetTasks replaces all tasks.
func (s *Store) SetTasks(tasks []types.Task) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.state.Tasks = tasks
	now := time.Now()
	s.state.LastTaskSync = &now
	s.dirty = true
}

// GetLastTaskSync returns when tasks were last synced.
func (s *Store) GetLastTaskSync() *time.Time {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.state.LastTaskSync
}

// UpdateTaskStatus updates the status of a specific task.
func (s *Store) UpdateTaskStatus(taskID string, status types.TaskStatus) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.state.Tasks {
		if s.state.Tasks[i].ID == taskID {
			s.state.Tasks[i].Status = status
			s.state.Tasks[i].UpdatedAt = time.Now()
			s.dirty = true
			return
		}
	}
}

// IsDirty returns whether state has unsaved changes.
func (s *Store) IsDirty() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.dirty
}

// ClearDirty clears the dirty flag.
func (s *Store) ClearDirty() {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.dirty = false
}

// Clear resets the state to initial values.
func (s *Store) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.state = types.NewDaemonState()
	s.dirty = true
}

// FilePath returns the state file path.
func (s *Store) FilePath() string {
	return s.filePath
}
