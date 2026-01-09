package agent

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coven/daemon/internal/api"
	"github.com/coven/daemon/internal/logging"
	"github.com/coven/daemon/internal/state"
	"github.com/coven/daemon/pkg/types"
)

func setupTestHandlers(t *testing.T) (*api.Server, *state.Store, *ProcessManager, *http.Client, func()) {
	t.Helper()

	tmpDir := t.TempDir()
	store := state.NewStore(tmpDir)

	logPath := filepath.Join(tmpDir, "test.log")
	logger, err := logging.New(logPath)
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}
	t.Cleanup(func() { logger.Close() })

	processManager := NewProcessManager(logger)
	handlers := NewHandlers(store, processManager)

	socketPath := "/tmp/coven-agent-test.sock"
	server := api.NewServer(socketPath)
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

	return server, store, processManager, client, cleanup
}

func TestNewHandlers(t *testing.T) {
	tmpDir := t.TempDir()
	store := state.NewStore(tmpDir)

	logPath := filepath.Join(tmpDir, "test.log")
	logger, _ := logging.New(logPath)
	defer logger.Close()

	pm := NewProcessManager(logger)
	handlers := NewHandlers(store, pm)

	if handlers == nil {
		t.Fatal("NewHandlers() returned nil")
	}
}

func TestHandleAgents(t *testing.T) {
	_, store, _, client, cleanup := setupTestHandlers(t)
	defer cleanup()

	t.Run("GET returns empty agents", func(t *testing.T) {
		resp, err := client.Get("http://unix/agents")
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
		}

		var result struct {
			Agents []*types.Agent `json:"agents"`
			Count  int            `json:"count"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if result.Count != 0 {
			t.Errorf("Count = %d, want 0", result.Count)
		}
	})

	t.Run("GET returns agents after adding", func(t *testing.T) {
		store.AddAgent(&types.Agent{
			TaskID:    "task-1",
			Status:    types.AgentStatusRunning,
			StartedAt: time.Now(),
		})

		resp, err := client.Get("http://unix/agents")
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		var result struct {
			Agents []*types.Agent `json:"agents"`
			Count  int            `json:"count"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if result.Count != 1 {
			t.Errorf("Count = %d, want 1", result.Count)
		}
	})

	t.Run("POST returns method not allowed", func(t *testing.T) {
		resp, err := client.Post("http://unix/agents", "application/json", nil)
		if err != nil {
			t.Fatalf("POST error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
		}
	})
}

func TestHandleGetAgent(t *testing.T) {
	_, store, _, client, cleanup := setupTestHandlers(t)
	defer cleanup()

	t.Run("GET returns 404 for unknown agent", func(t *testing.T) {
		resp, err := client.Get("http://unix/agents/unknown")
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusNotFound)
		}
	})

	t.Run("GET returns agent", func(t *testing.T) {
		store.AddAgent(&types.Agent{
			TaskID:    "task-1",
			Status:    types.AgentStatusRunning,
			StartedAt: time.Now(),
		})

		resp, err := client.Get("http://unix/agents/task-1")
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
		}

		var agent types.Agent
		if err := json.NewDecoder(resp.Body).Decode(&agent); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if agent.TaskID != "task-1" {
			t.Errorf("TaskID = %q, want %q", agent.TaskID, "task-1")
		}
	})
}

