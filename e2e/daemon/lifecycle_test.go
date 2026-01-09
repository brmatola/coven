//go:build e2e

// Package daemon_e2e contains end-to-end tests for the coven daemon.
//
// These tests verify the daemon works correctly as a complete system,
// testing the actual binary rather than internal packages.
package daemon_e2e

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// TestDaemonStartStop verifies the daemon can start and stop correctly.
func TestDaemonStartStop(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	api := helpers.NewAPIClient(env)
	health, err := api.GetHealth()
	if err != nil {
		t.Fatalf("Health check error: %v", err)
	}

	if health.Status != "healthy" {
		t.Errorf("Health.Status = %q, want %q", health.Status, "healthy")
	}

	if health.Workspace != env.TmpDir {
		t.Errorf("Health.Workspace = %q, want %q", health.Workspace, env.TmpDir)
	}
}

// TestDaemonHealthStability verifies the health endpoint is stable.
func TestDaemonHealthStability(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	api := helpers.NewAPIClient(env)
	for i := 0; i < 5; i++ {
		health, err := api.GetHealth()
		if err != nil {
			t.Fatalf("Health check %d error: %v", i, err)
		}
		if health.Status != "healthy" {
			t.Errorf("Health check %d: Status = %q, want %q", i, health.Status, "healthy")
		}
	}
}

// TestDaemonVersion verifies the version endpoint.
func TestDaemonVersion(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	api := helpers.NewAPIClient(env)
	version, err := api.GetVersion()
	if err != nil {
		t.Fatalf("Version check error: %v", err)
	}

	if version.Version == "" {
		t.Error("Version should not be empty")
	}
}

// TestDaemonShutdown verifies the shutdown endpoint.
func TestDaemonShutdown(t *testing.T) {
	env := helpers.NewTestEnv(t)

	env.MustStart()

	api := helpers.NewAPIClient(env)
	if err := api.Shutdown(); err != nil {
		t.Fatalf("Shutdown error: %v", err)
	}

	// Wait for process to exit
	done := make(chan error, 1)
	go func() {
		done <- env.Cmd.Wait()
	}()

	select {
	case <-done:
		// Success
	case <-time.After(5 * time.Second):
		t.Error("Daemon did not shut down within 5 seconds")
		env.Cmd.Process.Kill()
	}
}

// TestDaemonPidFile verifies PID file creation and cleanup.
func TestDaemonPidFile(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	// Check that PID file was created
	pidFile := filepath.Join(env.CovenDir, "covend.pid")
	if _, err := os.Stat(pidFile); os.IsNotExist(err) {
		t.Error("PID file should exist while daemon is running")
	}

	// Stop daemon
	env.Stop()

	// Wait for cleanup
	time.Sleep(500 * time.Millisecond)

	// PID file should be cleaned up
	if _, err := os.Stat(pidFile); !os.IsNotExist(err) {
		t.Error("PID file should be cleaned up after daemon stops")
	}
}

// TestDaemonSocketCreation verifies socket creation.
func TestDaemonSocketCreation(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	// Socket should not exist before start
	if _, err := os.Stat(env.SocketPath); !os.IsNotExist(err) {
		t.Error("Socket should not exist before daemon starts")
	}

	env.MustStart()

	// Socket should exist after start
	if _, err := os.Stat(env.SocketPath); os.IsNotExist(err) {
		t.Error("Socket should exist after daemon starts")
	}
}

// TestDaemonPreventsDoubleStart verifies only one daemon can run per workspace.
func TestDaemonPreventsDoubleStart(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	// Try to start a second daemon
	cmd2 := exec.Command(env.DaemonBin, "--workspace", env.TmpDir)
	output, err := cmd2.CombinedOutput()

	if err == nil {
		t.Error("Second daemon start should have failed")
	}

	if exitErr, ok := err.(*exec.ExitError); ok {
		if exitErr.ExitCode() == 0 {
			t.Error("Second daemon should exit with non-zero code")
		}
	}

	// Output should mention already running
	t.Logf("Second daemon output: %s", string(output))
}

// TestDaemonStaleSocketCleanup verifies stale socket cleanup.
func TestDaemonStaleSocketCleanup(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	// Create .coven directory
	if err := os.MkdirAll(env.CovenDir, 0755); err != nil {
		t.Fatalf("Failed to create .coven dir: %v", err)
	}

	// Create a stale socket file
	if err := os.WriteFile(env.SocketPath, []byte("stale"), 0644); err != nil {
		t.Fatalf("Failed to create stale socket: %v", err)
	}

	// Daemon should start successfully by cleaning up stale socket
	env.MustStart()

	api := helpers.NewAPIClient(env)
	health, err := api.GetHealth()
	if err != nil {
		t.Fatalf("Health check error: %v", err)
	}
	if health.Status != "healthy" {
		t.Errorf("Health.Status = %q, want %q", health.Status, "healthy")
	}
}
