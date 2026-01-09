package beads

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/coven/daemon/internal/api"
	"github.com/coven/daemon/internal/logging"
	"github.com/coven/daemon/internal/state"
	"github.com/coven/daemon/pkg/types"
)

func createMockBd(t *testing.T, tmpDir string, output string) string {
	t.Helper()
	mockBd := filepath.Join(tmpDir, "bd")
	script := `#!/bin/bash
if [ "$1" = "ready" ] && [ "$2" = "--json" ]; then
    echo '` + output + `'
fi
`
	if err := os.WriteFile(mockBd, []byte(script), 0755); err != nil {
		t.Fatalf("Failed to create mock bd: %v", err)
	}
	return mockBd
}

func newTestPoller(t *testing.T, mockOutput string) (*Poller, *state.Store, *api.EventBroker) {
	t.Helper()

	tmpDir := t.TempDir()
	mockBd := createMockBd(t, tmpDir, mockOutput)

	client := NewClient(tmpDir)
	client.SetBdPath(mockBd)

	store := state.NewStore(tmpDir)
	broker := api.NewEventBroker(store)

	logPath := filepath.Join(tmpDir, "test.log")
	logger, err := logging.New(logPath)
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}
	t.Cleanup(func() { logger.Close() })

	poller := NewPoller(client, store, broker, logger)
	return poller, store, broker
}

func TestNewPoller(t *testing.T) {
	poller, _, _ := newTestPoller(t, "[]")
	if poller == nil {
		t.Fatal("NewPoller() returned nil")
	}
	if poller.interval != 1*time.Second {
		t.Errorf("Default interval = %v, want 1s", poller.interval)
	}
}

func TestPollerSetInterval(t *testing.T) {
	poller, _, _ := newTestPoller(t, "[]")
	poller.SetInterval(5 * time.Second)
	if poller.interval != 5*time.Second {
		t.Errorf("interval = %v, want 5s", poller.interval)
	}
}

func TestPollerPoll(t *testing.T) {
	output := `[{"id":"task-1","title":"Test","status":"open","priority":2,"issue_type":"task"}]`
	poller, store, _ := newTestPoller(t, output)

	ctx := context.Background()
	if err := poller.Poll(ctx); err != nil {
		t.Fatalf("Poll() error: %v", err)
	}

	tasks := store.GetTasks()
	if len(tasks) != 1 {
		t.Errorf("Expected 1 task, got %d", len(tasks))
	}
	if tasks[0].ID != "task-1" {
		t.Errorf("Task ID = %q, want %q", tasks[0].ID, "task-1")
	}
}

func TestPollerStartStop(t *testing.T) {
	poller, _, _ := newTestPoller(t, "[]")
	poller.SetInterval(50 * time.Millisecond)

	if poller.IsRunning() {
		t.Error("Poller should not be running initially")
	}

	poller.Start()

	if !poller.IsRunning() {
		t.Error("Poller should be running after Start()")
	}

	// Starting again should be idempotent
	poller.Start()

	poller.Stop()

	if poller.IsRunning() {
		t.Error("Poller should not be running after Stop()")
	}

	// Stopping again should be idempotent
	poller.Stop()
}

func TestPollerEmitsEvents(t *testing.T) {
	output := `[{"id":"task-1","title":"Test","status":"open","priority":2,"issue_type":"task"}]`
	poller, _, broker := newTestPoller(t, output)

	// Subscribe to events
	ch := broker.Subscribe()
	defer broker.Unsubscribe(ch)

	ctx := context.Background()
	if err := poller.Poll(ctx); err != nil {
		t.Fatalf("Poll() error: %v", err)
	}

	// Should receive tasks.updated event
	select {
	case event := <-ch:
		if event.Type != types.EventTypeTasksUpdated {
			t.Errorf("Event type = %q, want %q", event.Type, types.EventTypeTasksUpdated)
		}
	case <-time.After(time.Second):
		t.Error("Did not receive event")
	}
}

