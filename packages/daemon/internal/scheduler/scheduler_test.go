package scheduler

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/coven/daemon/internal/agent"
	"github.com/coven/daemon/internal/beads"
	"github.com/coven/daemon/internal/git"
	"github.com/coven/daemon/internal/logging"
	"github.com/coven/daemon/internal/state"
	"github.com/coven/daemon/pkg/types"
)

func initTestRepo(t *testing.T) string {
	t.Helper()

	tmpDir := t.TempDir()

	// Initialize git repo
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to init git repo: %v", err)
	}

	// Configure git for the test
	exec.Command("git", "-C", tmpDir, "config", "user.email", "test@test.com").Run()
	exec.Command("git", "-C", tmpDir, "config", "user.name", "Test").Run()

	// Create initial commit
	testFile := filepath.Join(tmpDir, "README.md")
	if err := os.WriteFile(testFile, []byte("# Test"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	cmd = exec.Command("git", "add", ".")
	cmd.Dir = tmpDir
	cmd.Run()

	cmd = exec.Command("git", "commit", "-m", "Initial commit")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create initial commit: %v", err)
	}

	return tmpDir
}

func createMockBd(t *testing.T, dir string) string {
	t.Helper()
	mockBd := filepath.Join(dir, "mock-bd")
	script := `#!/bin/bash
# Mock bd for testing
case "$1" in
    ready)
        echo '[]'
        ;;
    update)
        # Accept any update
        exit 0
        ;;
    close)
        # Accept any close
        exit 0
        ;;
    *)
        exit 0
        ;;
esac
`
	if err := os.WriteFile(mockBd, []byte(script), 0755); err != nil {
		t.Fatalf("Failed to create mock bd: %v", err)
	}
	return mockBd
}

func newTestScheduler(t *testing.T) (*Scheduler, *state.Store, string) {
	t.Helper()

	repoDir := initTestRepo(t)
	covenDir := filepath.Join(repoDir, ".coven")

	// Ensure .coven directory exists
	if err := os.MkdirAll(covenDir, 0755); err != nil {
		t.Fatalf("Failed to create .coven directory: %v", err)
	}

	logPath := filepath.Join(t.TempDir(), "test.log")
	logger, err := logging.New(logPath)
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}
	t.Cleanup(func() { logger.Close() })

	store := state.NewStore(repoDir)
	beadsClient := beads.NewClient(repoDir)
	// Set up mock bd
	mockBd := createMockBd(t, t.TempDir())
	beadsClient.SetBdPath(mockBd)

	processManager := agent.NewProcessManager(logger)
	worktreeManager := git.NewWorktreeManager(repoDir, logger)

	sched := NewScheduler(store, beadsClient, processManager, worktreeManager, logger, covenDir)
	// Use echo as mock agent command for tests
	sched.SetAgentCommand("echo", []string{})

	// Clean up workflow state and worktrees before TempDir cleanup runs
	t.Cleanup(func() {
		sched.Stop()
		// Give workflows time to clean up
		time.Sleep(50 * time.Millisecond)
		// Force clean the .coven/workflows directory
		workflowsDir := filepath.Join(covenDir, "workflows")
		os.RemoveAll(workflowsDir)
	})

	return sched, store, repoDir
}

func TestNewScheduler(t *testing.T) {
	sched, _, _ := newTestScheduler(t)
	if sched == nil {
		t.Fatal("NewScheduler() returned nil")
	}
	if sched.maxAgents != DefaultMaxAgents {
		t.Errorf("maxAgents = %d, want %d", sched.maxAgents, DefaultMaxAgents)
	}
	if sched.reconcileInterval != DefaultReconcileInterval {
		t.Errorf("reconcileInterval = %v, want %v", sched.reconcileInterval, DefaultReconcileInterval)
	}
}

