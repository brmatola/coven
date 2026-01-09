package scheduler

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/coven/daemon/internal/api"
	"github.com/coven/daemon/internal/state"
	"github.com/coven/daemon/pkg/types"
)

// Handlers provides HTTP handlers for task control operations.
type Handlers struct {
	store     *state.Store
	scheduler *Scheduler
}

// NewHandlers creates new task control handlers.
func NewHandlers(store *state.Store, scheduler *Scheduler) *Handlers {
	return &Handlers{
		store:     store,
		scheduler: scheduler,
	}
}

// Register registers task handlers with the server.
func (h *Handlers) Register(server *api.Server) {
	server.RegisterHandlerFunc("/tasks/", h.handleTaskByID)
}

// handleTaskByID handles /tasks/:id/* endpoints
func (h *Handlers) handleTaskByID(w http.ResponseWriter, r *http.Request) {
	// Parse path: /tasks/{id}/action
	path := strings.TrimPrefix(r.URL.Path, "/tasks/")
	parts := strings.SplitN(path, "/", 2)

	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		http.Error(w, "Task ID and action required", http.StatusBadRequest)
		return
	}

	taskID := parts[0]
	action := parts[1]

	switch action {
	case "start":
		h.handleTaskStart(w, r, taskID)
	case "stop":
		h.handleTaskStop(w, r, taskID)
	default:
		http.Error(w, "Unknown action", http.StatusNotFound)
	}
}

// handleTaskStart handles POST /tasks/:id/start
func (h *Handlers) handleTaskStart(w http.ResponseWriter, r *http.Request, taskID string) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Find task in store
	tasks := h.store.GetTasks()
	var task *types.Task
	for _, t := range tasks {
		if t.ID == taskID {
			task = &t
			break
		}
	}

	if task == nil {
		http.Error(w, "Task not found", http.StatusNotFound)
		return
	}

	// Check if already running
	if h.scheduler.IsAgentRunning(taskID) {
		response := struct {
			TaskID  string `json:"task_id"`
			Status  string `json:"status"`
			Message string `json:"message"`
		}{
			TaskID:  taskID,
			Status:  "already_running",
			Message: "Agent already running for this task",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	// Force start the task (bypass scheduler)
	ctx := context.Background()
	if err := h.scheduler.StartAgentForTask(ctx, *task); err != nil {
		http.Error(w, "Failed to start agent: "+err.Error(), http.StatusInternalServerError)
		return
	}

	response := struct {
		TaskID  string `json:"task_id"`
		Status  string `json:"status"`
		Message string `json:"message"`
	}{
		TaskID:  taskID,
		Status:  "started",
		Message: "Agent started for task",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleTaskStop handles POST /tasks/:id/stop
func (h *Handlers) handleTaskStop(w http.ResponseWriter, r *http.Request, taskID string) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Check if agent exists
	agent := h.store.GetAgent(taskID)
	if agent == nil {
		http.Error(w, "No agent running for task", http.StatusNotFound)
		return
	}

	// Stop the agent
	if err := h.scheduler.StopAgent(taskID); err != nil {
		// Agent might already be stopped
		h.store.UpdateAgentStatus(taskID, types.AgentStatusKilled)
	} else {
		h.store.UpdateAgentStatus(taskID, types.AgentStatusKilled)
	}

	response := struct {
		TaskID  string `json:"task_id"`
		Status  string `json:"status"`
		Message string `json:"message"`
	}{
		TaskID:  taskID,
		Status:  "stopped",
		Message: "Agent stopped for task",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
