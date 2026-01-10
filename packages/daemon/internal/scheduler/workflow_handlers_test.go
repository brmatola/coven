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
	"github.com/coven/daemon/internal/workflow"
	"github.com/coven/daemon/pkg/types"
)

func setupTestWorkflowHandlers(t *testing.T) (*api.Server, *Scheduler, *workflow.StatePersister, *http.Client, string, func()) {
	t.Helper()

	sched, _, repoDir := newTestScheduler(t)
	covenDir := filepath.Join(repoDir, ".coven")
	statePersister := workflow.NewStatePersister(covenDir)
	handlers := NewWorkflowHandlers(sched.store, sched, covenDir)

	socketPath := filepath.Join(os.TempDir(), "coven-workflow-test-"+time.Now().Format("150405")+".sock")
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

	return server, sched, statePersister, client, covenDir, cleanup
}

func TestNewWorkflowHandlers(t *testing.T) {
	sched, store, repoDir := newTestScheduler(t)
	defer sched.Stop()
	covenDir := filepath.Join(repoDir, ".coven")

	handlers := NewWorkflowHandlers(store, sched, covenDir)

	if handlers == nil {
		t.Fatal("NewWorkflowHandlers() returned nil")
	}
	if handlers.store != store {
		t.Error("store not set correctly")
	}
	if handlers.scheduler != sched {
		t.Error("scheduler not set correctly")
	}
	if handlers.covenDir != covenDir {
		t.Error("covenDir not set correctly")
	}
}

