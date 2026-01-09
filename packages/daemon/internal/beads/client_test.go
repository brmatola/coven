package beads

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/coven/daemon/pkg/types"
)

func TestNewClient(t *testing.T) {
	client := NewClient("/tmp/test")
	if client == nil {
		t.Fatal("NewClient() returned nil")
	}
	if client.workDir != "/tmp/test" {
		t.Errorf("workDir = %q, want %q", client.workDir, "/tmp/test")
	}
}

func TestSetBdPath(t *testing.T) {
	client := NewClient("/tmp")
	client.SetBdPath("/custom/bd")
	if client.bdPath != "/custom/bd" {
		t.Errorf("bdPath = %q, want %q", client.bdPath, "/custom/bd")
	}
}

func TestConvertStatus(t *testing.T) {
	tests := []struct {
		input string
		want  types.TaskStatus
	}{
		{"open", types.TaskStatusOpen},
		{"Open", types.TaskStatusOpen},
		{"OPEN", types.TaskStatusOpen},
		{"in_progress", types.TaskStatusInProgress},
		{"IN_PROGRESS", types.TaskStatusInProgress},
		{"closed", types.TaskStatusClosed},
		{"Closed", types.TaskStatusClosed},
		{"unknown", types.TaskStatusOpen},
		{"", types.TaskStatusOpen},
	}

	for _, tt := range tests {
		got := convertStatus(tt.input)
		if got != tt.want {
			t.Errorf("convertStatus(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestConvertBeadsTask(t *testing.T) {
	bt := BeadsTask{
		ID:          "task-1",
		Title:       "Test Task",
		Description: "A test task",
		Status:      "in_progress",
		Priority:    2,
		IssueType:   "task",
		Labels:      []string{"test", "example"},
	}

	task := convertBeadsTask(bt)

	if task.ID != bt.ID {
		t.Errorf("ID = %q, want %q", task.ID, bt.ID)
	}
	if task.Title != bt.Title {
		t.Errorf("Title = %q, want %q", task.Title, bt.Title)
	}
	if task.Status != types.TaskStatusInProgress {
		t.Errorf("Status = %q, want %q", task.Status, types.TaskStatusInProgress)
	}
	if task.Type != bt.IssueType {
		t.Errorf("Type = %q, want %q", task.Type, bt.IssueType)
	}
}

// Integration tests that require bd to be installed

func TestClientReady(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Check if bd is available
	_, err := os.Stat("/Users/bmatola/repos/coven") // Use actual repo path
	if err != nil {
		t.Skip("Skipping: not in coven repository")
	}

	client := NewClient("/Users/bmatola/repos/coven")
	ctx := context.Background()

	tasks, err := client.Ready(ctx)
	if err != nil {
		t.Fatalf("Ready() error: %v", err)
	}

	// Should have at least some tasks
	if len(tasks) == 0 {
		t.Log("No ready tasks found (this may be expected)")
	}

	// Verify task structure
	for _, task := range tasks {
		if task.ID == "" {
			t.Error("Task ID should not be empty")
		}
		if task.Title == "" {
			t.Error("Task Title should not be empty")
		}
	}
}

func TestClientWithMockBd(t *testing.T) {
	// Create a mock bd script
	tmpDir := t.TempDir()
	mockBd := filepath.Join(tmpDir, "bd")

	// Create mock script that outputs JSON
	script := `#!/bin/bash
if [ "$1" = "ready" ] && [ "$2" = "--json" ]; then
    echo '[{"id":"test-1","title":"Test Task","status":"open","priority":2,"issue_type":"task"}]'
elif [ "$1" = "show" ] && [ "$3" = "--json" ]; then
    echo '{"id":"test-1","title":"Test Task","status":"open","priority":2,"issue_type":"task"}'
elif [ "$1" = "update" ]; then
    exit 0
elif [ "$1" = "close" ]; then
    exit 0
else
    exit 1
fi
`
	if err := os.WriteFile(mockBd, []byte(script), 0755); err != nil {
		t.Fatalf("Failed to create mock bd: %v", err)
	}

	client := NewClient(tmpDir)
	client.SetBdPath(mockBd)
	ctx := context.Background()

	t.Run("Ready", func(t *testing.T) {
		tasks, err := client.Ready(ctx)
		if err != nil {
			t.Fatalf("Ready() error: %v", err)
		}
		if len(tasks) != 1 {
			t.Errorf("Expected 1 task, got %d", len(tasks))
		}
		if tasks[0].ID != "test-1" {
			t.Errorf("Task ID = %q, want %q", tasks[0].ID, "test-1")
		}
	})

	t.Run("Show", func(t *testing.T) {
		task, err := client.Show(ctx, "test-1")
		if err != nil {
			t.Fatalf("Show() error: %v", err)
		}
		if task.ID != "test-1" {
			t.Errorf("Task ID = %q, want %q", task.ID, "test-1")
		}
	})

	t.Run("UpdateStatus", func(t *testing.T) {
		err := client.UpdateStatus(ctx, "test-1", types.TaskStatusInProgress)
		if err != nil {
			t.Errorf("UpdateStatus() error: %v", err)
		}
	})

	t.Run("Close", func(t *testing.T) {
		err := client.Close(ctx, "test-1")
		if err != nil {
			t.Errorf("Close() error: %v", err)
		}
	})
}

func TestClientCommandFailure(t *testing.T) {
	tmpDir := t.TempDir()
	mockBd := filepath.Join(tmpDir, "bd")

	// Create mock script that fails
	script := `#!/bin/bash
echo "error message" >&2
exit 1
`
	if err := os.WriteFile(mockBd, []byte(script), 0755); err != nil {
		t.Fatalf("Failed to create mock bd: %v", err)
	}

	client := NewClient(tmpDir)
	client.SetBdPath(mockBd)
	ctx := context.Background()

	_, err := client.Ready(ctx)
	if err == nil {
		t.Error("Ready() should fail")
	}
}

func TestClientInvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	mockBd := filepath.Join(tmpDir, "bd")

	// Create mock script that outputs invalid JSON
	script := `#!/bin/bash
echo "not valid json"
`
	if err := os.WriteFile(mockBd, []byte(script), 0755); err != nil {
		t.Fatalf("Failed to create mock bd: %v", err)
	}

	client := NewClient(tmpDir)
	client.SetBdPath(mockBd)
	ctx := context.Background()

	_, err := client.Ready(ctx)
	if err == nil {
		t.Error("Ready() should fail for invalid JSON")
	}
}
