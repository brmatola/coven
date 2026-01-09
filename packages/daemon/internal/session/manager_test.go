package session

import (
	"context"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/coven/daemon/internal/logging"
	"github.com/coven/daemon/internal/state"
	"github.com/coven/daemon/pkg/types"
)

func newTestManager(t *testing.T) (*Manager, *state.Store) {
	t.Helper()
	tmpDir := t.TempDir()
	store := state.NewStore(tmpDir)

	logPath := tmpDir + "/test.log"
	logger, err := logging.New(logPath)
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}
	t.Cleanup(func() { logger.Close() })

	return NewManager(store, logger), store
}

func TestNewManager(t *testing.T) {
	manager, _ := newTestManager(t)
	if manager == nil {
		t.Fatal("NewManager() returned nil")
	}
}

func TestManagerStart(t *testing.T) {
	manager, store := newTestManager(t)

	// Start session
	if err := manager.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	if !manager.IsActive() {
		t.Error("IsActive() should be true after Start()")
	}

	session := store.GetSession()
	if session.Status != types.SessionStatusActive {
		t.Errorf("Session status = %q, want %q", session.Status, types.SessionStatusActive)
	}

	// Starting again should fail
	if err := manager.Start(); err == nil {
		t.Error("Start() should fail when already active")
	}
}

func TestManagerStop(t *testing.T) {
	manager, store := newTestManager(t)

	// Stop without active session should fail
	ctx := context.Background()
	if err := manager.Stop(ctx); err == nil {
		t.Error("Stop() should fail with no active session")
	}

	// Start and stop
	if err := manager.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	if err := manager.Stop(ctx); err != nil {
		t.Fatalf("Stop() error: %v", err)
	}

	if manager.IsActive() {
		t.Error("IsActive() should be false after Stop()")
	}

	session := store.GetSession()
	if session.Status != types.SessionStatusInactive {
		t.Errorf("Session status = %q, want %q", session.Status, types.SessionStatusInactive)
	}
}

func TestManagerForceStop(t *testing.T) {
	manager, store := newTestManager(t)

	// Force stop without active session should fail
	if err := manager.ForceStop(); err == nil {
		t.Error("ForceStop() should fail with no active session")
	}

	// Start session
	if err := manager.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	// Add a fake running agent (no actual process)
	store.AddAgent(&types.Agent{
		TaskID:    "task-1",
		PID:       999999, // Non-existent PID
		Status:    types.AgentStatusRunning,
		StartedAt: time.Now(),
	})

	// Force stop
	if err := manager.ForceStop(); err != nil {
		t.Fatalf("ForceStop() error: %v", err)
	}

	if manager.IsActive() {
		t.Error("IsActive() should be false after ForceStop()")
	}

	// Agent should be marked as killed
	agent := store.GetAgent("task-1")
	if agent.Status != types.AgentStatusKilled {
		t.Errorf("Agent status = %q, want %q", agent.Status, types.AgentStatusKilled)
	}
}

