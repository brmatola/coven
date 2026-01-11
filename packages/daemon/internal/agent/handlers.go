package agent

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/coven/daemon/internal/api"
	"github.com/coven/daemon/internal/state"
	"github.com/coven/daemon/pkg/types"
)

// Handlers provides HTTP handlers for agent operations.
type Handlers struct {
	store          *state.Store
	processManager *ProcessManager
}

// NewHandlers creates new agent handlers.
func NewHandlers(store *state.Store, processManager *ProcessManager) *Handlers {
	return &Handlers{
		store:          store,
		processManager: processManager,
	}
}

// Register registers agent handlers with the server.
func (h *Handlers) Register(server *api.Server) {
	server.RegisterHandlerFunc("/agents", h.handleAgents)
	server.RegisterHandlerFunc("/agents/", h.handleAgentByID)
}

// handleAgents handles GET /agents
func (h *Handlers) handleAgents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	agents := h.store.GetAllAgents()

	// Convert to slice for JSON
	agentList := make([]*types.Agent, 0, len(agents))
	for _, agent := range agents {
		agentList = append(agentList, agent)
	}

	response := struct {
		Agents []*types.Agent `json:"agents"`
		Count  int            `json:"count"`
	}{
		Agents: agentList,
		Count:  len(agentList),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleAgentByID handles /agents/:id/* endpoints
func (h *Handlers) handleAgentByID(w http.ResponseWriter, r *http.Request) {
	// Parse path: /agents/{id} or /agents/{id}/action
	path := strings.TrimPrefix(r.URL.Path, "/agents/")
	parts := strings.SplitN(path, "/", 2)

	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "Agent ID required", http.StatusBadRequest)
		return
	}

	taskID := parts[0]
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	switch action {
	case "":
		h.handleGetAgent(w, r, taskID)
	case "output":
		h.handleAgentOutput(w, r, taskID)
	case "kill":
		h.handleAgentKill(w, r, taskID)
	case "respond":
		h.handleAgentRespond(w, r, taskID)
	default:
		http.Error(w, "Unknown action", http.StatusNotFound)
	}
}

// handleGetAgent handles GET /agents/:id
func (h *Handlers) handleGetAgent(w http.ResponseWriter, r *http.Request, taskID string) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	agent := h.store.GetAgent(taskID)
	if agent == nil {
		http.Error(w, "Agent not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(agent)
}

// handleAgentOutput handles GET /agents/:id/output
func (h *Handlers) handleAgentOutput(w http.ResponseWriter, r *http.Request, taskID string) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Check if agent exists
	agent := h.store.GetAgent(taskID)
	if agent == nil {
		http.Error(w, "Agent not found", http.StatusNotFound)
		return
	}

	// Use StepTaskID if available, otherwise fall back to taskID
	processTaskID := taskID
	if agent.StepTaskID != "" {
		processTaskID = agent.StepTaskID
	}

	// Get output from process manager
	output, err := h.processManager.GetOutput(processTaskID)
	if err != nil {
		// Agent may have been cleaned up, return empty output
		output = []OutputLine{}
	}

	// Check for since parameter
	sinceStr := r.URL.Query().Get("since")
	if sinceStr != "" {
		var since uint64
		if _, err := json.Marshal(sinceStr); err == nil {
			// Try to parse since as number
			json.Unmarshal([]byte(sinceStr), &since)
			if filteredOutput, err := h.processManager.GetOutputSince(processTaskID, since); err == nil {
				output = filteredOutput
			}
		}
	}

	response := struct {
		TaskID     string       `json:"task_id"`
		Lines      []OutputLine `json:"lines"`
		LineCount  int          `json:"line_count"`
		LastSeq    uint64       `json:"last_seq"`
	}{
		TaskID:    taskID,
		Lines:     output,
		LineCount: len(output),
	}

	if len(output) > 0 {
		response.LastSeq = output[len(output)-1].Sequence
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleAgentKill handles POST /agents/:id/kill
func (h *Handlers) handleAgentKill(w http.ResponseWriter, r *http.Request, taskID string) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Check if agent exists
	agent := h.store.GetAgent(taskID)
	if agent == nil {
		http.Error(w, "Agent not found", http.StatusNotFound)
		return
	}

	// Use StepTaskID if available, otherwise fall back to taskID
	processTaskID := taskID
	if agent.StepTaskID != "" {
		processTaskID = agent.StepTaskID
	}

	// Kill the process
	if err := h.processManager.Kill(processTaskID); err != nil {
		// Agent might already be dead, just update state
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
		Status:  "killed",
		Message: "Agent terminated",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleAgentRespond handles POST /agents/:id/respond
func (h *Handlers) handleAgentRespond(w http.ResponseWriter, r *http.Request, taskID string) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Check if agent exists
	agent := h.store.GetAgent(taskID)
	if agent == nil {
		http.Error(w, "Agent not found", http.StatusNotFound)
		return
	}

	// Parse request body
	var req struct {
		Response string `json:"response"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Response == "" {
		http.Error(w, "Response is required", http.StatusBadRequest)
		return
	}

	// Use StepTaskID if available, otherwise fall back to taskID
	processTaskID := taskID
	if agent.StepTaskID != "" {
		processTaskID = agent.StepTaskID
	}

	// Send input to agent stdin
	if err := h.processManager.WriteToStdin(processTaskID, req.Response); err != nil {
		http.Error(w, "Failed to send response: "+err.Error(), http.StatusInternalServerError)
		return
	}

	response := struct {
		TaskID  string `json:"task_id"`
		Status  string `json:"status"`
		Message string `json:"message"`
	}{
		TaskID:  taskID,
		Status:  "sent",
		Message: "Response sent to agent",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