func TestSchedulerSetReconcileInterval(t *testing.T) {
	sched, _, _ := newTestScheduler(t)
	sched.SetReconcileInterval(10 * time.Second)
	if sched.reconcileInterval != 10*time.Second {
		t.Errorf("reconcileInterval = %v, want 10s", sched.reconcileInterval)
	}
}

func TestSchedulerSetMaxAgents(t *testing.T) {
	sched, _, _ := newTestScheduler(t)
	sched.SetMaxAgents(5)
	if sched.maxAgents != 5 {
		t.Errorf("maxAgents = %d, want 5", sched.maxAgents)
	}
}

func TestSchedulerSetAgentCommand(t *testing.T) {
	sched, _, _ := newTestScheduler(t)
	sched.SetAgentCommand("test-cmd", []string{"--arg1", "--arg2"})
	if sched.agentCommand != "test-cmd" {
		t.Errorf("agentCommand = %q, want %q", sched.agentCommand, "test-cmd")
	}
	if len(sched.agentArgs) != 2 {
		t.Errorf("agentArgs length = %d, want 2", len(sched.agentArgs))
	}
}

func TestSchedulerStartStop(t *testing.T) {
	sched, _, _ := newTestScheduler(t)
	sched.SetReconcileInterval(50 * time.Millisecond)

	if sched.IsRunning() {
		t.Error("Scheduler should not be running initially")
	}

	sched.Start()

	if !sched.IsRunning() {
		t.Error("Scheduler should be running after Start()")
	}

	// Starting again should be idempotent
	sched.Start()

	sched.Stop()

	if sched.IsRunning() {
		t.Error("Scheduler should not be running after Stop()")
	}

	// Stopping again should be idempotent
	sched.Stop()
}

func TestSchedulerReconcileNoTasks(t *testing.T) {
	sched, _, _ := newTestScheduler(t)
	ctx := context.Background()

	// Reconcile with no tasks should not error
	if err := sched.Reconcile(ctx); err != nil {
		t.Errorf("Reconcile() error: %v", err)
	}
}

func TestSchedulerReconcileWithTask(t *testing.T) {
	sched, store, _ := newTestScheduler(t)
	ctx := context.Background()

	// Add a ready task
	store.SetTasks([]types.Task{
		{ID: "task-1", Title: "Test Task", Status: types.TaskStatusOpen},
	})

	// Reconcile should start an agent
	if err := sched.Reconcile(ctx); err != nil {
		t.Errorf("Reconcile() error: %v", err)
	}

	// Wait for agent to complete (echo is fast)
	time.Sleep(100 * time.Millisecond)

	// Check agent state was created
	agentState := store.GetAgent("task-1")
	if agentState == nil {
		t.Error("Agent state should exist")
	}
}

func TestSchedulerReconcileMaxAgents(t *testing.T) {
	sched, store, _ := newTestScheduler(t)
	sched.SetMaxAgents(2)
	// Use sleep as agent command to keep them running
	sched.SetAgentCommand("sh", []string{"-c", "sleep 10"})
	ctx := context.Background()

	// Add 5 ready tasks
	store.SetTasks([]types.Task{
		{ID: "task-1", Title: "Task 1", Status: types.TaskStatusOpen},
		{ID: "task-2", Title: "Task 2", Status: types.TaskStatusOpen},
		{ID: "task-3", Title: "Task 3", Status: types.TaskStatusOpen},
		{ID: "task-4", Title: "Task 4", Status: types.TaskStatusOpen},
		{ID: "task-5", Title: "Task 5", Status: types.TaskStatusOpen},
	})

	// Reconcile
	if err := sched.Reconcile(ctx); err != nil {
		t.Errorf("Reconcile() error: %v", err)
	}

	// Should only have started 2 agents (maxAgents)
	running := sched.GetRunningAgents()
	if len(running) > 2 {
		t.Errorf("Running agents = %d, want <= 2", len(running))
	}

	// Cleanup
	for _, taskID := range running {
		sched.KillAgent(taskID)
	}
}

