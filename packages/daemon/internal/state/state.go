package state

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// AgentState represents the state of a running agent.
type AgentState struct {
	TaskID    string    `json:"task_id"`
	PID       int       `json:"pid"`
	Worktree  string    `json:"worktree"`
	StartedAt time.Time `json:"started_at"`
	Status    string    `json:"status"` // running, completed, failed
}

// State represents the daemon's persistent state.
type State struct {
	mu sync.RWMutex

	// Agents tracks all running agents.
	Agents map[string]*AgentState `json:"agents"`

	// SessionStarted is when the current session started.
	SessionStarted time.Time `json:"session_started"`

	// Version is the daemon version.
	Version string `json:"version"`

	filePath string
}

// New creates a new state manager.
func New(covenDir string) *State {
	return &State{
		Agents:   make(map[string]*AgentState),
		filePath: filepath.Join(covenDir, "state.json"),
	}
}

// Load loads state from disk.
func (s *State) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.filePath)
	if os.IsNotExist(err) {
		// No state file, start fresh
		s.Agents = make(map[string]*AgentState)
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to read state file: %w", err)
	}

	if err := json.Unmarshal(data, s); err != nil {
		return fmt.Errorf("failed to parse state file: %w", err)
	}

	return nil
}

// Save persists state to disk.
func (s *State) Save() error {
	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := json.MarshalIndent(s, "", "  ")
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

// SetSessionStarted sets the session start time.
func (s *State) SetSessionStarted(t time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.SessionStarted = t
}

// SetVersion sets the daemon version.
func (s *State) SetVersion(v string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Version = v
}

// AddAgent adds an agent to the state.
func (s *State) AddAgent(taskID string, agent *AgentState) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Agents[taskID] = agent
}

// RemoveAgent removes an agent from the state.
func (s *State) RemoveAgent(taskID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.Agents, taskID)
}

// GetAgent returns an agent by task ID.
func (s *State) GetAgent(taskID string) *AgentState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.Agents[taskID]
}

// GetAllAgents returns a copy of all agents.
func (s *State) GetAllAgents() map[string]*AgentState {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make(map[string]*AgentState, len(s.Agents))
	for k, v := range s.Agents {
		agentCopy := *v
		result[k] = &agentCopy
	}
	return result
}

// UpdateAgentStatus updates an agent's status.
func (s *State) UpdateAgentStatus(taskID, status string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if agent, ok := s.Agents[taskID]; ok {
		agent.Status = status
	}
}

// Clear clears all state.
func (s *State) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Agents = make(map[string]*AgentState)
	s.SessionStarted = time.Time{}
}

// FilePath returns the state file path.
func (s *State) FilePath() string {
	return s.filePath
}
