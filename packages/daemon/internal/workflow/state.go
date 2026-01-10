package workflow

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// WorkflowState represents the persisted state of a workflow execution.
type WorkflowState struct {
	// TaskID is the bead/task ID this workflow is for.
	TaskID string `json:"task_id"`

	// WorkflowID is the unique identifier for this workflow run.
	WorkflowID string `json:"workflow_id"`

	// GrimoireName is the name of the grimoire being executed.
	GrimoireName string `json:"grimoire_name"`

	// WorktreePath is the path to the git worktree.
	WorktreePath string `json:"worktree_path"`

	// Status is the current workflow status.
	Status WorkflowStatus `json:"status"`

	// CurrentStep is the index of the current/next step to execute.
	CurrentStep int `json:"current_step"`

	// CompletedSteps tracks which steps have completed successfully.
	CompletedSteps map[string]*StepResult `json:"completed_steps"`

	// StepOutputs stores output variables from completed steps.
	StepOutputs map[string]string `json:"step_outputs"`

	// StartedAt is when the workflow started.
	StartedAt time.Time `json:"started_at"`

	// UpdatedAt is when the state was last updated.
	UpdatedAt time.Time `json:"updated_at"`

	// Error contains any error message if the workflow failed.
	Error string `json:"error,omitempty"`
}

// StatePersister handles saving and loading workflow state.
type StatePersister struct {
	stateDir string
}

// NewStatePersister creates a new state persister.
func NewStatePersister(covenDir string) *StatePersister {
	return &StatePersister{
		stateDir: filepath.Join(covenDir, "workflows"),
	}
}

// StateDir returns the directory where workflow states are stored.
func (p *StatePersister) StateDir() string {
	return p.stateDir
}

// Save persists workflow state to disk.
func (p *StatePersister) Save(state *WorkflowState) error {
	// Ensure directory exists
	if err := os.MkdirAll(p.stateDir, 0755); err != nil {
		return fmt.Errorf("failed to create workflow state dir: %w", err)
	}

	state.UpdatedAt = time.Now()

	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal workflow state: %w", err)
	}

	statePath := p.statePath(state.TaskID)

	// Write atomically
	tmpPath := statePath + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write workflow state: %w", err)
	}

	if err := os.Rename(tmpPath, statePath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("failed to rename workflow state: %w", err)
	}

	return nil
}

// Load loads workflow state from disk.
func (p *StatePersister) Load(taskID string) (*WorkflowState, error) {
	statePath := p.statePath(taskID)

	data, err := os.ReadFile(statePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil // No state file
		}
		return nil, fmt.Errorf("failed to read workflow state: %w", err)
	}

	var state WorkflowState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("failed to parse workflow state: %w", err)
	}

	return &state, nil
}

// Delete removes workflow state from disk.
func (p *StatePersister) Delete(taskID string) error {
	statePath := p.statePath(taskID)
	if err := os.Remove(statePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete workflow state: %w", err)
	}
	return nil
}

// ListInterrupted returns all workflow states that were interrupted (running status).
func (p *StatePersister) ListInterrupted() ([]*WorkflowState, error) {
	entries, err := os.ReadDir(p.stateDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to read workflow state dir: %w", err)
	}

	var interrupted []*WorkflowState
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		taskID := entry.Name()[:len(entry.Name())-5] // Remove .json extension
		state, err := p.Load(taskID)
		if err != nil {
			continue // Skip invalid state files
		}

		// Check if workflow was interrupted (running or in_progress status)
		if state != nil && (state.Status == WorkflowRunning || state.Status == "") {
			interrupted = append(interrupted, state)
		}
	}

	return interrupted, nil
}

// statePath returns the path to the state file for a task.
func (p *StatePersister) statePath(taskID string) string {
	return filepath.Join(p.stateDir, taskID+".json")
}

// Exists checks if state exists for a task.
func (p *StatePersister) Exists(taskID string) bool {
	_, err := os.Stat(p.statePath(taskID))
	return err == nil
}