func TestPollerNoEventOnNoChange(t *testing.T) {
	output := `[{"id":"task-1","title":"Test","status":"open","priority":2,"issue_type":"task"}]`
	poller, _, broker := newTestPoller(t, output)

	ctx := context.Background()

	// First poll
	if err := poller.Poll(ctx); err != nil {
		t.Fatalf("Poll() error: %v", err)
	}

	// Subscribe after first poll
	ch := broker.Subscribe()
	defer broker.Unsubscribe(ch)

	// Second poll with same data - should not emit
	if err := poller.Poll(ctx); err != nil {
		t.Fatalf("Poll() error: %v", err)
	}

	select {
	case <-ch:
		t.Error("Should not receive event when tasks unchanged")
	case <-time.After(100 * time.Millisecond):
		// Good, no event
	}
}

func TestPollerTasksChanged(t *testing.T) {
	poller, _, _ := newTestPoller(t, "[]")

	tests := []struct {
		name    string
		old     []types.Task
		new     []types.Task
		changed bool
	}{
		{
			name:    "empty to empty",
			old:     []types.Task{},
			new:     []types.Task{},
			changed: false,
		},
		{
			name: "same tasks",
			old:  []types.Task{{ID: "1", Title: "A", Status: types.TaskStatusOpen}},
			new:  []types.Task{{ID: "1", Title: "A", Status: types.TaskStatusOpen}},
			changed: false,
		},
		{
			name:    "new task added",
			old:     []types.Task{},
			new:     []types.Task{{ID: "1", Title: "A"}},
			changed: true,
		},
		{
			name:    "task removed",
			old:     []types.Task{{ID: "1", Title: "A"}},
			new:     []types.Task{},
			changed: true,
		},
		{
			name: "status changed",
			old:  []types.Task{{ID: "1", Title: "A", Status: types.TaskStatusOpen}},
			new:  []types.Task{{ID: "1", Title: "A", Status: types.TaskStatusInProgress}},
			changed: true,
		},
		{
			name: "title changed",
			old:  []types.Task{{ID: "1", Title: "A", Status: types.TaskStatusOpen}},
			new:  []types.Task{{ID: "1", Title: "B", Status: types.TaskStatusOpen}},
			changed: true,
		},
		{
			name: "different task",
			old:  []types.Task{{ID: "1", Title: "A"}},
			new:  []types.Task{{ID: "2", Title: "B"}},
			changed: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := poller.tasksChanged(tt.old, tt.new)
			if got != tt.changed {
				t.Errorf("tasksChanged() = %v, want %v", got, tt.changed)
			}
		})
	}
}

func TestPollerWithNilBroker(t *testing.T) {
	tmpDir := t.TempDir()
	mockBd := createMockBd(t, tmpDir, `[{"id":"task-1","title":"Test","status":"open","priority":2,"issue_type":"task"}]`)

	client := NewClient(tmpDir)
	client.SetBdPath(mockBd)

	store := state.NewStore(tmpDir)

	logPath := filepath.Join(tmpDir, "test.log")
	logger, _ := logging.New(logPath)
	defer logger.Close()

	// Create poller with nil broker
	poller := NewPoller(client, store, nil, logger)

	ctx := context.Background()
	// Should not panic with nil broker
	if err := poller.Poll(ctx); err != nil {
		t.Fatalf("Poll() error: %v", err)
	}
}

func TestPollerLoopRuns(t *testing.T) {
	output := `[{"id":"task-1","title":"Test","status":"open","priority":2,"issue_type":"task"}]`
	poller, store, _ := newTestPoller(t, output)
	poller.SetInterval(50 * time.Millisecond)

	poller.Start()
	defer poller.Stop()

	// Wait for tasks to be populated with retry
	var tasks []types.Task
	for i := 0; i < 20; i++ {
		time.Sleep(50 * time.Millisecond)
		tasks = store.GetTasks()
		if len(tasks) > 0 {
			break
		}
	}

	if len(tasks) != 1 {
		t.Errorf("Expected 1 task after polling, got %d", len(tasks))
	}
}
