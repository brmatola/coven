package scheduler

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/coven/daemon/internal/api"
	"github.com/coven/daemon/internal/state"
	"github.com/coven/daemon/internal/workflow"
)

// WorkflowHandlers provides HTTP handlers for workflow operations.
type WorkflowHandlers struct {
	store          *state.Store
	scheduler      *Scheduler
	statePersister *workflow.StatePersister
	covenDir       string
}

// NewWorkflowHandlers creates new workflow handlers.
func NewWorkflowHandlers(store *state.Store, scheduler *Scheduler, covenDir string) *WorkflowHandlers {
	return &WorkflowHandlers{
		store:          store,
		scheduler:      scheduler,
		statePersister: workflow.NewStatePersister(covenDir),
		covenDir:       covenDir,
	}
}

// Register registers workflow handlers with the server.
func (h *WorkflowHandlers) Register(server *api.Server) {
	server.RegisterHandlerFunc("/workflows", h.handleWorkflowsList)
	server.RegisterHandlerFunc("/workflows/", h.handleWorkflowByID)
}

// WorkflowListItem represents a workflow in the list response.
type WorkflowListItem struct {
	WorkflowID   string                  `json:"workflow_id"`
	TaskID       string                  `json:"task_id"`
	GrimoireName string                  `json:"grimoire_name"`
	Status       workflow.WorkflowStatus `json:"status"`
	CurrentStep  int                     `json:"current_step"`
	WorktreePath string                  `json:"worktree_path"`
	StartedAt    time.Time               `json:"started_at"`
	UpdatedAt    time.Time               `json:"updated_at"`
	Error        string                  `json:"error,omitempty"`
}

// WorkflowListResponse is the response for GET /workflows.
type WorkflowListResponse struct {
	Workflows []WorkflowListItem `json:"workflows"`
	Count     int                `json:"count"`
}

// handleWorkflowsList handles GET /workflows.
func (h *WorkflowHandlers) handleWorkflowsList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		api.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// List all workflow state files
	stateDir := h.statePersister.StateDir()
	entries, err := os.ReadDir(stateDir)
	if err != nil {
		if os.IsNotExist(err) {
			// No workflows directory yet
			api.WriteJSON(w, http.StatusOK, WorkflowListResponse{
				Workflows: []WorkflowListItem{},
				Count:     0,
			})
			return
		}
		api.WriteError(w, http.StatusInternalServerError, "failed to list workflows: "+err.Error())
		return
	}

	var workflows []WorkflowListItem
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		taskID := strings.TrimSuffix(entry.Name(), ".json")
		state, err := h.statePersister.Load(taskID)
		if err != nil || state == nil {
			continue
		}

		workflows = append(workflows, WorkflowListItem{
			WorkflowID:   state.WorkflowID,
			TaskID:       state.TaskID,
			GrimoireName: state.GrimoireName,
			Status:       state.Status,
			CurrentStep:  state.CurrentStep,
			WorktreePath: state.WorktreePath,
			StartedAt:    state.StartedAt,
			UpdatedAt:    state.UpdatedAt,
			Error:        state.Error,
		})
	}

	api.WriteJSON(w, http.StatusOK, WorkflowListResponse{
		Workflows: workflows,
		Count:     len(workflows),
	})
}

// WorkflowDetailResponse is the response for GET /workflows/:id.
type WorkflowDetailResponse struct {
	WorkflowID     string                          `json:"workflow_id"`
	TaskID         string                          `json:"task_id"`
	GrimoireName   string                          `json:"grimoire_name"`
	Status         workflow.WorkflowStatus         `json:"status"`
	CurrentStep    int                             `json:"current_step"`
	WorktreePath   string                          `json:"worktree_path"`
	StartedAt      time.Time                       `json:"started_at"`
	UpdatedAt      time.Time                       `json:"updated_at"`
	Error          string                          `json:"error,omitempty"`
	CompletedSteps map[string]*workflow.StepResult `json:"completed_steps,omitempty"`
	StepOutputs    map[string]string               `json:"step_outputs,omitempty"`
	MergeReview    *workflow.MergeReview           `json:"merge_review,omitempty"`
	Actions        []string                        `json:"available_actions"`
}

// handleWorkflowByID handles /workflows/:id/* endpoints.
func (h *WorkflowHandlers) handleWorkflowByID(w http.ResponseWriter, r *http.Request) {
	// Parse path: /workflows/{id}/action or /workflows/{id}
	path := strings.TrimPrefix(r.URL.Path, "/workflows/")
	parts := strings.SplitN(path, "/", 2)

	if len(parts) == 0 || parts[0] == "" {
		api.WriteError(w, http.StatusBadRequest, "workflow ID required")
		return
	}

	workflowOrTaskID := parts[0]
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	// Handle actions
	switch action {
	case "":
		h.handleGetWorkflow(w, r, workflowOrTaskID)
	case "log":
		h.handleGetWorkflowLog(w, r, workflowOrTaskID)
	case "cancel":
		h.handleCancelWorkflow(w, r, workflowOrTaskID)
	case "retry":
		h.handleRetryWorkflow(w, r, workflowOrTaskID)
	case "approve-merge":
		h.handleApproveMerge(w, r, workflowOrTaskID)
	case "reject-merge":
		h.handleRejectMerge(w, r, workflowOrTaskID)
	default:
		api.WriteError(w, http.StatusNotFound, "unknown action: "+action)
	}
}

