package api

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"runtime"
	"testing"
	"time"

	"github.com/coven/daemon/internal/state"
	"github.com/coven/daemon/pkg/types"
)

func setupTestServer(t *testing.T) (*Server, *Handlers, *http.Client, func()) {
	t.Helper()

	tmpDir := t.TempDir()
	store := state.NewStore(tmpDir)

	socketPath := "/tmp/coven-handlers-test.sock"
	server := NewServer(socketPath)

	handlers := NewHandlers(store, "1.0.0", "abc123", "2024-01-01T00:00:00Z", tmpDir)
	handlers.Register(server)

	if err := server.Start(); err != nil {
		t.Fatalf("Failed to start server: %v", err)
	}

	client := &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return net.Dial("unix", socketPath)
			},
		},
	}

	cleanup := func() {
		server.Stop(context.Background())
	}

	return server, handlers, client, cleanup
}

func TestHandleHealth(t *testing.T) {
	_, _, client, cleanup := setupTestServer(t)
	defer cleanup()

	t.Run("GET returns health status", func(t *testing.T) {
		resp, err := client.Get("http://unix/health")
		if err != nil {
			t.Fatalf("GET /health error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
		}

		var health types.HealthStatus
		if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if health.Status != "healthy" {
			t.Errorf("Status = %q, want %q", health.Status, "healthy")
		}
		if health.Version != "1.0.0" {
			t.Errorf("Version = %q, want %q", health.Version, "1.0.0")
		}
	})

	t.Run("POST returns method not allowed", func(t *testing.T) {
		resp, err := client.Post("http://unix/health", "application/json", nil)
		if err != nil {
			t.Fatalf("POST /health error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
		}
	})
}

func TestHandleVersion(t *testing.T) {
	_, _, client, cleanup := setupTestServer(t)
	defer cleanup()

	t.Run("GET returns version info", func(t *testing.T) {
		resp, err := client.Get("http://unix/version")
		if err != nil {
			t.Fatalf("GET /version error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
		}

		var version types.VersionInfo
		if err := json.NewDecoder(resp.Body).Decode(&version); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if version.Version != "1.0.0" {
			t.Errorf("Version = %q, want %q", version.Version, "1.0.0")
		}
		if version.GitCommit != "abc123" {
			t.Errorf("GitCommit = %q, want %q", version.GitCommit, "abc123")
		}
		if version.GoVersion != runtime.Version() {
			t.Errorf("GoVersion = %q, want %q", version.GoVersion, runtime.Version())
		}
	})

	t.Run("POST returns method not allowed", func(t *testing.T) {
		resp, err := client.Post("http://unix/version", "application/json", nil)
		if err != nil {
			t.Fatalf("POST /version error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
		}
	})
}

func TestHandleState(t *testing.T) {
	_, handlers, client, cleanup := setupTestServer(t)
	defer cleanup()

	t.Run("GET returns empty state", func(t *testing.T) {
		resp, err := client.Get("http://unix/state")
		if err != nil {
			t.Fatalf("GET /state error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
		}

		var stateResp types.StateResponse
		if err := json.NewDecoder(resp.Body).Decode(&stateResp); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if stateResp.State == nil {
			t.Fatal("State should not be nil")
		}
		if stateResp.State.Agents == nil {
			t.Error("State.Agents should be initialized")
		}
	})

	t.Run("GET returns state with agents", func(t *testing.T) {
		// Add some state
		handlers.store.AddAgent(&types.Agent{
			TaskID:    "task-1",
			PID:       1234,
			Status:    types.AgentStatusRunning,
			StartedAt: time.Now(),
		})
		handlers.store.SetTasks([]types.Task{
			{ID: "task-1", Title: "Test Task", Status: types.TaskStatusOpen},
		})

		resp, err := client.Get("http://unix/state")
		if err != nil {
			t.Fatalf("GET /state error: %v", err)
		}
		defer resp.Body.Close()

		var stateResp types.StateResponse
		if err := json.NewDecoder(resp.Body).Decode(&stateResp); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if len(stateResp.State.Agents) != 1 {
			t.Errorf("Agents count = %d, want 1", len(stateResp.State.Agents))
		}
		if len(stateResp.State.Tasks) != 1 {
			t.Errorf("Tasks count = %d, want 1", len(stateResp.State.Tasks))
		}
	})

	t.Run("POST returns method not allowed", func(t *testing.T) {
		resp, err := client.Post("http://unix/state", "application/json", nil)
		if err != nil {
			t.Fatalf("POST /state error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
		}
	})
}

func TestNewHandlers(t *testing.T) {
	tmpDir := t.TempDir()
	store := state.NewStore(tmpDir)

	handlers := NewHandlers(store, "2.0.0", "def456", "2024-06-01T00:00:00Z", "/workspace")

	if handlers == nil {
		t.Fatal("NewHandlers() returned nil")
	}
	if handlers.version != "2.0.0" {
		t.Errorf("version = %q, want %q", handlers.version, "2.0.0")
	}
	if handlers.gitCommit != "def456" {
		t.Errorf("gitCommit = %q, want %q", handlers.gitCommit, "def456")
	}
	if handlers.workspace != "/workspace" {
		t.Errorf("workspace = %q, want %q", handlers.workspace, "/workspace")
	}
}
