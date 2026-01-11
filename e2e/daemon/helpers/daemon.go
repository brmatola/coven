// Package helpers provides test utilities for daemon E2E tests.
package helpers

import (
	"context"
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

// TestEnv holds the test environment configuration.
type TestEnv struct {
	T          *testing.T
	TmpDir     string
	CovenDir   string
	SocketPath string
	DaemonBin  string
	Cmd        *exec.Cmd
	Client     *http.Client
	SSEClient  *http.Client // For long-lived SSE connections (no timeout)
}

// getDaemonBinary returns the path to the daemon binary.
func getDaemonBinary() (string, error) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		return "", fmt.Errorf("failed to get caller info")
	}

	// Go up from e2e/daemon/helpers to repo root
	repoRoot := filepath.Join(filepath.Dir(filename), "..", "..", "..")
	daemonBin := filepath.Join(repoRoot, "build", "covend")

	if _, err := os.Stat(daemonBin); os.IsNotExist(err) {
		return "", fmt.Errorf("daemon binary not found at %s - run 'make build-daemon' first", daemonBin)
	}

	return daemonBin, nil
}

// NewTestEnv creates a new test environment with a temporary workspace.
func NewTestEnv(t *testing.T) *TestEnv {
	t.Helper()

	daemonBin, err := getDaemonBinary()
	if err != nil {
		t.Fatalf("Failed to find daemon binary: %v", err)
	}

	// Create a short temp directory (macOS has ~104 char limit for Unix sockets)
	shortTmpDir := filepath.Join("/tmp", fmt.Sprintf("coven-e2e-%d", time.Now().UnixNano()%1000000))
	if err := os.MkdirAll(shortTmpDir, 0755); err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	t.Cleanup(func() { os.RemoveAll(shortTmpDir) })

	tmpDir := shortTmpDir

	// Initialize git repo
	InitGitRepo(t, tmpDir)

	covenDir := filepath.Join(tmpDir, ".coven")
	socketPath := filepath.Join(covenDir, "covend.sock")

	// Create HTTP transport for Unix socket
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return net.Dial("unix", socketPath)
		},
	}

	// Create HTTP client with timeout for normal requests
	client := &http.Client{
		Transport: transport,
		Timeout:   5 * time.Second,
	}

	// Create SSE client without timeout for long-lived connections
	sseClient := &http.Client{
		Transport: transport,
		Timeout:   0, // No timeout for SSE
	}

	return &TestEnv{
		T:          t,
		TmpDir:     tmpDir,
		CovenDir:   covenDir,
		SocketPath: socketPath,
		DaemonBin:  daemonBin,
		Client:     client,
		SSEClient:  sseClient,
	}
}

// InitGitRepo initializes a git repository in the given directory.
func InitGitRepo(t *testing.T, dir string) {
	t.Helper()

	cmd := exec.Command("git", "init")
	cmd.Dir = dir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to init git repo: %v", err)
	}

	exec.Command("git", "-C", dir, "config", "user.email", "test@test.com").Run()
	exec.Command("git", "-C", dir, "config", "user.name", "Test").Run()

	// Create initial commit
	testFile := filepath.Join(dir, "README.md")
	if err := os.WriteFile(testFile, []byte("# Test"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}
	exec.Command("git", "-C", dir, "add", ".").Run()
	exec.Command("git", "-C", dir, "commit", "-m", "Initial commit").Run()
}

// Start starts the daemon and waits for it to be ready.
func (e *TestEnv) Start() error {
	e.Cmd = exec.Command(e.DaemonBin, "--workspace", e.TmpDir)
	e.Cmd.Stdout = os.Stdout
	e.Cmd.Stderr = os.Stderr

	if err := e.Cmd.Start(); err != nil {
		return fmt.Errorf("failed to start daemon: %w", err)
	}

	// Wait for daemon to be ready
	return e.WaitReady(5 * time.Second)
}

// WaitReady waits for the daemon to be ready.
func (e *TestEnv) WaitReady(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(e.SocketPath); err == nil {
			resp, err := e.Client.Get("http://unix/health")
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					return nil
				}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("daemon failed to become ready within %v", timeout)
}

// Stop stops the daemon gracefully.
func (e *TestEnv) Stop() {
	if e.Cmd == nil || e.Cmd.Process == nil {
		return
	}

	// Try graceful shutdown first
	resp, err := e.Client.Post("http://unix/shutdown", "application/json", nil)
	if err == nil {
		resp.Body.Close()
		done := make(chan error, 1)
		go func() {
			done <- e.Cmd.Wait()
		}()
		select {
		case <-done:
			return
		case <-time.After(3 * time.Second):
			// Fall through to kill
		}
	}

	// Force kill
	e.Cmd.Process.Kill()
	e.Cmd.Wait()
}

// MustStart starts the daemon and fails the test if it doesn't start.
func (e *TestEnv) MustStart() {
	if err := e.Start(); err != nil {
		e.T.Fatalf("Failed to start daemon: %v", err)
	}
}

// CreateMockBd creates a mock bd script for testing.
func (e *TestEnv) CreateMockBd(script string) string {
	mockBd := filepath.Join(e.TmpDir, "mock-bd")
	if err := os.WriteFile(mockBd, []byte(script), 0755); err != nil {
		e.T.Fatalf("Failed to create mock bd: %v", err)
	}
	return mockBd
}

// WriteFile writes content to a file in the test workspace.
func (e *TestEnv) WriteFile(relPath, content string) {
	path := filepath.Join(e.TmpDir, relPath)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		e.T.Fatalf("Failed to create directory: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		e.T.Fatalf("Failed to write file: %v", err)
	}
}

// ReadFile reads a file from the test workspace.
func (e *TestEnv) ReadFile(relPath string) string {
	path := filepath.Join(e.TmpDir, relPath)
	data, err := os.ReadFile(path)
	if err != nil {
		e.T.Fatalf("Failed to read file: %v", err)
	}
	return string(data)
}

// FileExists checks if a file exists in the test workspace.
func (e *TestEnv) FileExists(relPath string) bool {
	path := filepath.Join(e.TmpDir, relPath)
	_, err := os.Stat(path)
	return err == nil
}
