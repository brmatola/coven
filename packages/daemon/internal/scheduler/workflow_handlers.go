package scheduler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/coven/daemon/internal/api"
	"github.com/coven/daemon/internal/grimoire"
	"github.com/coven/daemon/internal/state"
	"github.com/coven/daemon/internal/workflow"
	"github.com/coven/daemon/pkg/types"
)

// EventEmitter interface for emitting SSE events
type EventEmitter interface {
	EmitTasksUpdated(tasks []types.Task)
	EmitWorkflowCancelled(workflowID, taskID string)
}

// WorkflowHandlers provides HTTP handlers for workflow operations.
type WorkflowHandlers struct {
	store           *state.Store
	scheduler       *Scheduler
	statePersister  *workflow.StatePersister
	grimoireLoader  *grimoire.Loader
	covenDir        string
	eventEmitter    EventEmitter
}

// NewWorkflowHandlers creates new workflow handlers.
func NewWorkflowHandlers(store *state.Store, scheduler *Scheduler, covenDir string) *WorkflowHandlers {
	return &WorkflowHandlers{
		store:           store,
		scheduler:       scheduler,
		statePersister:  workflow.NewStatePersister(covenDir),
		grimoireLoader:  grimoire.NewLoader(covenDir),
		covenDir:        covenDir,
	}
}

// SetEventEmitter sets the event emitter for broadcasting state changes.
func (h *WorkflowHandlers) SetEventEmitter(emitter EventEmitter) {
	h.eventEmitter = emitter
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
// @Summary      List all workflows
// @Description  Returns a list of all workflows with their current status and metadata
// @Tags         workflows
// @Accept       json
// @Produce      json
// @Success      200  {object}  WorkflowListResponse  "Workflows list response"
// @Failure      405  {object}  map[string]string     "Method not allowed"
// @Router       /workflows [get]
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

// StepInfo represents a step in a workflow for the API response.
type StepInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	Status      string `json:"status"` // pending, running, completed, failed, skipped
	Depth       int    `json:"depth"`  // 0 = top level, 1+ = nested in loop
	IsLoop      bool   `json:"is_loop,omitempty"`
	MaxIter     int    `json:"max_iterations,omitempty"`
	CurrentIter int    `json:"current_iteration,omitempty"`
	Error       string `json:"error,omitempty"`
	StepTaskID  string `json:"step_task_id,omitempty"` // Composite ID for SSE event matching: {task_id}-step-{index}
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
	Steps          []StepInfo                      `json:"steps"`
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
// @Summary      Get workflow details
// @Description  Returns detailed information about a workflow including steps, outputs, and available actions
// @Tags         workflows
// @Accept       json
// @Produce      json
// @Param        id   path      string  true  "Workflow ID or Task ID"
// @Success      200  {object}  WorkflowDetailResponse  "Workflow details"
// @Failure      404  {object}  map[string]string      "Workflow not found"
// @Failure      405  {object}  map[string]string      "Method not allowed"
// @Router       /workflows/{id} [get]
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
		mergeReview = h.getMergeReview(state)
	}

	// Load grimoire to get step definitions
	steps := h.buildStepInfo(state)

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
		Steps:          steps,
		CompletedSteps: state.CompletedSteps,
		StepOutputs:    state.StepOutputs,
		MergeReview:    mergeReview,
		Actions:        actions,
	})
}

// buildStepInfo loads the grimoire and builds step info with status.
func (h *WorkflowHandlers) buildStepInfo(state *workflow.WorkflowState) []StepInfo {
	if state.GrimoireName == "" {
		return []StepInfo{}
	}

	g, err := h.grimoireLoader.Load(state.GrimoireName)
	if err != nil {
		// Can't load grimoire, return empty steps
		return []StepInfo{}
	}

	var steps []StepInfo
	stepIndex := 0
	h.flattenSteps(g.Steps, state, 0, &steps, &stepIndex)
	return steps
}