func TestManagerStopWithRunningAgents(t *testing.T) {
	manager, store := newTestManager(t)

	if err := manager.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	// Add a completed agent
	store.AddAgent(&types.Agent{
		TaskID:    "task-1",
		PID:       12345,
		Status:    types.AgentStatusCompleted,
		StartedAt: time.Now(),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	if err := manager.Stop(ctx); err != nil {
		t.Fatalf("Stop() error: %v", err)
	}
}

func TestManagerStopTimeout(t *testing.T) {
	manager, store := newTestManager(t)

	if err := manager.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	// Add a "running" agent that will never complete
	store.AddAgent(&types.Agent{
		TaskID:    "task-1",
		PID:       999999,
		Status:    types.AgentStatusRunning,
		StartedAt: time.Now(),
	})

	// Very short timeout
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	err := manager.Stop(ctx)
	if err != context.DeadlineExceeded {
		t.Errorf("Stop() error = %v, want context.DeadlineExceeded", err)
	}
}

func TestManagerIsStopping(t *testing.T) {
	manager, store := newTestManager(t)

	if manager.IsStopping() {
		t.Error("IsStopping() should be false initially")
	}

	if err := manager.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	// Manually set to stopping state
	store.StopSession()

	if !manager.IsStopping() {
		t.Error("IsStopping() should be true when stopping")
	}
}

func TestManagerStopCh(t *testing.T) {
	manager, _ := newTestManager(t)

	// Before start, stopCh is nil
	if manager.StopCh() != nil {
		t.Error("StopCh() should be nil before Start()")
	}

	if err := manager.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	stopCh := manager.StopCh()
	if stopCh == nil {
		t.Fatal("StopCh() should not be nil after Start()")
	}

	// Channel should not be closed yet
	select {
	case <-stopCh:
		t.Error("StopCh should not be closed before stop")
	default:
		// Good
	}

	// Stop should close the channel
	ctx := context.Background()
	if err := manager.Stop(ctx); err != nil {
		t.Fatalf("Stop() error: %v", err)
	}

	select {
	case <-stopCh:
		// Good, channel closed
	default:
		t.Error("StopCh should be closed after stop")
	}
}

func TestManagerRecover(t *testing.T) {
	manager, store := newTestManager(t)

	// Recover with no session
	if err := manager.Recover(); err != nil {
		t.Fatalf("Recover() error: %v", err)
	}

	// Start session
	if err := manager.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	// Add an agent that's "running" but the process doesn't exist
	store.AddAgent(&types.Agent{
		TaskID:    "task-1",
		PID:       999999, // Non-existent
		Status:    types.AgentStatusRunning,
		StartedAt: time.Now(),
	})

	if err := store.Save(); err != nil {
		t.Fatalf("Save() error: %v", err)
	}

	// Create new manager and recover
	manager2, _ := newTestManager(t)
	manager2.store = store // Share store

	if err := store.Load(); err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if err := manager2.Recover(); err != nil {
		t.Fatalf("Recover() error: %v", err)
	}

	// Agent should be marked as failed
	agent := store.GetAgent("task-1")
	if agent.Status != types.AgentStatusFailed {
		t.Errorf("Agent status = %q, want %q", agent.Status, types.AgentStatusFailed)
	}
	if agent.Error == "" {
		t.Error("Agent should have error message")
	}
}

func TestManagerForceStopWithRealProcess(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping test that spawns processes in short mode")
	}

	manager, store := newTestManager(t)

	if err := manager.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	// Start a real process that sleeps
	cmd := exec.Command("sleep", "60")
	if err := cmd.Start(); err != nil {
		t.Fatalf("Failed to start process: %v", err)
	}

	store.AddAgent(&types.Agent{
		TaskID:    "task-1",
		PID:       cmd.Process.Pid,
		Status:    types.AgentStatusRunning,
		StartedAt: time.Now(),
	})

	// Force stop should kill it
	if err := manager.ForceStop(); err != nil {
		t.Fatalf("ForceStop() error: %v", err)
	}

	// Wait for the process to be killed
	_ = cmd.Wait()

	// Verify process is no longer running
	if manager.isProcessRunning(cmd.Process.Pid) {
		t.Error("Process should be killed after ForceStop()")
	}
}

func TestIsProcessRunning(t *testing.T) {
	manager, _ := newTestManager(t)

	// Current process should be running
	if !manager.isProcessRunning(os.Getpid()) {
		t.Error("isProcessRunning() should return true for current process")
	}

	// Non-existent PID should not be running
	if manager.isProcessRunning(999999) {
		t.Error("isProcessRunning() should return false for non-existent PID")
	}
}

func TestManagerDoubleForceStop(t *testing.T) {
	manager, _ := newTestManager(t)

	if err := manager.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	// First force stop
	if err := manager.ForceStop(); err != nil {
		t.Fatalf("First ForceStop() error: %v", err)
	}

	// Second force stop should fail (no active session)
	if err := manager.ForceStop(); err == nil {
		t.Error("Second ForceStop() should fail")
	}
}
