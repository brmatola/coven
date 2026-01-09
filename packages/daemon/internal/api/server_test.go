package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNewServer(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "test.sock")
	server := NewServer(socketPath)

	if server == nil {
		t.Fatal("NewServer returned nil")
	}
	if server.SocketPath() != socketPath {
		t.Errorf("SocketPath() = %q, want %q", server.SocketPath(), socketPath)
	}
	if server.IsRunning() {
		t.Error("IsRunning() = true before Start()")
	}
}

func TestServerStartStop(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "test.sock")
	server := NewServer(socketPath)

	// Start server
	if err := server.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	if !server.IsRunning() {
		t.Error("IsRunning() = false after Start()")
	}

	// Verify socket file exists
	if _, err := os.Stat(socketPath); os.IsNotExist(err) {
		t.Error("Socket file was not created")
	}

	// Starting again should fail
	if err := server.Start(); err == nil {
		t.Error("Start() should fail when already running")
	}

	// Stop server
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Stop(ctx); err != nil {
		t.Fatalf("Stop() error: %v", err)
	}

	if server.IsRunning() {
		t.Error("IsRunning() = true after Stop()")
	}

	// Socket file should be removed
	if _, err := os.Stat(socketPath); !os.IsNotExist(err) {
		t.Error("Socket file was not removed after Stop()")
	}

	// Stopping again should be a no-op
	if err := server.Stop(ctx); err != nil {
		t.Errorf("Stop() on stopped server: %v", err)
	}
}

func TestServerRemovesExistingSocket(t *testing.T) {
	// Use /tmp directly to avoid macOS temp path length issues with Unix sockets
	socketPath := filepath.Join("/tmp", fmt.Sprintf("coven-test-%d.sock", os.Getpid()))
	defer os.Remove(socketPath)

	// Create a stale socket by starting and stopping a server
	staleServer := NewServer(socketPath)
	if err := staleServer.Start(); err != nil {
		t.Fatalf("Failed to create stale socket: %v", err)
	}
	// Force close without cleanup to simulate crash
	staleServer.mu.Lock()
	staleServer.listener.Close()
	staleServer.running = false
	staleServer.mu.Unlock()
	// Socket file still exists as stale

	server := NewServer(socketPath)
	if err := server.Start(); err != nil {
		t.Fatalf("Start() should remove stale socket: %v", err)
	}
	defer server.Stop(context.Background())

	if !server.IsRunning() {
		t.Error("Server should be running after Start()")
	}
}

func TestServerHandlers(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "test.sock")
	server := NewServer(socketPath)

	// Register handlers
	server.RegisterHandlerFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		WriteJSON(w, http.StatusOK, map[string]string{"status": "healthy"})
	})

	server.RegisterHandler("/custom", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	if err := server.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	defer server.Stop(context.Background())

	// Create Unix socket client
	client := &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return net.Dial("unix", socketPath)
			},
		},
	}

	t.Run("health endpoint", func(t *testing.T) {
		resp, err := client.Get("http://unix/health")
		if err != nil {
			t.Fatalf("GET /health error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
		}

		if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type = %q, want %q", ct, "application/json")
		}

		var result map[string]string
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatalf("Failed to decode response: %v", err)
		}
		if result["status"] != "healthy" {
			t.Errorf("status = %q, want %q", result["status"], "healthy")
		}
	})

	t.Run("custom endpoint", func(t *testing.T) {
		resp, err := client.Get("http://unix/custom")
		if err != nil {
			t.Fatalf("GET /custom error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusNoContent {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusNoContent)
		}
	})
}

func TestWriteJSON(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "test.sock")
	server := NewServer(socketPath)

	type testData struct {
		Name  string `json:"name"`
		Value int    `json:"value"`
	}

	server.RegisterHandlerFunc("/test", func(w http.ResponseWriter, r *http.Request) {
		WriteJSON(w, http.StatusCreated, testData{Name: "test", Value: 42})
	})

	if err := server.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	defer server.Stop(context.Background())

	client := &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return net.Dial("unix", socketPath)
			},
		},
	}

	resp, err := client.Get("http://unix/test")
	if err != nil {
		t.Fatalf("Request error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}

	var result testData
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("Decode error: %v", err)
	}

	if result.Name != "test" || result.Value != 42 {
		t.Errorf("Result = %+v, want {Name:test Value:42}", result)
	}
}

func TestWriteError(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "test.sock")
	server := NewServer(socketPath)

	server.RegisterHandlerFunc("/error", func(w http.ResponseWriter, r *http.Request) {
		WriteError(w, http.StatusBadRequest, "invalid request")
	})

	if err := server.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	defer server.Stop(context.Background())

	client := &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return net.Dial("unix", socketPath)
			},
		},
	}

	resp, err := client.Get("http://unix/error")
	if err != nil {
		t.Fatalf("Request error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}

	body, _ := io.ReadAll(resp.Body)
	var result map[string]string
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("Decode error: %v", err)
	}

	if result["error"] != "invalid request" {
		t.Errorf("error = %q, want %q", result["error"], "invalid request")
	}
}

func TestServerSocketPermissions(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "test.sock")
	server := NewServer(socketPath)

	if err := server.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	defer server.Stop(context.Background())

	info, err := os.Stat(socketPath)
	if err != nil {
		t.Fatalf("Stat() error: %v", err)
	}

	// Socket should be owner read/write only (0600)
	mode := info.Mode().Perm()
	if mode != 0600 {
		t.Errorf("Socket permissions = %o, want 0600", mode)
	}
}
