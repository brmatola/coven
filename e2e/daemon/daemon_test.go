//go:build e2e

package daemon_e2e

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// testEnv holds the test environment configuration.
type testEnv struct {
	t          *testing.T
	tmpDir     string
	covenDir   string
	socketPath string
	daemonBin  string
	cmd        *exec.Cmd
	client     *http.Client
}

// getDaemonBinary returns the path to the daemon binary.
// It looks for the binary in the build directory relative to the repo root.
func getDaemonBinary() (string, error) {
	// Get the repo root (2 levels up from e2e/daemon)
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		return "", fmt.Errorf("failed to get caller info")
	}

	repoRoot := filepath.Join(filepath.Dir(filename), "..", "..")
	daemonBin := filepath.Join(repoRoot, "build", "covend")

	if _, err := os.Stat(daemonBin); os.IsNotExist(err) {
		return "", fmt.Errorf("daemon binary not found at %s - run 'make build-daemon' first", daemonBin)
	}

	return daemonBin, nil
}

// setupTestEnv creates a new test environment with a temporary workspace.
func setupTestEnv(t *testing.T) *testEnv {
	t.Helper()

	daemonBin, err := getDaemonBinary()
	if err != nil {
		t.Fatalf("Failed to find daemon binary: %v", err)
	}

	// Create a short temp directory for the socket (macOS has ~104 char limit for Unix sockets)
	// Use /tmp directly with a short unique name
	shortTmpDir := filepath.Join("/tmp", fmt.Sprintf("coven-e2e-%d", time.Now().UnixNano()%1000000))
	if err := os.MkdirAll(shortTmpDir, 0755); err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	t.Cleanup(func() { os.RemoveAll(shortTmpDir) })

	tmpDir := shortTmpDir

	// Initialize git repo (required for daemon)
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to init git repo: %v", err)
	}

	exec.Command("git", "-C", tmpDir, "config", "user.email", "test@test.com").Run()
	exec.Command("git", "-C", tmpDir, "config", "user.name", "Test").Run()

	// Create initial commit
	testFile := filepath.Join(tmpDir, "README.md")
	if err := os.WriteFile(testFile, []byte("# Test"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}
	exec.Command("git", "-C", tmpDir, "add", ".").Run()
	exec.Command("git", "-C", tmpDir, "commit", "-m", "Initial commit").Run()

	covenDir := filepath.Join(tmpDir, ".coven")
	socketPath := filepath.Join(covenDir, "covend.sock")

	// Create HTTP client that uses Unix socket
	client := &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return net.Dial("unix", socketPath)
			},
		},
		Timeout: 5 * time.Second,
	}

	return &testEnv{
		t:          t,
		tmpDir:     tmpDir,
		covenDir:   covenDir,
		socketPath: socketPath,
		daemonBin:  daemonBin,
		client:     client,
	}
}

// startDaemon starts the daemon and waits for it to be ready.
func (e *testEnv) startDaemon() error {
	e.cmd = exec.Command(e.daemonBin, "--workspace", e.tmpDir)
	e.cmd.Stdout = os.Stdout
	e.cmd.Stderr = os.Stderr

	if err := e.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start daemon: %w", err)
	}

	// Wait for daemon to be ready by polling the socket
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(e.socketPath); err == nil {
			// Socket exists, try to connect
			resp, err := e.client.Get("http://unix/health")
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					return nil
				}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}

	return fmt.Errorf("daemon failed to become ready within 5 seconds")
}

// stopDaemon stops the daemon gracefully.
func (e *testEnv) stopDaemon() {
	if e.cmd == nil || e.cmd.Process == nil {
		return
	}

	// Try graceful shutdown first
	resp, err := e.client.Post("http://unix/shutdown", "application/json", nil)
	if err == nil {
		resp.Body.Close()
		// Wait for process to exit
		done := make(chan error, 1)
		go func() {
			done <- e.cmd.Wait()
		}()
		select {
		case <-done:
			return
		case <-time.After(3 * time.Second):
			// Fall through to kill
		}
	}

	// Force kill
	e.cmd.Process.Kill()
	e.cmd.Wait()
}

// HealthResponse matches the daemon's health response structure.
type HealthResponse struct {
	Status    string `json:"status"`
	Version   string `json:"version"`
	Uptime    string `json:"uptime"`
	Workspace string `json:"workspace"`
}

