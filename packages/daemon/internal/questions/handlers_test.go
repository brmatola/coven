package questions

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/coven/daemon/internal/agent"
	"github.com/coven/daemon/internal/api"
)

func setupTestHandlers(t *testing.T) (*api.Server, *Detector, *http.Client, func()) {
	t.Helper()

	detector := NewDetector()
	handlers := NewHandlers(detector)

	socketPath := filepath.Join(os.TempDir(), "coven-questions-test.sock")
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

	return server, detector, client, cleanup
}

func TestNewHandlers(t *testing.T) {
	detector := NewDetector()
	handlers := NewHandlers(detector)

	if handlers == nil {
		t.Fatal("NewHandlers() returned nil")
	}
}

func TestHandleQuestions(t *testing.T) {
	_, detector, client, cleanup := setupTestHandlers(t)
	defer cleanup()

	t.Run("GET returns empty questions", func(t *testing.T) {
		resp, err := client.Get("http://unix/questions")
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
		}

		var result struct {
			Questions    []*Question `json:"questions"`
			Count        int         `json:"count"`
			PendingCount int         `json:"pending_count"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if result.Count != 0 {
			t.Errorf("Count = %d, want 0", result.Count)
		}
	})

	t.Run("GET returns questions after detection", func(t *testing.T) {
		detector.ProcessLine("task-1", agent.OutputLine{
			Sequence: 1,
			Stream:   "stdout",
			Data:     "Continue with operation?",
		})

		resp, err := client.Get("http://unix/questions")
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		var result struct {
			Questions    []*Question `json:"questions"`
			Count        int         `json:"count"`
			PendingCount int         `json:"pending_count"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if result.Count != 1 {
			t.Errorf("Count = %d, want 1", result.Count)
		}
		if result.PendingCount != 1 {
			t.Errorf("PendingCount = %d, want 1", result.PendingCount)
		}
	})

	t.Run("GET with task_id filter", func(t *testing.T) {
		detector.ProcessLine("task-2", agent.OutputLine{
			Sequence: 2,
			Stream:   "stdout",
			Data:     "Another question?",
		})

		resp, err := client.Get("http://unix/questions?task_id=task-2")
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		var result struct {
			Questions []*Question `json:"questions"`
			Count     int         `json:"count"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if result.Count != 1 {
			t.Errorf("Count = %d, want 1", result.Count)
		}
	})

	t.Run("POST returns method not allowed", func(t *testing.T) {
		resp, err := client.Post("http://unix/questions", "application/json", nil)
		if err != nil {
			t.Fatalf("POST error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
		}
	})
}

func TestHandleGetQuestion(t *testing.T) {
	_, detector, client, cleanup := setupTestHandlers(t)
	defer cleanup()

	t.Run("GET returns 404 for unknown question", func(t *testing.T) {
		resp, err := client.Get("http://unix/questions/unknown")
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusNotFound)
		}
	})

	t.Run("GET returns question by ID", func(t *testing.T) {
		q := detector.ProcessLine("task-1", agent.OutputLine{
			Sequence: 1,
			Stream:   "stdout",
			Data:     "Test question?",
		})

		resp, err := client.Get("http://unix/questions/" + q.ID)
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
		}

		var result Question
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if result.ID != q.ID {
			t.Errorf("ID = %q, want %q", result.ID, q.ID)
		}
	})
}

func TestHandleAnswerQuestion(t *testing.T) {
	_, detector, client, cleanup := setupTestHandlers(t)
	defer cleanup()

	t.Run("POST returns 404 for unknown question", func(t *testing.T) {
		resp, err := client.Post("http://unix/questions/unknown/answer", "application/json",
			strings.NewReader(`{"answer":"yes"}`))
		if err != nil {
			t.Fatalf("POST error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusNotFound)
		}
	})

	t.Run("POST without answer returns error", func(t *testing.T) {
		q := detector.ProcessLine("task-1", agent.OutputLine{
			Sequence: 1,
			Stream:   "stdout",
			Data:     "Continue?",
		})

		resp, err := client.Post("http://unix/questions/"+q.ID+"/answer", "application/json",
			strings.NewReader(`{}`))
		if err != nil {
			t.Fatalf("POST error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
		}
	})

	t.Run("POST answers question", func(t *testing.T) {
		q := detector.ProcessLine("task-answer", agent.OutputLine{
			Sequence: 2,
			Stream:   "stdout",
			Data:     "Proceed?",
		})

		resp, err := client.Post("http://unix/questions/"+q.ID+"/answer", "application/json",
			strings.NewReader(`{"answer":"yes, proceed"}`))
		if err != nil {
			t.Fatalf("POST error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
		}

		var result struct {
			QuestionID string `json:"question_id"`
			TaskID     string `json:"task_id"`
			Status     string `json:"status"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatalf("Decode error: %v", err)
		}

		if result.Status != "answered" {
			t.Errorf("Status = %q, want %q", result.Status, "answered")
		}

		// Verify question is marked as answered
		updated := detector.GetQuestion(q.ID)
		if updated.AnsweredAt == nil {
			t.Error("Question should be marked as answered")
		}
	})

	t.Run("GET on answer returns method not allowed", func(t *testing.T) {
		q := detector.ProcessLine("task-method", agent.OutputLine{
			Sequence: 3,
			Stream:   "stdout",
			Data:     "Allow?",
		})

		resp, err := client.Get("http://unix/questions/" + q.ID + "/answer")
		if err != nil {
			t.Fatalf("GET error: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
		}
	})
}

func TestHandleUnknownAction(t *testing.T) {
	_, detector, client, cleanup := setupTestHandlers(t)
	defer cleanup()

	q := detector.ProcessLine("task-1", agent.OutputLine{
		Sequence: 1,
		Stream:   "stdout",
		Data:     "Question?",
	})

	resp, err := client.Get("http://unix/questions/" + q.ID + "/unknown")
	if err != nil {
		t.Fatalf("GET error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
}
