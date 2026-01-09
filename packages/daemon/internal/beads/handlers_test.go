package beads

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"testing"

	"github.com/coven/daemon/internal/api"
	"github.com/coven/daemon/internal/state"
	"github.com/coven/daemon/pkg/types"
)

func setupTestHandlers(t *testing.T) (*api.Server, *state.Store, *http.Client, func()) {
	t.Helper()

	tmpDir := t.TempDir()
	store := state.NewStore(tmpDir)

	handlers := NewHandlers(store)

	socketPath := "/tmp/coven-beads-test.sock"
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

	return server, store, client, cleanup
}

func TestHandleTasks(t *testing.T) {
	_, store, client, cleanup := setupTestHandlers(t)
	defer cleanup()

	t.Run("GET returns empty tasks", func(t *testing.T) {
		resp, err := client.Get("http://unix/tasks")
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
		}

		var result struct {
			Tasks    []types.Task `json:"tasks"`
			Count    int          `json:"count"`
			LastSync any          `json:"last_sync"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if result.Count != 0 {
			t.Errorf("Count = %d, want 0", result.Count)
		}
	})

	t.Run("GET returns tasks after SetTasks", func(t *testing.T) {
		// Add tasks
		store.SetTasks([]types.Task{
			{ID: "task-1", Title: "Task 1", Status: types.TaskStatusOpen},
			{ID: "task-2", Title: "Task 2", Status: types.TaskStatusInProgress},
		})

		resp, err := client.Get("http://unix/tasks")
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		var result struct {
			Tasks    []types.Task `json:"tasks"`
			Count    int          `json:"count"`
			LastSync any          `json:"last_sync"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if result.Count != 2 {
			t.Errorf("Count = %d, want 2", result.Count)
		}
		if len(result.Tasks) != 2 {
			t.Errorf("Tasks length = %d, want 2", len(result.Tasks))
		}
		if result.LastSync == nil {
			t.Error("LastSync should be set")
		}
	})

	t.Run("POST returns method not allowed", func(t *testing.T) {
		resp, err := client.Post("http://unix/tasks", "application/json", nil)
		if err != nil {
			t.Fatalf("POST error: %v", err)
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
	handlers := NewHandlers(store)

	if handlers == nil {
		t.Fatal("NewHandlers() returned nil")
	}
}
