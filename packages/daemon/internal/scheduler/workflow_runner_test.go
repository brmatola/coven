package scheduler

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/coven/daemon/internal/logging"
	"github.com/coven/daemon/internal/workflow"
	"github.com/coven/daemon/pkg/types"
)

func newTestLogger(t *testing.T) *logging.Logger {
	t.Helper()
	logPath := filepath.Join(t.TempDir(), "test.log")
	logger, err := logging.New(logPath)
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}
	t.Cleanup(func() { logger.Close() })
	return logger
}

func TestNewWorkflowRunner(t *testing.T) {
	logger := newTestLogger(t)
	runner := NewWorkflowRunner("/path/to/.coven", logger)

	if runner == nil {
		t.Fatal("NewWorkflowRunner returned nil")
	}
	if runner.covenDir != "/path/to/.coven" {
		t.Errorf("covenDir = %q, want %q", runner.covenDir, "/path/to/.coven")
	}
	if runner.grimoireMapper == nil {
		t.Error("grimoireMapper should not be nil")
	}
}

func TestStatusForResult(t *testing.T) {
	tests := []struct {
		name     string
		result   *WorkflowResult
		expected types.TaskStatus
	}{
		{
			name:     "nil result",
			result:   nil,
			expected: types.TaskStatusOpen,
		},
		{
			name: "completed workflow",
			result: &WorkflowResult{
				Success: true,
				Status:  workflow.WorkflowCompleted,
			},
			expected: types.TaskStatusClosed,
		},
		{
			name: "pending merge",
			result: &WorkflowResult{
				Success: false,
				Status:  workflow.WorkflowPendingMerge,
			},
			expected: types.TaskStatusPendingMerge,
		},
		{
			name: "blocked workflow",
			result: &WorkflowResult{
				Success: false,
				Status:  workflow.WorkflowBlocked,
			},
			expected: types.TaskStatusBlocked,
		},
		{
			name: "cancelled workflow",
			result: &WorkflowResult{
				Success: false,
				Status:  workflow.WorkflowCancelled,
			},
			expected: types.TaskStatusOpen,
		},
		{
			name: "failed workflow",
			result: &WorkflowResult{
				Success: false,
				Status:  workflow.WorkflowFailed,
			},
			expected: types.TaskStatusBlocked,
		},
		{
			name: "running workflow (default)",
			result: &WorkflowResult{
				Success: false,
				Status:  workflow.WorkflowRunning,
			},
			expected: types.TaskStatusOpen,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := StatusForResult(tt.result)
			if got != tt.expected {
				t.Errorf("StatusForResult() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestShouldRetry(t *testing.T) {
	tests := []struct {
		name       string
		result     *WorkflowResult
		attempt    int
		maxRetries int
		expected   bool
	}{
		{
			name:       "nil result",
			result:     nil,
			attempt:    0,
			maxRetries: 3,
			expected:   false,
		},
		{
			name:       "max retries reached",
			result:     &WorkflowResult{Status: workflow.WorkflowFailed},
			attempt:    3,
			maxRetries: 3,
			expected:   false,
		},
		{
			name:       "cancelled should retry",
			result:     &WorkflowResult{Status: workflow.WorkflowCancelled},
			attempt:    1,
			maxRetries: 3,
			expected:   true,
		},
		{
			name:       "failed should retry",
			result:     &WorkflowResult{Status: workflow.WorkflowFailed},
			attempt:    1,
			maxRetries: 3,
			expected:   true,
		},
		{
			name:       "completed should not retry",
			result:     &WorkflowResult{Status: workflow.WorkflowCompleted},
			attempt:    0,
			maxRetries: 3,
			expected:   false,
		},
		{
			name:       "blocked should not retry",
			result:     &WorkflowResult{Status: workflow.WorkflowBlocked},
			attempt:    0,
			maxRetries: 3,
			expected:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ShouldRetry(tt.result, tt.attempt, tt.maxRetries)
			if got != tt.expected {
				t.Errorf("ShouldRetry() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestWorkflowResult_Fields(t *testing.T) {
	result := &WorkflowResult{
		Success:      true,
		Status:       workflow.WorkflowCompleted,
		GrimoireName: "implement-bead",
		Duration:     5 * time.Second,
		Error:        "",
		StepCount:    3,
		LastStepName: "merge",
	}

	if !result.Success {
		t.Error("Success should be true")
	}
	if result.Status != workflow.WorkflowCompleted {
		t.Errorf("Status = %q, want %q", result.Status, workflow.WorkflowCompleted)
	}
	if result.GrimoireName != "implement-bead" {
		t.Errorf("GrimoireName = %q, want %q", result.GrimoireName, "implement-bead")
	}
	if result.Duration != 5*time.Second {
		t.Errorf("Duration = %v, want %v", result.Duration, 5*time.Second)
	}
	if result.StepCount != 3 {
		t.Errorf("StepCount = %d, want %d", result.StepCount, 3)
	}
	if result.LastStepName != "merge" {
		t.Errorf("LastStepName = %q, want %q", result.LastStepName, "merge")
	}
}

func TestWorkflowConfig_Fields(t *testing.T) {
	config := WorkflowConfig{
		WorktreePath: "/path/to/worktree",
		BeadID:       "coven-abc",
		WorkflowID:   "wf-123",
		AgentRunner:  nil,
	}

	if config.WorktreePath != "/path/to/worktree" {
		t.Errorf("WorktreePath = %q, want %q", config.WorktreePath, "/path/to/worktree")
	}
	if config.BeadID != "coven-abc" {
		t.Errorf("BeadID = %q, want %q", config.BeadID, "coven-abc")
	}
	if config.WorkflowID != "wf-123" {
		t.Errorf("WorkflowID = %q, want %q", config.WorkflowID, "wf-123")
	}
}

func TestWorkflowRunner_Run_GrimoireNotFound(t *testing.T) {
	tmpDir := t.TempDir()
	logger := newTestLogger(t)
	runner := NewWorkflowRunner(tmpDir, logger)

	task := types.Task{
		ID:          "coven-test",
		Title:       "Test Task",
		Description: "Test description",
		Type:        "feature",
		Priority:    1,
		Labels:      []string{"grimoire:nonexistent"},
	}

	config := WorkflowConfig{
		WorktreePath: tmpDir,
		BeadID:       "coven-test",
		WorkflowID:   "wf-test",
	}

	ctx := context.Background()
	result, err := runner.Run(ctx, task, config)

	// Should not return an error, but result should indicate failure
	if err != nil {
		t.Fatalf("Run() error: %v", err)
	}

	if result.Success {
		t.Error("Expected failure when grimoire not found")
	}
	if result.Error == "" {
		t.Error("Expected error message")
	}
}

func TestWorkflowRunner_Run_DefaultGrimoire(t *testing.T) {
	tmpDir := t.TempDir()
	logger := newTestLogger(t)
	runner := NewWorkflowRunner(tmpDir, logger)

	task := types.Task{
		ID:          "coven-test",
		Title:       "Test Task",
		Description: "Test description",
		Type:        "task",
		Priority:    2,
	}

	config := WorkflowConfig{
		WorktreePath: tmpDir,
		BeadID:       "coven-test",
		WorkflowID:   "wf-test",
	}

	ctx := context.Background()
	result, err := runner.Run(ctx, task, config)

	// Should attempt to run default grimoire
	if err != nil {
		t.Fatalf("Run() error: %v", err)
	}

	// Will fail because implement-bead grimoire doesn't exist, but it should attempt it
	if result.GrimoireName != "" && result.Success {
		t.Error("Should not succeed without grimoire files")
	}
}

func TestWorkflowRunner_Run_WithLabels(t *testing.T) {
	tmpDir := t.TempDir()
	logger := newTestLogger(t)
	runner := NewWorkflowRunner(tmpDir, logger)

	task := types.Task{
		ID:          "coven-test",
		Title:       "Test Task",
		Type:        "feature",
		Priority:    1,
		Labels:      []string{"bug", "urgent"},
	}

	config := WorkflowConfig{
		WorktreePath: tmpDir,
		BeadID:       "coven-test",
		WorkflowID:   "wf-test",
	}

	ctx := context.Background()
	result, err := runner.Run(ctx, task, config)

	if err != nil {
		t.Fatalf("Run() error: %v", err)
	}

	// Check result has duration set
	if result.Duration == 0 {
		t.Error("Expected duration to be set")
	}
}
