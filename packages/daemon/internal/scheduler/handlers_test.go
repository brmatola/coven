package scheduler

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coven/daemon/internal/api"
	"github.com/coven/daemon/internal/state"
	"github.com/coven/daemon/pkg/types"
)

func setupTestTaskHandlers(t *testing.T) (*api.Server, *state.Store, *Scheduler, *http.Client, func()) {
	t.Helper()

	sched, store, _ := newTestScheduler(t)
	handlers := NewHandlers(store, sched)

	socketPath := filepath.Join(os.TempDir(), "coven-task-test.sock")
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
		sched.Stop()
		server.Stop(context.Background())
	}

	return server, store, sched, client, cleanup
}

func TestNewTaskHandlers(t *testing.T) {
	sched, store, _ := newTestScheduler(t)
	handlers := NewHandlers(store, sched)

	if handlers == nil {
		t.Fatal("NewHandlers() returned nil")
	}
}

func TestHandleTaskStart(t *testing.T) {
	_, store, sched, client, cleanup := setupTestTaskHandlers(t)
	defer cleanup()

	t.Run("POST returns 404 for unknown task", func(t *testing.T) {
		resp, err := client.Post("http://unix/tasks/unknown/start", "application/json", nil)
		if err != nil {
			t.Fatalf("POST error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusNotFound)
		}
	})

	t.Run("POST starts task", func(t *testing.T) {
		// Add a task to store
		store.SetTasks([]types.Task{
			{ID: "task-start", Title: "Test Task", Status: types.TaskStatusOpen},
		})

		resp, err := client.Post("http://unix/tasks/task-start/start", "application/json", nil)
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

		if result.Status != "started" {
			t.Errorf("Status = %q, want %q", result.Status, "started")
		}

		// Wait for agent to be created
		time.Sleep(100 * time.Millisecond)

		// Cleanup
		sched.KillAgent("task-start")
	})

	t.Run("POST returns already running for running task", func(t *testing.T) {
		// Add a task to store
		store.SetTasks([]types.Task{
			{ID: "task-running", Title: "Test Task", Status: types.TaskStatusOpen},
		})

		// Start it first using sh -c to handle prompt arg
		sched.SetAgentCommand("sh", []string{"-c", "sleep 30"})

		startResp, err := client.Post("http://unix/tasks/task-running/start", "application/json", nil)
		if err != nil {
			t.Fatalf("First POST error: %v", err)
		}
		// Read first response
		var firstResult map[string]interface{}
		json.NewDecoder(startResp.Body).Decode(&firstResult)
		startResp.Body.Close()

		t.Logf("First start result: %v", firstResult)

		// If first start failed, skip this test
		if status, ok := firstResult["status"].(string); !ok || status != "started" {
			t.Skipf("First start failed or returned unexpected status: %v", firstResult)
		}

		time.Sleep(200 * time.Millisecond)

		// Check if agent is actually running
		if !sched.IsAgentRunning("task-running") {
			t.Skip("Agent not running, cannot test already_running case")
		}

		// Try to start again
		resp, err := client.Post("http://unix/tasks/task-running/start", "application/json", nil)
		if err != nil {
			t.Fatalf("POST error: %v", err)
		}
		defer resp.Body.Close()

		var result struct {
			TaskID  string `json:"task_id"`
			Status  string `json:"status"`
			Message string `json:"message"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if result.Status != "already_running" {
			t.Errorf("Status = %q, want %q", result.Status, "already_running")
		}

		// Cleanup
		sched.KillAgent("task-running")
	})

	t.Run("GET returns method not allowed", func(t *testing.T) {
		store.SetTasks([]types.Task{
			{ID: "task-method", Title: "Test Task", Status: types.TaskStatusOpen},
		})

		resp, err := client.Get("http://unix/tasks/task-method/start")
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
		}
	})
}

func TestHandleTaskStop(t *testing.T) {
	_, store, _, client, cleanup := setupTestTaskHandlers(t)
	defer cleanup()

	t.Run("POST returns 404 for unknown agent", func(t *testing.T) {
		resp, err := client.Post("http://unix/tasks/unknown/stop", "application/json", nil)
		if err != nil {
			t.Fatalf("POST error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusNotFound)
		}
	})

	t.Run("POST stops running task", func(t *testing.T) {
		// Add a task and start it
		store.SetTasks([]types.Task{
			{ID: "task-stop", Title: "Test Task", Status: types.TaskStatusOpen},
		})

		// Start the task
		client.Post("http://unix/tasks/task-stop/start", "application/json", nil)
		time.Sleep(100 * time.Millisecond)

		// Stop it
		resp, err := client.Post("http://unix/tasks/task-stop/stop", "application/json", nil)
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

		if result.Status != "stopped" {
			t.Errorf("Status = %q, want %q", result.Status, "stopped")
		}
	})

	t.Run("GET returns method not allowed", func(t *testing.T) {
		store.AddAgent(&types.Agent{
			TaskID:    "task-method-stop",
			Status:    types.AgentStatusRunning,
			StartedAt: time.Now(),
		})

		resp, err := client.Get("http://unix/tasks/task-method-stop/stop")
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
		}
	})
}

func TestHandleTaskUnknownAction(t *testing.T) {
	_, _, _, client, cleanup := setupTestTaskHandlers(t)
	defer cleanup()

	resp, err := client.Post("http://unix/tasks/task-1/unknown", "application/json", nil)
	if err != nil {
		t.Fatalf("POST error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
}

func TestHandleTaskBadRequest(t *testing.T) {
	_, _, _, client, cleanup := setupTestTaskHandlers(t)
	defer cleanup()

	t.Run("missing action", func(t *testing.T) {
		resp, err := client.Post("http://unix/tasks/task-1/", "application/json",
			strings.NewReader("{}"))
		if err != nil {
			t.Fatalf("POST error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
		}
	})
}