func TestHandleAgentOutput(t *testing.T) {
	_, store, pm, client, cleanup := setupTestHandlers(t)
	defer cleanup()

	t.Run("GET returns 404 for unknown agent", func(t *testing.T) {
		resp, err := client.Get("http://unix/agents/unknown/output")
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusNotFound)
		}
	})

	t.Run("GET returns output for agent", func(t *testing.T) {
		ctx := context.Background()

		// Spawn a process that generates output
		_, err := pm.Spawn(ctx, SpawnConfig{
			TaskID:  "task-output",
			Command: "echo",
			Args:    []string{"hello", "world"},
		})
		if err != nil {
			t.Fatalf("Spawn error: %v", err)
		}

		// Add to store
		store.AddAgent(&types.Agent{
			TaskID:    "task-output",
			Status:    types.AgentStatusRunning,
			StartedAt: time.Now(),
		})

		// Wait for output
		pm.WaitForCompletion("task-output")

		resp, err := client.Get("http://unix/agents/task-output/output")
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
		}

		var result struct {
			TaskID    string       `json:"task_id"`
			Lines     []OutputLine `json:"lines"`
			LineCount int          `json:"line_count"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if result.TaskID != "task-output" {
			t.Errorf("TaskID = %q, want %q", result.TaskID, "task-output")
		}
	})
}

func TestHandleAgentKill(t *testing.T) {
	_, store, pm, client, cleanup := setupTestHandlers(t)
	defer cleanup()

	t.Run("POST returns 404 for unknown agent", func(t *testing.T) {
		resp, err := client.Post("http://unix/agents/unknown/kill", "application/json", nil)
		if err != nil {
			t.Fatalf("POST error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusNotFound)
		}
	})

	t.Run("POST kills running agent", func(t *testing.T) {
		ctx := context.Background()

		// Spawn a long-running process
		_, err := pm.Spawn(ctx, SpawnConfig{
			TaskID:  "task-kill",
			Command: "sleep",
			Args:    []string{"30"},
		})
		if err != nil {
			t.Fatalf("Spawn error: %v", err)
		}

		// Add to store
		store.AddAgent(&types.Agent{
			TaskID:    "task-kill",
			Status:    types.AgentStatusRunning,
			StartedAt: time.Now(),
		})

		resp, err := client.Post("http://unix/agents/task-kill/kill", "application/json", nil)
		if err != nil {
			t.Fatalf("POST error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
		}

		var result struct {
			TaskID  string `json:"task_id"`
			Status  string `json:"status"`
			Message string `json:"message"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if result.Status != "killed" {
			t.Errorf("Status = %q, want %q", result.Status, "killed")
		}

		// Verify agent is marked as killed in store
		agent := store.GetAgent("task-kill")
		if agent.Status != types.AgentStatusKilled {
			t.Errorf("Agent status = %q, want %q", agent.Status, types.AgentStatusKilled)
		}
	})

	t.Run("GET on kill returns method not allowed", func(t *testing.T) {
		store.AddAgent(&types.Agent{
			TaskID:    "task-method",
			Status:    types.AgentStatusRunning,
			StartedAt: time.Now(),
		})

		resp, err := client.Get("http://unix/agents/task-method/kill")
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
		}
	})
}

func TestHandleAgentRespond(t *testing.T) {
	_, store, _, client, cleanup := setupTestHandlers(t)
	defer cleanup()

	t.Run("POST returns 404 for unknown agent", func(t *testing.T) {
		resp, err := client.Post("http://unix/agents/unknown/respond", "application/json",
			strings.NewReader(`{"response":"test"}`))
		if err != nil {
			t.Fatalf("POST error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusNotFound)
		}
	})

	t.Run("POST without response returns error", func(t *testing.T) {
		store.AddAgent(&types.Agent{
			TaskID:    "task-respond",
			Status:    types.AgentStatusRunning,
			StartedAt: time.Now(),
		})

		resp, err := client.Post("http://unix/agents/task-respond/respond", "application/json",
			strings.NewReader(`{}`))
		if err != nil {
			t.Fatalf("POST error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
		}
	})

	t.Run("POST with response fails when no process running", func(t *testing.T) {
		// Note: This test verifies error handling when there's no actual process.
		// E2E tests cover the full respond flow with a running process.
		store.AddAgent(&types.Agent{
			TaskID:    "task-respond2",
			Status:    types.AgentStatusRunning,
			StartedAt: time.Now(),
		})

		resp, err := client.Post("http://unix/agents/task-respond2/respond", "application/json",
			strings.NewReader(`{"response":"yes, proceed"}`))
		if err != nil {
			t.Fatalf("POST error: %v", err)
		}
		defer resp.Body.Close()

		// Should fail because there's no actual process to write to
		if resp.StatusCode != http.StatusInternalServerError {
			t.Errorf("Status = %d, want %d (no process running)", resp.StatusCode, http.StatusInternalServerError)
		}
	})
}

func TestHandleUnknownAction(t *testing.T) {
	_, store, _, client, cleanup := setupTestHandlers(t)
	defer cleanup()

	store.AddAgent(&types.Agent{
		TaskID:    "task-1",
		Status:    types.AgentStatusRunning,
		StartedAt: time.Now(),
	})

	resp, err := client.Get("http://unix/agents/task-1/unknown")
	if err != nil {
		t.Fatalf("GET error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
}
