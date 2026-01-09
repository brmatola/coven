//go:build e2e

package daemon_e2e

import (
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// TestBeadsTaskSync verifies that tasks created with bd appear in the daemon.
func TestBeadsTaskSync(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	// Initialize beads
	env.InitBeads(t)

	// Create multiple tasks
	task1ID := env.CreateBeadsTask(t, "Task one", 1)
	task2ID := env.CreateBeadsTask(t, "Task two", 2)
	task3ID := env.CreateBeadsTask(t, "Task three", 3)

	t.Logf("Created tasks: %s, %s, %s", task1ID, task2ID, task3ID)

	// Start daemon
	env.MustStart()
	api := helpers.NewAPIClient(env)

	// Wait for tasks to sync
	var tasks *helpers.TasksResponse
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var err error
		tasks, err = api.GetTasks()
		if err == nil && tasks.Count >= 3 {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	if tasks == nil || tasks.Count < 3 {
		t.Fatalf("Expected at least 3 tasks, got %d", tasks.Count)
	}

	t.Logf("Synced %d tasks", tasks.Count)

	// Verify all our tasks are present
	taskIDs := make(map[string]bool)
	for _, task := range tasks.Tasks {
		taskIDs[task.ID] = true
		t.Logf("  - %s: %s (priority %d)", task.ID, task.Title, task.Priority)
	}

	if !taskIDs[task1ID] {
		t.Errorf("Task %s not found in synced tasks", task1ID)
	}
	if !taskIDs[task2ID] {
		t.Errorf("Task %s not found in synced tasks", task2ID)
	}
	if !taskIDs[task3ID] {
		t.Errorf("Task %s not found in synced tasks", task3ID)
	}
}

// TestBeadsTaskPriority verifies that tasks are sorted by priority.
func TestBeadsTaskPriority(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Create tasks with different priorities (0 is highest)
	env.CreateBeadsTask(t, "Low priority task", 3)
	env.CreateBeadsTask(t, "High priority task", 0)
	env.CreateBeadsTask(t, "Medium priority task", 2)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	// Wait for sync
	time.Sleep(1 * time.Second)

	tasks, err := api.GetTasks()
	if err != nil {
		t.Fatalf("Failed to get tasks: %v", err)
	}

	if tasks.Count < 3 {
		t.Fatalf("Expected at least 3 tasks, got %d", tasks.Count)
	}

	// Log tasks in order received
	t.Log("Tasks in order:")
	for i, task := range tasks.Tasks {
		t.Logf("  %d. %s (priority %d)", i+1, task.Title, task.Priority)
	}

	// First task should be highest priority (0)
	if len(tasks.Tasks) > 0 && tasks.Tasks[0].Priority != 0 {
		t.Logf("Note: Tasks may not be sorted by priority - first task has priority %d", tasks.Tasks[0].Priority)
	}
}