func TestE2E_DaemonStartStop(t *testing.T) {
	env := setupTestEnv(t)
	defer env.stopDaemon()

	// Start daemon
	if err := env.startDaemon(); err != nil {
		t.Fatalf("Failed to start daemon: %v", err)
	}

	// Test health endpoint
	resp, err := env.client.Get("http://unix/health")
	if err != nil {
		t.Fatalf("Health check error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Health status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var health HealthResponse
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		t.Fatalf("Decode error: %v", err)
	}

	if health.Status != "healthy" {
		t.Errorf("Health.Status = %q, want %q", health.Status, "healthy")
	}

	if health.Workspace != env.tmpDir {
		t.Errorf("Health.Workspace = %q, want %q", health.Workspace, env.tmpDir)
	}

	if health.Version == "" {
		t.Error("Health.Version should not be empty")
	}
}

func TestE2E_DaemonHealthEndpoint(t *testing.T) {
	env := setupTestEnv(t)
	defer env.stopDaemon()

	if err := env.startDaemon(); err != nil {
		t.Fatalf("Failed to start daemon: %v", err)
	}

	// Make multiple health requests to verify stability
	for i := 0; i < 3; i++ {
		resp, err := env.client.Get("http://unix/health")
		if err != nil {
			t.Fatalf("Health check %d error: %v", i, err)
		}

		if resp.StatusCode != http.StatusOK {
			t.Errorf("Health check %d status = %d, want %d", i, resp.StatusCode, http.StatusOK)
		}
		resp.Body.Close()
	}
}

func TestE2E_DaemonShutdownEndpoint(t *testing.T) {
	env := setupTestEnv(t)

	if err := env.startDaemon(); err != nil {
		t.Fatalf("Failed to start daemon: %v", err)
	}

	// Request shutdown
	resp, err := env.client.Post("http://unix/shutdown", "application/json", nil)
	if err != nil {
		t.Fatalf("Shutdown request error: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Shutdown status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	// Wait for process to exit
	done := make(chan error, 1)
	go func() {
		done <- env.cmd.Wait()
	}()

	select {
	case err := <-done:
		if err != nil {
			// Exit code 0 is expected
			if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() != 0 {
				t.Errorf("Daemon exited with code %d", exitErr.ExitCode())
			}
		}
	case <-time.After(5 * time.Second):
		t.Error("Daemon did not shut down within 5 seconds")
		env.cmd.Process.Kill()
	}
}

func TestE2E_DaemonPidFile(t *testing.T) {
	env := setupTestEnv(t)
	defer env.stopDaemon()

	if err := env.startDaemon(); err != nil {
		t.Fatalf("Failed to start daemon: %v", err)
	}

	// Check that PID file was created
	pidFile := filepath.Join(env.covenDir, "covend.pid")
	if _, err := os.Stat(pidFile); os.IsNotExist(err) {
		t.Error("PID file should exist while daemon is running")
	}

	// Stop daemon
	env.stopDaemon()

	// Wait a moment for cleanup
	time.Sleep(500 * time.Millisecond)

	// PID file should be cleaned up
	if _, err := os.Stat(pidFile); !os.IsNotExist(err) {
		t.Error("PID file should be cleaned up after daemon stops")
	}
}

func TestE2E_DaemonSocketCreation(t *testing.T) {
	env := setupTestEnv(t)
	defer env.stopDaemon()

	// Socket should not exist before start
	if _, err := os.Stat(env.socketPath); !os.IsNotExist(err) {
		t.Error("Socket should not exist before daemon starts")
	}

	if err := env.startDaemon(); err != nil {
		t.Fatalf("Failed to start daemon: %v", err)
	}

	// Socket should exist after start
	if _, err := os.Stat(env.socketPath); os.IsNotExist(err) {
		t.Error("Socket should exist after daemon starts")
	}
}

func TestE2E_DaemonPreventsDoubleStart(t *testing.T) {
	env := setupTestEnv(t)
	defer env.stopDaemon()

	if err := env.startDaemon(); err != nil {
		t.Fatalf("Failed to start first daemon: %v", err)
	}

	// Try to start a second daemon - should fail
	cmd2 := exec.Command(env.daemonBin, "--workspace", env.tmpDir)
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
	if len(output) > 0 {
		t.Logf("Second daemon output: %s", string(output))
	}
}
