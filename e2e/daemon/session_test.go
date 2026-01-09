//go:build e2e

package daemon_e2e

import (
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// TestSessionLifecycle verifies the session start/stop lifecycle.
func TestSessionLifecycle(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	api := helpers.NewAPIClient(env)

	// Initial state should be inactive
	status, err := api.GetSessionStatus()
	if err != nil {
		t.Fatalf("Get session status error: %v", err)
	}
	if status.Status != "inactive" {
		t.Errorf("Initial session status = %q, want %q", status.Status, "inactive")
	}
	if status.Active {
		t.Error("Initial session should not be active")
	}

	// Start session
	if err := api.StartSession(); err != nil {
		t.Fatalf("Start session error: %v", err)
	}

	// Verify session is active
	status, err = api.GetSessionStatus()
	if err != nil {
		t.Fatalf("Get session status error: %v", err)
	}
	if status.Status != "active" {
		t.Errorf("Session status after start = %q, want %q", status.Status, "active")
	}
	if !status.Active {
		t.Error("Session should be active after start")
	}

	// Stop session
	if err := api.StopSession(); err != nil {
		t.Fatalf("Stop session error: %v", err)
	}

	// Wait for session to stop
	time.Sleep(200 * time.Millisecond)

	// Verify session is inactive
	status, err = api.GetSessionStatus()
	if err != nil {
		t.Fatalf("Get session status error: %v", err)
	}
	if status.Status != "inactive" {
		t.Errorf("Session status after stop = %q, want %q", status.Status, "inactive")
	}
	if status.Active {
		t.Error("Session should not be active after stop")
	}
}

// TestSessionForceStop verifies force stop functionality.
func TestSessionForceStop(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	api := helpers.NewAPIClient(env)

	// Start session
	if err := api.StartSession(); err != nil {
		t.Fatalf("Start session error: %v", err)
	}

	// Force stop
	if err := api.ForceStopSession(); err != nil {
		t.Fatalf("Force stop session error: %v", err)
	}

	// Give it a moment to process
	time.Sleep(100 * time.Millisecond)

	// Verify session is inactive
	status, err := api.GetSessionStatus()
	if err != nil {
		t.Fatalf("Get session status error: %v", err)
	}
	if status.Status != "inactive" {
		t.Errorf("Session status after force stop = %q, want %q", status.Status, "inactive")
	}
}

// TestSessionDoubleStart verifies starting an already started session.
func TestSessionDoubleStart(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	api := helpers.NewAPIClient(env)

	// Start session
	if err := api.StartSession(); err != nil {
		t.Fatalf("First start session error: %v", err)
	}

	// Starting again should return conflict or be idempotent
	// (depends on implementation - just verify it doesn't crash)
	_ = api.StartSession()

	// Session should still be active
	status, err := api.GetSessionStatus()
	if err != nil {
		t.Fatalf("Get session status error: %v", err)
	}
	if !status.Active {
		t.Error("Session should still be active")
	}
}

// TestSessionStopWhenNotStarted verifies stopping a not-started session.
func TestSessionStopWhenNotStarted(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	api := helpers.NewAPIClient(env)

	// Stop without starting should be idempotent
	_ = api.StopSession()

	// Session should be inactive
	status, err := api.GetSessionStatus()
	if err != nil {
		t.Fatalf("Get session status error: %v", err)
	}
	if status.Status != "inactive" {
		t.Errorf("Session status = %q, want %q", status.Status, "inactive")
	}
}