// handleGetWorkflow handles GET /workflows/:id.
func (h *WorkflowHandlers) handleGetWorkflow(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodGet {
		api.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Try to load by task ID first (most common case)
	state, err := h.statePersister.Load(id)
	if err != nil {
		api.WriteError(w, http.StatusInternalServerError, "failed to load workflow: "+err.Error())
		return
	}

	if state == nil {
		// Try to find by workflow ID
		state = h.findWorkflowByID(id)
		if state == nil {
			api.WriteError(w, http.StatusNotFound, "workflow not found")
			return
		}
	}

	// Determine available actions based on status
	var actions []string
	switch state.Status {
	case workflow.WorkflowRunning:
		actions = []string{"cancel"}
	case workflow.WorkflowBlocked:
		actions = []string{"retry", "cancel"}
	case workflow.WorkflowPendingMerge:
		actions = []string{"approve-merge", "reject-merge", "cancel"}
	case workflow.WorkflowCompleted, workflow.WorkflowFailed, workflow.WorkflowCancelled:
		actions = []string{} // No actions for terminal states
	}

	// Load merge review if pending merge
	var mergeReview *workflow.MergeReview
	if state.Status == workflow.WorkflowPendingMerge {
		// The merge review might be stored in step outputs or a separate file
		// For now, we can reconstruct it or load from context
		mergeReview = h.getMergeReview(state)
	}

	api.WriteJSON(w, http.StatusOK, WorkflowDetailResponse{
		WorkflowID:     state.WorkflowID,
		TaskID:         state.TaskID,
		GrimoireName:   state.GrimoireName,
		Status:         state.Status,
		CurrentStep:    state.CurrentStep,
		WorktreePath:   state.WorktreePath,
		StartedAt:      state.StartedAt,
		UpdatedAt:      state.UpdatedAt,
		Error:          state.Error,
		CompletedSteps: state.CompletedSteps,
		StepOutputs:    state.StepOutputs,
		MergeReview:    mergeReview,
		Actions:        actions,
	})
}

// handleGetWorkflowLog handles GET /workflows/:id/log.
func (h *WorkflowHandlers) handleGetWorkflowLog(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodGet {
		api.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Find the workflow state to get the workflow ID
	state, _ := h.statePersister.Load(id)
	if state == nil {
		state = h.findWorkflowByID(id)
	}
	if state == nil {
		api.WriteError(w, http.StatusNotFound, "workflow not found")
		return
	}

	// Log file path
	logPath := filepath.Join(h.covenDir, "logs", "workflows", state.WorkflowID+".jsonl")

	// Check if log exists
	if _, err := os.Stat(logPath); os.IsNotExist(err) {
		// Return empty log if not yet created
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.WriteHeader(http.StatusOK)
		return
	}

	// Stream the log file
	data, err := os.ReadFile(logPath)
	if err != nil {
		api.WriteError(w, http.StatusInternalServerError, "failed to read log: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

// handleCancelWorkflow handles POST /workflows/:id/cancel.
func (h *WorkflowHandlers) handleCancelWorkflow(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		api.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Find the workflow
	state, _ := h.statePersister.Load(id)
	if state == nil {
		state = h.findWorkflowByID(id)
	}
	if state == nil {
		api.WriteError(w, http.StatusNotFound, "workflow not found")
		return
	}

	// Check if workflow can be cancelled
	if state.Status == workflow.WorkflowCompleted || state.Status == workflow.WorkflowCancelled {
		api.WriteError(w, http.StatusBadRequest, "workflow already in terminal state")
		return
	}

	// Stop any running agent for this task
	if h.scheduler.IsAgentRunning(state.TaskID) {
		if err := h.scheduler.KillAgent(state.TaskID); err != nil {
			// Log but continue - we still want to update state
			h.scheduler.logger.Warn("failed to kill agent during cancel", "error", err)
		}
	}

	// Update workflow state to cancelled
	state.Status = workflow.WorkflowCancelled
	state.UpdatedAt = time.Now()
	if err := h.statePersister.Save(state); err != nil {
		api.WriteError(w, http.StatusInternalServerError, "failed to save workflow state: "+err.Error())
		return
	}

	// Update task status back to open
	h.store.UpdateTaskStatus(state.TaskID, "open")

	api.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"status":      "cancelled",
		"workflow_id": state.WorkflowID,
		"task_id":     state.TaskID,
	})
}

// handleRetryWorkflow handles POST /workflows/:id/retry.
func (h *WorkflowHandlers) handleRetryWorkflow(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		api.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Find the workflow
	state, _ := h.statePersister.Load(id)
	if state == nil {
		state = h.findWorkflowByID(id)
	}
	if state == nil {
		api.WriteError(w, http.StatusNotFound, "workflow not found")
		return
	}

	// Check if workflow can be retried
	if state.Status != workflow.WorkflowBlocked && state.Status != workflow.WorkflowFailed {
		api.WriteError(w, http.StatusBadRequest, "workflow is not in blocked or failed state")
		return
	}

	// Queue the workflow for resumption
	if err := h.scheduler.QueueWorkflowResume(state); err != nil {
		api.WriteError(w, http.StatusInternalServerError, "failed to queue workflow resume: "+err.Error())
		return
	}

	api.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"status":      "queued",
		"workflow_id": state.WorkflowID,
		"task_id":     state.TaskID,
		"message":     "workflow queued for retry",
	})
}

// ApproveMergeResponse is the response for approve-merge endpoint.
type ApproveMergeResponse struct {
	Status        string   `json:"status"`
	WorkflowID    string   `json:"workflow_id"`
	TaskID        string   `json:"task_id"`
	Message       string   `json:"message"`
	MergeCommit   string   `json:"merge_commit,omitempty"`
	HasConflicts  bool     `json:"has_conflicts,omitempty"`
	ConflictFiles []string `json:"conflict_files,omitempty"`
}

// handleApproveMerge handles POST /workflows/:id/approve-merge.
func (h *WorkflowHandlers) handleApproveMerge(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		api.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Find the workflow
	state, _ := h.statePersister.Load(id)
	if state == nil {
		state = h.findWorkflowByID(id)
	}
	if state == nil {
		api.WriteError(w, http.StatusNotFound, "workflow not found")
		return
	}

	// Check if workflow is pending merge
	if state.Status != workflow.WorkflowPendingMerge {
		api.WriteError(w, http.StatusBadRequest, "workflow is not pending merge approval")
		return
	}

	// Signal merge approval
	result, err := h.scheduler.ApproveMerge(state.TaskID)
	if err != nil {
		api.WriteError(w, http.StatusInternalServerError, "failed to approve merge: "+err.Error())
		return
	}

	// Check if there are conflicts
	if result.HasConflicts {
		api.WriteJSON(w, http.StatusOK, ApproveMergeResponse{
			Status:        "conflicts",
			WorkflowID:    state.WorkflowID,
			TaskID:        state.TaskID,
			Message:       "merge has conflicts that need to be resolved",
			HasConflicts:  true,
			ConflictFiles: result.ConflictFiles,
		})
		return
	}

	api.WriteJSON(w, http.StatusOK, ApproveMergeResponse{
		Status:      "merged",
		WorkflowID:  state.WorkflowID,
		TaskID:      state.TaskID,
		Message:     "merge completed, workflow continuing",
		MergeCommit: result.MergeCommit,
	})
}

// handleRejectMerge handles POST /workflows/:id/reject-merge.
func (h *WorkflowHandlers) handleRejectMerge(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		api.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Parse optional reason from body
	var body struct {
		Reason string `json:"reason"`
	}
	if r.Body != nil {
		json.NewDecoder(r.Body).Decode(&body)
	}
	if body.Reason == "" {
		body.Reason = "merge rejected by user"
	}

	// Find the workflow
	state, _ := h.statePersister.Load(id)
	if state == nil {
		state = h.findWorkflowByID(id)
	}
	if state == nil {
		api.WriteError(w, http.StatusNotFound, "workflow not found")
		return
	}

	// Check if workflow is pending merge
	if state.Status != workflow.WorkflowPendingMerge {
		api.WriteError(w, http.StatusBadRequest, "workflow is not pending merge approval")
		return
	}

	// Signal merge rejection
	if err := h.scheduler.RejectMerge(state.TaskID, body.Reason); err != nil {
		api.WriteError(w, http.StatusInternalServerError, "failed to reject merge: "+err.Error())
		return
	}

	api.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"status":      "rejected",
		"workflow_id": state.WorkflowID,
		"task_id":     state.TaskID,
		"reason":      body.Reason,
	})
}

// findWorkflowByID searches for a workflow by workflow ID (not task ID).
func (h *WorkflowHandlers) findWorkflowByID(workflowID string) *workflow.WorkflowState {
	stateDir := h.statePersister.StateDir()
	entries, err := os.ReadDir(stateDir)
	if err != nil {
		return nil
	}

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		taskID := strings.TrimSuffix(entry.Name(), ".json")
		state, err := h.statePersister.Load(taskID)
		if err != nil || state == nil {
			continue
		}

		if state.WorkflowID == workflowID {
			return state
		}
	}

	return nil
}

// getMergeReview retrieves merge review information for a pending merge workflow.
func (h *WorkflowHandlers) getMergeReview(state *workflow.WorkflowState) *workflow.MergeReview {
	// The merge review is typically stored in the step context
	// For now, we can regenerate it from the worktree
	if state.WorktreePath == "" {
		return nil
	}

	// Check if worktree exists
	if _, err := os.Stat(state.WorktreePath); os.IsNotExist(err) {
		return nil
	}

	// We could regenerate the merge review here, but for now
	// just return basic info indicating there's a pending merge
	return &workflow.MergeReview{
		Summary: "Merge pending approval",
	}
}
