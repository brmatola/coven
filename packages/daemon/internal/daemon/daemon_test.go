package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coven/daemon/internal/api"
)

// testCounter provides unique IDs for test directories
var testCounter int64

// shortTempDir creates a temp directory with a short path to avoid macOS Unix socket path length limits.
// Unix socket paths are limited to ~104 bytes on macOS.
func shortTempDir(t *testing.T) string {
	t.Helper()
	id := atomic.AddInt64(&testCounter, 1)
	dir := filepath.Join("/tmp", fmt.Sprintf("cvn-%d-%d", os.Getpid(), id))
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	t.Cleanup(func() {
		os.RemoveAll(dir)
	})
	return dir
}

func TestNew(t *testing.T) {
	tmpDir := shortTempDir(t)

	d, err := New(tmpDir, "1.0.0")
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	if d.Workspace() != tmpDir {
		t.Errorf("Workspace() = %q, want %q", d.Workspace(), tmpDir)
	}
	if d.Version() != "1.0.0" {
		t.Errorf("Version() = %q, want %q", d.Version(), "1.0.0")
	}

	// .coven directory should exist
	covenDir := filepath.Join(tmpDir, ".coven")
	if _, err := os.Stat(covenDir); os.IsNotExist(err) {
		t.Error(".coven directory was not created")
	}
}

func TestNewWithExistingCovenDir(t *testing.T) {
	tmpDir := shortTempDir(t)
	covenDir := filepath.Join(tmpDir, ".coven")

	// Create .coven directory ahead of time
	if err := os.MkdirAll(covenDir, 0755); err != nil {
		t.Fatalf("Failed to create .coven: %v", err)
	}

	d, err := New(tmpDir, "1.0.0")
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	if d == nil {
		t.Fatal("New() returned nil")
	}
}