func TestHandleWorkflowsList_Empty(t *testing.T) {
	_, _, _, client, _, cleanup := setupTestWorkflowHandlers(t)
	defer cleanup()

	resp, err := client.Get("http://unix/workflows")
	if err != nil {
		t.Fatalf("GET error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var result WorkflowListResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("Decode error: %v", err)
	}

	if result.Count != 0 {
		t.Errorf("Count = %d, want 0", result.Count)
	}
	if len(result.Workflows) != 0 {
		t.Errorf("Workflows length = %d, want 0", len(result.Workflows))
	}
}

func TestHandleWorkflowsList_WithWorkflows(t *testing.T) {
	_, _, statePersister, client, _, cleanup := setupTestWorkflowHandlers(t)
	defer cleanup()

	// Create some workflow states
	states := []*workflow.WorkflowState{
		{
			TaskID:       "task-1",
			WorkflowID:   "wf-1",
			GrimoireName: "grimoire-1",
			Status:       workflow.WorkflowRunning,
			CurrentStep:  1,
			StartedAt:    time.Now(),
		},
		{
			TaskID:       "task-2",
			WorkflowID:   "wf-2",
			GrimoireName: "grimoire-2",
			Status:       workflow.WorkflowCompleted,
			CurrentStep:  3,
			StartedAt:    time.Now().Add(-1 * time.Hour),
		},
	}

	for _, s := range states {
		if err := statePersister.Save(s); err != nil {
			t.Fatalf("Failed to save state: %v", err)
		}
	}

	resp, err := client.Get("http://unix/workflows")
	if err != nil {
		t.Fatalf("GET error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var result WorkflowListResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("Decode error: %v", err)
	}

	if result.Count != 2 {
		t.Errorf("Count = %d, want 2", result.Count)
	}
}

func TestHandleWorkflowsList_MethodNotAllowed(t *testing.T) {
	_, _, _, client, _, cleanup := setupTestWorkflowHandlers(t)
	defer cleanup()

	resp, err := client.Post("http://unix/workflows", "application/json", nil)
	if err != nil {
		t.Fatalf("POST error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
	}
}

func TestHandleGetWorkflow_NotFound(t *testing.T) {
	_, _, _, client, _, cleanup := setupTestWorkflowHandlers(t)
	defer cleanup()

	resp, err := client.Get("http://unix/workflows/nonexistent")
	if err != nil {
		t.Fatalf("GET error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
}

func TestHandleGetWorkflow_ByTaskID(t *testing.T) {
	_, _, statePersister, client, _, cleanup := setupTestWorkflowHandlers(t)
	defer cleanup()

	state := &workflow.WorkflowState{
		TaskID:       "task-get-1",
		WorkflowID:   "wf-get-1",
		GrimoireName: "test-grimoire",
		Status:       workflow.WorkflowRunning,
		CurrentStep:  2,
		WorktreePath: "/path/to/worktree",
		StartedAt:    time.Now(),
	}
	if err := statePersister.Save(state); err != nil {
		t.Fatalf("Failed to save state: %v", err)
	}

	resp, err := client.Get("http://unix/workflows/task-get-1")
	if err != nil {
		t.Fatalf("GET error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var result WorkflowDetailResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("Decode error: %v", err)
	}

	if result.TaskID != "task-get-1" {
		t.Errorf("TaskID = %q, want %q", result.TaskID, "task-get-1")
	}
	if result.WorkflowID != "wf-get-1" {
		t.Errorf("WorkflowID = %q, want %q", result.WorkflowID, "wf-get-1")
	}
	if result.Status != workflow.WorkflowRunning {
		t.Errorf("Status = %q, want %q", result.Status, workflow.WorkflowRunning)
	}
}

func TestHandleGetWorkflow_AvailableActions(t *testing.T) {
	_, _, statePersister, client, _, cleanup := setupTestWorkflowHandlers(t)
	defer cleanup()

	tests := []struct {
		name     string
		status   workflow.WorkflowStatus
		expected []string
	}{
		{"running", workflow.WorkflowRunning, []string{"cancel"}},
		{"blocked", workflow.WorkflowBlocked, []string{"retry", "cancel"}},
		{"pending_merge", workflow.WorkflowPendingMerge, []string{"approve-merge", "reject-merge", "cancel"}},
		{"completed", workflow.WorkflowCompleted, []string{}},
		{"failed", workflow.WorkflowFailed, []string{}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			taskID := "task-actions-" + tc.name
			state := &workflow.WorkflowState{
				TaskID:     taskID,
				WorkflowID: "wf-actions-" + tc.name,
				Status:     tc.status,
				StartedAt:  time.Now(),
			}
			statePersister.Save(state)

			resp, err := client.Get("http://unix/workflows/" + taskID)
			if err != nil {
				t.Fatalf("GET error: %v", err)
			}
			defer resp.Body.Close()

			var result WorkflowDetailResponse
			json.NewDecoder(resp.Body).Decode(&result)

			if len(result.Actions) != len(tc.expected) {
				t.Errorf("Actions length = %d, want %d", len(result.Actions), len(tc.expected))
				return
			}

			for i, action := range tc.expected {
				if result.Actions[i] != action {
					t.Errorf("Actions[%d] = %q, want %q", i, result.Actions[i], action)
				}
			}
		})
	}
}

func TestHandleGetWorkflow_MethodNotAllowed(t *testing.T) {
	_, _, statePersister, client, _, cleanup := setupTestWorkflowHandlers(t)
	defer cleanup()

	state := &workflow.WorkflowState{
		TaskID:     "task-method",
		WorkflowID: "wf-method",
		Status:     workflow.WorkflowRunning,
		StartedAt:  time.Now(),
	}
	statePersister.Save(state)

	resp, err := client.Post("http://unix/workflows/task-method", "application/json", nil)
	if err != nil {
		t.Fatalf("POST error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
	}
}

func TestHandleCancelWorkflow(t *testing.T) {
	_, _, statePersister, client, _, cleanup := setupTestWorkflowHandlers(t)
	defer cleanup()

	state := &workflow.WorkflowState{
		TaskID:     "task-cancel",
		WorkflowID: "wf-cancel",
		Status:     workflow.WorkflowRunning,
		StartedAt:  time.Now(),
	}
	statePersister.Save(state)

	resp, err := client.Post("http://unix/workflows/task-cancel/cancel", "application/json", nil)
	if err != nil {
		t.Fatalf("POST error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var result map[string]any
	json.NewDecoder(resp.Body).Decode(&result)

	if result["status"] != "cancelled" {
		t.Errorf("status = %q, want %q", result["status"], "cancelled")
	}

	// Verify state was updated
	updated, _ := statePersister.Load("task-cancel")
	if updated.Status != workflow.WorkflowCancelled {
		t.Errorf("Workflow status = %q, want %q", updated.Status, workflow.WorkflowCancelled)
	}
}

func TestHandleCancelWorkflow_NotFound(t *testing.T) {
	_, _, _, client, _, cleanup := setupTestWorkflowHandlers(t)
	defer cleanup()

	resp, err := client.Post("http://unix/workflows/nonexistent/cancel", "application/json", nil)
	if err != nil {
		t.Fatalf("POST error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
}

func TestHandleCancelWorkflow_AlreadyCompleted(t *testing.T) {
	_, _, statePersister, client, _, cleanup := setupTestWorkflowHandlers(t)
	defer cleanup()

	state := &workflow.WorkflowState{
		TaskID:     "task-cancel-completed",
		WorkflowID: "wf-cancel-completed",
		Status:     workflow.WorkflowCompleted,
		StartedAt:  time.Now(),
	}
	statePersister.Save(state)

	resp, err := client.Post("http://unix/workflows/task-cancel-completed/cancel", "application/json", nil)
	if err != nil {
		t.Fatalf("POST error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
}

func TestHandleRetryWorkflow(t *testing.T) {
	_, sched, statePersister, client, _, cleanup := setupTestWorkflowHandlers(t)
	defer cleanup()

	taskID := "task-retry"

	// Add task to store - required for retry to work
	sched.store.SetTasks([]types.Task{
		{ID: taskID, Title: "Test Task", Status: types.TaskStatusOpen},
	})

	state := &workflow.WorkflowState{
		TaskID:       taskID,
		WorkflowID:   "wf-retry",
		GrimoireName: "test-grimoire",
		Status:       workflow.WorkflowBlocked,
		StartedAt:    time.Now(),
	}
	statePersister.Save(state)

	resp, err := client.Post("http://unix/workflows/"+taskID+"/retry", "application/json", nil)
	if err != nil {
		t.Fatalf("POST error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var result map[string]any
	json.NewDecoder(resp.Body).Decode(&result)

	if result["status"] != "queued" {
		t.Errorf("status = %q, want %q", result["status"], "queued")
	}
}

func TestHandleRetryWorkflow_NotBlocked(t *testing.T) {
	_, _, statePersister, client, _, cleanup := setupTestWorkflowHandlers(t)
	defer cleanup()

	state := &workflow.WorkflowState{
		TaskID:     "task-retry-running",
		WorkflowID: "wf-retry-running",
		Status:     workflow.WorkflowRunning,
		StartedAt:  time.Now(),
	}
	statePersister.Save(state)

	resp, err := client.Post("http://unix/workflows/task-retry-running/retry", "application/json", nil)
	if err != nil {
		t.Fatalf("POST error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
}

func TestHandleGetWorkflowLog_NotFound(t *testing.T) {
	_, _, _, client, _, cleanup := setupTestWorkflowHandlers(t)
	defer cleanup()

	resp, err := client.Get("http://unix/workflows/nonexistent/log")
	if err != nil {
		t.Fatalf("GET error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
}

func TestHandleGetWorkflowLog_EmptyLog(t *testing.T) {
	_, _, statePersister, client, _, cleanup := setupTestWorkflowHandlers(t)
	defer cleanup()

	state := &workflow.WorkflowState{
		TaskID:     "task-log",
		WorkflowID: "wf-log",
		Status:     workflow.WorkflowRunning,
		StartedAt:  time.Now(),
	}
	statePersister.Save(state)

	resp, err := client.Get("http://unix/workflows/task-log/log")
	if err != nil {
		t.Fatalf("GET error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	if ct := resp.Header.Get("Content-Type"); ct != "application/x-ndjson" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/x-ndjson")
	}
}

func TestHandleGetWorkflowLog_WithLog(t *testing.T) {
	_, _, statePersister, client, covenDir, cleanup := setupTestWorkflowHandlers(t)
	defer cleanup()

	workflowID := "wf-log-content"
	state := &workflow.WorkflowState{
		TaskID:     "task-log-content",
		WorkflowID: workflowID,
		Status:     workflow.WorkflowRunning,
		StartedAt:  time.Now(),
	}
	statePersister.Save(state)

	// Create a log file
	logDir := filepath.Join(covenDir, "logs", "workflows")
	os.MkdirAll(logDir, 0755)
	logContent := `{"timestamp":"2024-01-01T00:00:00Z","event":"workflow.start"}
{"timestamp":"2024-01-01T00:00:01Z","event":"step.start"}
`
	os.WriteFile(filepath.Join(logDir, workflowID+".jsonl"), []byte(logContent), 0644)

	resp, err := client.Get("http://unix/workflows/task-log-content/log")
	if err != nil {
		t.Fatalf("GET error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
}

func TestHandleRejectMerge(t *testing.T) {
	_, sched, statePersister, client, _, cleanup := setupTestWorkflowHandlers(t)
	defer cleanup()

	taskID := "task-reject"

	// Add task to store - required for reject to work
	sched.store.SetTasks([]types.Task{
		{ID: taskID, Title: "Test Task", Status: types.TaskStatusOpen},
	})

	state := &workflow.WorkflowState{
		TaskID:       taskID,
		WorkflowID:   "wf-reject",
		GrimoireName: "test-grimoire",
		Status:       workflow.WorkflowPendingMerge,
		StartedAt:    time.Now(),
	}
	statePersister.Save(state)

	body := strings.NewReader(`{"reason": "Changes need revision"}`)
	resp, err := client.Post("http://unix/workflows/"+taskID+"/reject-merge", "application/json", body)
	if err != nil {
		t.Fatalf("POST error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var result map[string]any
	json.NewDecoder(resp.Body).Decode(&result)

	if result["status"] != "rejected" {
		t.Errorf("status = %q, want %q", result["status"], "rejected")
	}
	if result["reason"] != "Changes need revision" {
		t.Errorf("reason = %q, want %q", result["reason"], "Changes need revision")
	}
}

func TestHandleRejectMerge_NotPending(t *testing.T) {
	_, _, statePersister, client, _, cleanup := setupTestWorkflowHandlers(t)
	defer cleanup()

	state := &workflow.WorkflowState{
		TaskID:     "task-reject-running",
		WorkflowID: "wf-reject-running",
		Status:     workflow.WorkflowRunning,
		StartedAt:  time.Now(),
	}
	statePersister.Save(state)

	resp, err := client.Post("http://unix/workflows/task-reject-running/reject-merge", "application/json", nil)
	if err != nil {
		t.Fatalf("POST error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
}

func TestHandleApproveMerge_NotPending(t *testing.T) {
	_, _, statePersister, client, _, cleanup := setupTestWorkflowHandlers(t)
	defer cleanup()

	state := &workflow.WorkflowState{
		TaskID:     "task-approve-running",
		WorkflowID: "wf-approve-running",
		Status:     workflow.WorkflowRunning,
		StartedAt:  time.Now(),
	}
	statePersister.Save(state)

	resp, err := client.Post("http://unix/workflows/task-approve-running/approve-merge", "application/json", nil)
	if err != nil {
		t.Fatalf("POST error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
}

func TestHandleUnknownAction(t *testing.T) {
	_, _, statePersister, client, _, cleanup := setupTestWorkflowHandlers(t)
	defer cleanup()

	state := &workflow.WorkflowState{
		TaskID:     "task-unknown",
		WorkflowID: "wf-unknown",
		Status:     workflow.WorkflowRunning,
		StartedAt:  time.Now(),
	}
	statePersister.Save(state)

	resp, err := client.Post("http://unix/workflows/task-unknown/foobar", "application/json", nil)
	if err != nil {
		t.Fatalf("POST error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
}

func TestHandleEmptyWorkflowID(t *testing.T) {
	_, _, _, client, _, cleanup := setupTestWorkflowHandlers(t)
	defer cleanup()

	resp, err := client.Get("http://unix/workflows/")
	if err != nil {
		t.Fatalf("GET error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
}