func TestSchedulerReconcileSkipsRunningTasks(t *testing.T) {
	t.Skip("Skipped: requires workflow infrastructure - covered by E2E tests")
	sched, store, _ := newTestScheduler(t)
	sched.SetAgentCommand("sh", []string{"-c", "sleep 10"})
	ctx := context.Background()

	// Add a ready task
	store.SetTasks([]types.Task{
		{ID: "task-1", Title: "Test Task", Status: types.TaskStatusOpen},
	})

	// First reconcile starts agent
	if err := sched.Reconcile(ctx); err != nil {
		t.Errorf("Reconcile() error: %v", err)
	}

	running1 := sched.GetRunningAgents()
	if len(running1) != 1 {
		t.Fatalf("Expected 1 running agent, got %d", len(running1))
	}

	// Second reconcile should not start duplicate
	if err := sched.Reconcile(ctx); err != nil {
		t.Errorf("Second Reconcile() error: %v", err)
	}

	running2 := sched.GetRunningAgents()
	if len(running2) != 1 {
		t.Errorf("Expected still 1 running agent, got %d", len(running2))
	}

	// Cleanup
	sched.KillAgent("task-1")
}

func TestSchedulerGetRunningAgents(t *testing.T) {
	sched, store, _ := newTestScheduler(t)
	// Use sh -c to ignore extra args (the prompt)
	sched.SetAgentCommand("sh", []string{"-c", "sleep 30"})
	ctx := context.Background()

	// Initially empty
	if len(sched.GetRunningAgents()) != 0 {
		t.Error("GetRunningAgents() should be empty initially")
	}

	// Add one task and reconcile
	store.SetTasks([]types.Task{
		{ID: "task-1", Title: "Task 1", Status: types.TaskStatusOpen},
	})

	err := sched.Reconcile(ctx)
	if err != nil {
		t.Fatalf("Reconcile() error: %v", err)
	}

	// Give process time to start
	time.Sleep(200 * time.Millisecond)

	running := sched.GetRunningAgents()
	if len(running) == 0 {
		// Check agent state for debugging
		agentState := store.GetAgent("task-1")
		if agentState != nil {
			t.Logf("Agent state: status=%s, error=%s", agentState.Status, agentState.Error)
		}
		t.Errorf("GetRunningAgents() = %d, want >= 1", len(running))
	}

	// Cleanup
	for _, taskID := range running {
		sched.KillAgent(taskID)
	}
}

func TestSchedulerStopAgent(t *testing.T) {
	t.Skip("Skipped: requires workflow infrastructure - covered by E2E tests")
	sched, store, _ := newTestScheduler(t)
	sched.SetAgentCommand("sh", []string{"-c", "sleep 30"})
	ctx := context.Background()

	// Start an agent
	store.SetTasks([]types.Task{
		{ID: "task-1", Title: "Test Task", Status: types.TaskStatusOpen},
	})
	sched.Reconcile(ctx)

	// Verify running
	if len(sched.GetRunningAgents()) != 1 {
		t.Fatal("Agent should be running")
	}

	// Stop agent
	if err := sched.StopAgent("task-1"); err != nil {
		t.Errorf("StopAgent() error: %v", err)
	}

	// Verify stopped
	time.Sleep(200 * time.Millisecond)
	if len(sched.GetRunningAgents()) != 0 {
		t.Error("Agent should not be running after StopAgent()")
	}
}

func TestSchedulerKillAgent(t *testing.T) {
	t.Skip("Skipped: requires workflow infrastructure - covered by E2E tests")
	sched, store, _ := newTestScheduler(t)
	sched.SetAgentCommand("sh", []string{"-c", "sleep 30"})
	ctx := context.Background()

	// Start an agent
	store.SetTasks([]types.Task{
		{ID: "task-1", Title: "Test Task", Status: types.TaskStatusOpen},
	})
	sched.Reconcile(ctx)

	// Verify running
	if len(sched.GetRunningAgents()) != 1 {
		t.Fatal("Agent should be running")
	}

	// Kill agent
	if err := sched.KillAgent("task-1"); err != nil {
		t.Errorf("KillAgent() error: %v", err)
	}

	// Verify killed
	time.Sleep(200 * time.Millisecond)
	if len(sched.GetRunningAgents()) != 0 {
		t.Error("Agent should not be running after KillAgent()")
	}
}