func TestDaemonRunAndShutdown(t *testing.T) {
	tmpDir := shortTempDir(t)

	d, err := New(tmpDir, "1.0.0")
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)

	// Run daemon in background
	go func() {
		errCh <- d.Run(ctx)
	}()

	// Wait for server to start
	time.Sleep(100 * time.Millisecond)

	// Trigger shutdown via context
	cancel()

	select {
	case err := <-errCh:
		if err != nil {
			t.Errorf("Run() error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Error("Daemon did not shut down in time")
	}
}

func TestDaemonShutdownMethod(t *testing.T) {
	tmpDir := shortTempDir(t)

	d, err := New(tmpDir, "1.0.0")
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	errCh := make(chan error, 1)

	// Run daemon in background
	go func() {
		errCh <- d.Run(context.Background())
	}()

	// Wait for server to start
	time.Sleep(100 * time.Millisecond)

	// Trigger shutdown via method
	d.Shutdown()

	select {
	case err := <-errCh:
		if err != nil {
			t.Errorf("Run() error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Error("Daemon did not shut down in time")
	}
}

func TestDaemonHealthEndpoint(t *testing.T) {
	tmpDir := shortTempDir(t)

	d, err := New(tmpDir, "1.0.0")
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- d.Run(ctx)
	}()

	// Wait for server to start
	time.Sleep(100 * time.Millisecond)

	// Create Unix socket client
	socketPath := filepath.Join(tmpDir, ".coven", "covend.sock")
	client := &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return net.Dial("unix", socketPath)
			},
		},
	}

	resp, err := client.Get("http://unix/health")
	if err != nil {
		t.Fatalf("GET /health error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var health api.HealthResponse
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if health.Status != "healthy" {
		t.Errorf("Status = %q, want %q", health.Status, "healthy")
	}
	if health.Version != "1.0.0" {
		t.Errorf("Version = %q, want %q", health.Version, "1.0.0")
	}
	if health.Workspace != tmpDir {
		t.Errorf("Workspace = %q, want %q", health.Workspace, tmpDir)
	}

	cancel()
	<-errCh
}

func TestDaemonShutdownEndpoint(t *testing.T) {
	tmpDir := shortTempDir(t)

	d, err := New(tmpDir, "1.0.0")
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- d.Run(context.Background())
	}()

	// Wait for server to start
	time.Sleep(100 * time.Millisecond)

	// Create Unix socket client
	socketPath := filepath.Join(tmpDir, ".coven", "covend.sock")
	client := &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return net.Dial("unix", socketPath)
			},
		},
	}

	// GET should fail
	resp, err := client.Get("http://unix/shutdown")
	if err != nil {
		t.Fatalf("GET /shutdown error: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("GET Status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
	}

	// POST should trigger shutdown
	resp, err = client.Post("http://unix/shutdown", "application/json", nil)
	if err != nil {
		t.Fatalf("POST /shutdown error: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("POST Status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	// Wait for daemon to stop
	select {
	case err := <-errCh:
		if err != nil {
			t.Errorf("Run() error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Error("Daemon did not shut down in time")
	}
}

func TestDaemonPIDFile(t *testing.T) {
	tmpDir := shortTempDir(t)

	d, err := New(tmpDir, "1.0.0")
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() {
		errCh <- d.Run(ctx)
	}()

	// Wait for server to start
	time.Sleep(100 * time.Millisecond)

	// PID file should exist
	pidPath := filepath.Join(tmpDir, ".coven", "covend.pid")
	data, err := os.ReadFile(pidPath)
	if err != nil {
		t.Fatalf("Failed to read PID file: %v", err)
	}

	// Should contain our PID
	if len(data) == 0 {
		t.Error("PID file is empty")
	}

	cancel()
	<-errCh

	// PID file should be removed after shutdown
	if _, err := os.Stat(pidPath); !os.IsNotExist(err) {
		t.Error("PID file should be removed after shutdown")
	}
}

func TestDaemonAlreadyRunning(t *testing.T) {
	tmpDir := shortTempDir(t)

	d1, err := New(tmpDir, "1.0.0")
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- d1.Run(ctx)
	}()

	// Wait for first daemon to start
	time.Sleep(100 * time.Millisecond)

	// Try to start second daemon
	d2, err := New(tmpDir, "1.0.0")
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	err = d2.Run(context.Background())
	if err == nil {
		t.Error("Second daemon should fail to start")
	}

	cancel()
	<-errCh
}

func TestDaemonCleansStaleSocket(t *testing.T) {
	tmpDir := shortTempDir(t)
	covenDir := filepath.Join(tmpDir, ".coven")
	if err := os.MkdirAll(covenDir, 0755); err != nil {
		t.Fatalf("Failed to create .coven: %v", err)
	}

	// Create a stale PID file with non-existent PID
	pidPath := filepath.Join(covenDir, "covend.pid")
	// Use a very high PID that doesn't exist
	if err := os.WriteFile(pidPath, []byte("999999999\n"), 0644); err != nil {
		t.Fatalf("Failed to write PID file: %v", err)
	}

	// Create a stale socket file
	socketPath := filepath.Join(covenDir, "covend.sock")
	if err := os.WriteFile(socketPath, []byte("stale"), 0644); err != nil {
		t.Fatalf("Failed to write socket file: %v", err)
	}

	d, err := New(tmpDir, "1.0.0")
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() {
		errCh <- d.Run(ctx)
	}()

	// Wait for server to start
	time.Sleep(100 * time.Millisecond)

	// Daemon should be running (stale socket was cleaned)
	socketPath = filepath.Join(covenDir, "covend.sock")
	info, err := os.Stat(socketPath)
	if err != nil {
		t.Fatalf("Socket should exist: %v", err)
	}
	// Should be a socket, not a regular file
	if info.Mode()&os.ModeSocket == 0 {
		t.Error("Socket file should be a socket, not a regular file")
	}

	cancel()
	<-errCh
}

func TestDaemonConfig(t *testing.T) {
	tmpDir := shortTempDir(t)

	d, err := New(tmpDir, "1.0.0")
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	cfg := d.Config()
	if cfg == nil {
		t.Fatal("Config() returned nil")
	}

	// Should have default values
	if cfg.PollInterval != 1 {
		t.Errorf("PollInterval = %d, want 1", cfg.PollInterval)
	}
}

func TestDaemonWithCustomConfig(t *testing.T) {
	tmpDir := shortTempDir(t)
	covenDir := filepath.Join(tmpDir, ".coven")
	if err := os.MkdirAll(covenDir, 0755); err != nil {
		t.Fatalf("Failed to create .coven: %v", err)
	}

	// Write custom config
	configPath := filepath.Join(covenDir, "config.json")
	configJSON := `{"poll_interval": 5}`
	if err := os.WriteFile(configPath, []byte(configJSON), 0644); err != nil {
		t.Fatalf("Failed to write config: %v", err)
	}

	d, err := New(tmpDir, "1.0.0")
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	cfg := d.Config()
	if cfg.PollInterval != 5 {
		t.Errorf("PollInterval = %d, want 5", cfg.PollInterval)
	}
}

func TestCleanStaleInvalidPIDFile(t *testing.T) {
	tmpDir := shortTempDir(t)
	covenDir := filepath.Join(tmpDir, ".coven")
	if err := os.MkdirAll(covenDir, 0755); err != nil {
		t.Fatalf("Failed to create .coven: %v", err)
	}

	// Create an invalid PID file (not a number)
	pidPath := filepath.Join(covenDir, "covend.pid")
	if err := os.WriteFile(pidPath, []byte("not-a-number\n"), 0644); err != nil {
		t.Fatalf("Failed to write PID file: %v", err)
	}

	d, err := New(tmpDir, "1.0.0")
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() {
		errCh <- d.Run(ctx)
	}()

	time.Sleep(100 * time.Millisecond)

	// Should have started successfully after cleaning invalid PID file
	cancel()
	err = <-errCh
	if err != nil {
		t.Errorf("Run() error: %v", err)
	}
}

func TestNewInvalidLogPath(t *testing.T) {
	// This tests the error case when the log file can't be created
	tmpDir := shortTempDir(t)
	covenDir := filepath.Join(tmpDir, ".coven")
	if err := os.MkdirAll(covenDir, 0755); err != nil {
		t.Fatalf("Failed to create .coven: %v", err)
	}

	// Create log file as a directory to cause an error
	logPath := filepath.Join(covenDir, "covend.log")
	if err := os.MkdirAll(logPath, 0755); err != nil {
		t.Fatalf("Failed to create log dir: %v", err)
	}

	_, err := New(tmpDir, "1.0.0")
	if err == nil {
		t.Error("New() should fail when log path is a directory")
	}
}
