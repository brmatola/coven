package session

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"testing"

	"github.com/coven/daemon/internal/api"
	"github.com/coven/daemon/internal/logging"
	"github.com/coven/daemon/internal/state"
)

func setupTestHandlers(t *testing.T) (*api.Server, *Handlers, *http.Client, func()) {
	t.Helper()

	tmpDir := t.TempDir()
	store := state.NewStore(tmpDir)

	logPath := tmpDir + "/test.log"
	logger, err := logging.New(logPath)
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}

	manager := NewManager(store, logger)
	handlers := NewHandlers(manager)

	socketPath := "/tmp/coven-session-test.sock"
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
		logger.Close()
	}

	return server, handlers, client, cleanup
}

func TestHandleStart(t *testing.T) {
	_, _, client, cleanup := setupTestHandlers(t)
	defer cleanup()

	t.Run("POST starts session", func(t *testing.T) {
		resp, err := client.Post("http://unix/session/start", "application/json", nil)
		if err != nil {
			t.Fatalf("POST error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
		}

		var result StartResponse
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if result.Status != "started" {
			t.Errorf("Status = %q, want %q", result.Status, "started")
		}
	})

	t.Run("POST again returns conflict", func(t *testing.T) {
		resp, err := client.Post("http://unix/session/start", "application/json", nil)
		if err != nil {
			t.Fatalf("POST error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusConflict {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusConflict)
		}
	})

	t.Run("GET returns method not allowed", func(t *testing.T) {
		resp, err := client.Get("http://unix/session/start")
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
		}
	})
}

func TestHandleStop(t *testing.T) {
	_, _, client, cleanup := setupTestHandlers(t)
	defer cleanup()

	t.Run("POST without session returns conflict", func(t *testing.T) {
		resp, err := client.Post("http://unix/session/stop", "application/json", nil)
		if err != nil {
			t.Fatalf("POST error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusConflict {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusConflict)
		}
	})

	// Start a session first
	resp, err := client.Post("http://unix/session/start", "application/json", nil)
	if err != nil {
		t.Fatalf("Start error: %v", err)
	}
	resp.Body.Close()

	t.Run("POST stops session", func(t *testing.T) {
		resp, err := client.Post("http://unix/session/stop", "application/json", nil)
		if err != nil {
			t.Fatalf("POST error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
		}

		var result StopResponse
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if result.Status != "stopped" {
			t.Errorf("Status = %q, want %q", result.Status, "stopped")
		}
		if result.Forced {
			t.Error("Forced should be false for graceful stop")
		}
	})

	t.Run("GET returns method not allowed", func(t *testing.T) {
		resp, err := client.Get("http://unix/session/stop")
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
		}
	})
}

func TestHandleStopForce(t *testing.T) {
	_, _, client, cleanup := setupTestHandlers(t)
	defer cleanup()

	// Start a session
	resp, err := client.Post("http://unix/session/start", "application/json", nil)
	if err != nil {
		t.Fatalf("Start error: %v", err)
	}
	resp.Body.Close()

	// Force stop
	body := bytes.NewBufferString(`{"force": true}`)
	resp, err = client.Post("http://unix/session/stop", "application/json", body)
	if err != nil {
		t.Fatalf("POST error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var result StopResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("Decode error: %v", err)
	}

	if !result.Forced {
		t.Error("Forced should be true for force stop")
	}
}

func TestHandleStopWithTimeout(t *testing.T) {
	_, _, client, cleanup := setupTestHandlers(t)
	defer cleanup()

	// Start a session
	resp, err := client.Post("http://unix/session/start", "application/json", nil)
	if err != nil {
		t.Fatalf("Start error: %v", err)
	}
	resp.Body.Close()

	// Stop with custom timeout
	body := bytes.NewBufferString(`{"timeout": 5}`)
	resp, err = client.Post("http://unix/session/stop", "application/json", body)
	if err != nil {
		t.Fatalf("POST error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
}

func TestHandleStopInvalidBody(t *testing.T) {
	_, _, client, cleanup := setupTestHandlers(t)
	defer cleanup()

	// Start a session
	resp, err := client.Post("http://unix/session/start", "application/json", nil)
	if err != nil {
		t.Fatalf("Start error: %v", err)
	}
	resp.Body.Close()

	// Invalid JSON
	body := bytes.NewBufferString(`{invalid}`)
	resp, err = client.Post("http://unix/session/stop", "application/json", body)
	if err != nil {
		t.Fatalf("POST error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
}

func TestHandleStatus(t *testing.T) {
	_, _, client, cleanup := setupTestHandlers(t)
	defer cleanup()

	t.Run("GET returns inactive status", func(t *testing.T) {
		resp, err := client.Get("http://unix/session/status")
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
		}

		var result struct {
			Active   bool   `json:"active"`
			Stopping bool   `json:"stopping"`
			Status   string `json:"status"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if result.Active {
			t.Error("Active should be false")
		}
		if result.Status != "inactive" {
			t.Errorf("Status = %q, want %q", result.Status, "inactive")
		}
	})

	// Start session
	resp, _ := client.Post("http://unix/session/start", "application/json", nil)
	resp.Body.Close()

	t.Run("GET returns active status", func(t *testing.T) {
		resp, err := client.Get("http://unix/session/status")
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		var result struct {
			Active   bool   `json:"active"`
			Stopping bool   `json:"stopping"`
			Status   string `json:"status"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if !result.Active {
			t.Error("Active should be true")
		}
		if result.Status != "active" {
			t.Errorf("Status = %q, want %q", result.Status, "active")
		}
	})

	t.Run("POST returns method not allowed", func(t *testing.T) {
		resp, err := client.Post("http://unix/session/status", "application/json", nil)
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
	logger, _ := logging.New(tmpDir + "/test.log")
	defer logger.Close()

	manager := NewManager(store, logger)
	handlers := NewHandlers(manager)

	if handlers == nil {
		t.Fatal("NewHandlers() returned nil")
	}
}