func TestSchedulerSkipsInProgressTasks(t *testing.T) {
	t.Skip("Skipped: requires workflow infrastructure - covered by E2E tests")
	sched, store, _ := newTestScheduler(t)
	sched.SetAgentCommand("sh", []string{"-c", "sleep 10"})
	ctx := context.Background()

	// Add tasks with mixed statuses
	store.SetTasks([]types.Task{
		{ID: "task-1", Title: "Open Task", Status: types.TaskStatusOpen},
		{ID: "task-2", Title: "In Progress", Status: types.TaskStatusInProgress},
		{ID: "task-3", Title: "Done Task", Status: types.TaskStatusClosed},
	})

	// Reconcile
	if err := sched.Reconcile(ctx); err != nil {
		t.Errorf("Reconcile() error: %v", err)
	}

	// Should only start agent for task-1 (open)
	running := sched.GetRunningAgents()
	if len(running) != 1 {
		t.Errorf("Expected 1 running agent, got %d", len(running))
	}
	if len(running) > 0 && running[0] != "task-1" {
		t.Errorf("Expected task-1 running, got %s", running[0])
	}

	// Cleanup
	for _, taskID := range running {
		sched.KillAgent(taskID)
	}
}

func TestBuildPromptFromTask(t *testing.T) {
	tests := []struct {
		name        string
		task        types.Task
		wantContain string
	}{
		{
			name:        "title only",
			task:        types.Task{Title: "Fix the bug"},
			wantContain: "Fix the bug",
		},
		{
			name:        "with description",
			task:        types.Task{Title: "Fix the bug", Description: "The bug is in auth.go"},
			wantContain: "The bug is in auth.go",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildPromptFromTask(tt.task)
			if got == "" || !contains(got, tt.wantContain) {
				t.Errorf("buildPromptFromTask() = %q, want to contain %q", got, tt.wantContain)
			}
		})
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsHelper(s, substr))
}

func containsHelper(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

func TestSchedulerStartsOnlyOpenTasks(t *testing.T) {
	sched, store, _ := newTestScheduler(t)
	sched.SetAgentCommand("echo", []string{"done"})
	ctx := context.Background()

	// Add only non-open tasks
	store.SetTasks([]types.Task{
		{ID: "task-1", Title: "In Progress", Status: types.TaskStatusInProgress},
		{ID: "task-2", Title: "Done", Status: types.TaskStatusClosed},
	})

	// Reconcile
	if err := sched.Reconcile(ctx); err != nil {
		t.Errorf("Reconcile() error: %v", err)
	}

	// Should not start any agents
	running := sched.GetRunningAgents()
	if len(running) != 0 {
		t.Errorf("Expected 0 running agents, got %d", len(running))
	}
}

func TestSchedulerReconcileLoopRuns(t *testing.T) {
	sched, store, _ := newTestScheduler(t)
	sched.SetReconcileInterval(50 * time.Millisecond)
	sched.SetAgentCommand("echo", []string{"done"})

	// Add task before starting
	store.SetTasks([]types.Task{
		{ID: "task-1", Title: "Test Task", Status: types.TaskStatusOpen},
	})

	// Start scheduler
	sched.Start()
	defer sched.Stop()

	// Wait for reconcile to pick it up with retry
	var agentState *types.Agent
	for i := 0; i < 20; i++ {
		time.Sleep(50 * time.Millisecond)
		agentState = store.GetAgent("task-1")
		if agentState != nil {
			break
		}
	}

	// Agent should have been created
	if agentState == nil {
		t.Error("Agent should have been created by reconcile loop")
	}
}