// flattenSteps recursively flattens grimoire steps with status info.
// stepIndex is a pointer to track global step numbering for step_task_id generation.
func (h *WorkflowHandlers) flattenSteps(grimoireSteps []grimoire.Step, state *workflow.WorkflowState, depth int, out *[]StepInfo, stepIndex *int) {
	for i, step := range grimoireSteps {
		stepID := step.Name
		status := "pending"

		// Generate step_task_id for SSE event matching
		stepTaskID := fmt.Sprintf("%s-step-%d", state.TaskID, *stepIndex)
		*stepIndex++

		// Check if this step is completed
		if result, ok := state.CompletedSteps[stepID]; ok {
			if result.Success {
				status = "completed"
			} else {
				status = "failed"
			}
		} else if depth == 0 {
			// Determine running step for top-level steps
			// CurrentStep is -1 initially, then incremented as steps complete
			// So if workflow is running and CurrentStep is -1, step 0 is running
			// If CurrentStep is N, step N+1 is running (the next incomplete step)
			runningStepIdx := state.CurrentStep + 1
			if state.Status == workflow.WorkflowRunning && i == runningStepIdx {
				status = "running"
			}
		}

		info := StepInfo{
			ID:         stepID,
			Name:       step.Name,
			Type:       string(step.Type),
			Status:     status,
			Depth:      depth,
			IsLoop:     step.Type == grimoire.StepTypeLoop,
			StepTaskID: stepTaskID,
		}

		if step.Type == grimoire.StepTypeLoop {
			info.MaxIter = step.MaxIterations
		}

		*out = append(*out, info)

		// Recurse into loop steps
		if step.Type == grimoire.StepTypeLoop && len(step.Steps) > 0 {
			h.flattenSteps(step.Steps, state, depth+1, out, stepIndex)
		}
	}
}

// handleGetWorkflowLog handles GET /workflows/:id/log.
// @Summary      Get workflow log
// @Description  Returns the JSONL log file for a workflow
// @Tags         workflows
// @Accept       json
// @Produce      application/x-ndjson
// @Param        id   path      string  true  "Workflow ID or Task ID"
// @Success      200  {string}  string  "JSONL log content"
// @Failure      404  {object}  map[string]string  "Workflow not found"
// @Failure      405  {object}  map[string]string  "Method not allowed"
// @Router       /workflows/{id}/log [get]
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
// @Summary      Cancel a workflow
// @Description  Cancels a running or blocked workflow and stops any associated agents
// @Tags         workflows
// @Accept       json
// @Produce      json
// @Param        id   path      string  true  "Workflow ID or Task ID"
// @Success      200  {object}  map[string]interface{}  "Cancel response"
// @Failure      400  {object}  map[string]string        "Workflow already in terminal state"
// @Failure      404  {object}  map[string]string        "Workflow not found"
// @Failure      405  {object}  map[string]string        "Method not allowed"
// @Router       /workflows/{id}/cancel [post]
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

	// Emit events to notify clients
	if h.eventEmitter != nil {
		// Get updated tasks and emit
		tasks := h.store.GetTasks()
		h.eventEmitter.EmitTasksUpdated(tasks)
		h.eventEmitter.EmitWorkflowCancelled(state.WorkflowID, state.TaskID)
	}

	api.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"status":      "cancelled",
		"workflow_id": state.WorkflowID,
		"task_id":     state.TaskID,
	})
}

// handleRetryWorkflow handles POST /workflows/:id/retry.
// @Summary      Retry a blocked workflow
// @Description  Retries a blocked or failed workflow, optionally with modified inputs
// @Tags         workflows
// @Accept       json
// @Produce      json
// @Param        id   path      string  true  "Workflow ID or Task ID"
// @Param        body body      object  false "Modified inputs (optional)"  SchemaExample({"modified_inputs":{"key":"value"}})
// @Success      200  {object}  map[string]interface{}  "Retry response"
// @Failure      400  {object}  map[string]string        "Workflow is not in blocked or failed state"
// @Failure      404  {object}  map[string]string        "Workflow not found"
// @Failure      405  {object}  map[string]string        "Method not allowed"
// @Router       /workflows/{id}/retry [post]
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
// @Summary      Approve workflow merge
// @Description  Approves and merges workflow changes into the main repository
// @Tags         workflows
// @Accept       json
// @Produce      json
// @Param        id   path      string  true  "Workflow ID or Task ID"
// @Param        body body      object  false "Approval feedback (optional)"  SchemaExample({"feedback":"Looks good!"})
// @Success      200  {object}  ApproveMergeResponse  "Merge approval response"
// @Failure      400  {object}  map[string]string      "Workflow is not pending merge approval"
// @Failure      404  {object}  map[string]string      "Workflow not found"
// @Failure      405  {object}  map[string]string      "Method not allowed"
// @Router       /workflows/{id}/approve-merge [post]
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
// @Summary      Reject workflow merge
// @Description  Rejects workflow changes and blocks the workflow
// @Tags         workflows
// @Accept       json
// @Produce      json
// @Param        id   path      string  true  "Workflow ID or Task ID"
// @Param        body body      object  false "Rejection reason (optional)"  SchemaExample({"reason":"Needs more tests"})
// @Success      200  {object}  map[string]interface{}  "Reject response"
// @Failure      400  {object}  map[string]string        "Workflow is not pending merge approval"
// @Failure      404  {object}  map[string]string        "Workflow not found"
// @Failure      405  {object}  map[string]string        "Method not allowed"
// @Router       /workflows/{id}/reject-merge [post]
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
