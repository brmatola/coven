package questions

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/coven/daemon/internal/agent"
	"github.com/coven/daemon/internal/api"
)

// Handlers provides HTTP handlers for question operations.
type Handlers struct {
	store          *Store
	detector       *Detector
	processManager *agent.ProcessManager
}

// NewHandlers creates new question handlers.
func NewHandlers(store *Store, detector *Detector, pm *agent.ProcessManager) *Handlers {
	return &Handlers{
		store:          store,
		detector:       detector,
		processManager: pm,
	}
}

// Register registers question handlers with the server.
func (h *Handlers) Register(server *api.Server) {
	server.RegisterHandlerFunc("/questions", h.handleQuestions)
	server.RegisterHandlerFunc("/questions/", h.handleQuestionByID)
}

// handleQuestions handles GET /questions
// @Summary      Get all questions
// @Description  Returns a list of pending questions, optionally filtered by task ID
// @Tags         questions
// @Accept       json
// @Produce      json
// @Param        task_id  query     string  false  "Filter by task ID"
// @Param        pending  query     string  false  "Include only pending questions (default: true)"
// @Success      200      {object}  map[string]interface{}  "Questions response"
// @Failure      405      {object}  map[string]string       "Method not allowed"
// @Router       /questions [get]
func (h *Handlers) handleQuestions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Check for task_id filter
	taskID := r.URL.Query().Get("task_id")
	pendingOnly := r.URL.Query().Get("pending") != "false" // Default to pending only

	var questions []*Question
	if taskID != "" {
		questions = h.store.GetPendingForTask(taskID)
	} else if pendingOnly {
		questions = h.store.GetAllPending()
	} else {
		questions = h.store.GetAllPending() // TODO: Add GetAll if needed
	}

	response := struct {
		Questions    []*Question `json:"questions"`
		Count        int         `json:"count"`
		PendingCount int         `json:"pending_count"`
	}{
		Questions:    questions,
		Count:        len(questions),
		PendingCount: h.store.PendingCount(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleQuestionByID handles /questions/:id endpoints
func (h *Handlers) handleQuestionByID(w http.ResponseWriter, r *http.Request) {
	// Parse path: /questions/{id} or /questions/{id}/answer
	path := strings.TrimPrefix(r.URL.Path, "/questions/")
	parts := strings.SplitN(path, "/", 2)

	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "Question ID required", http.StatusBadRequest)
		return
	}

	questionID := parts[0]
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	switch action {
	case "":
		h.handleGetQuestion(w, r, questionID)
	case "answer":
		h.handleAnswerQuestion(w, r, questionID)
	default:
		http.Error(w, "Unknown action", http.StatusNotFound)
	}
}

// handleGetQuestion handles GET /questions/:id
// @Summary      Get question by ID
// @Description  Returns a specific question by its ID
// @Tags         questions
// @Accept       json
// @Produce      json
// @Param        id   path      string  true  "Question ID"
// @Success      200  {object}  Question  "Question information"
// @Failure      404  {object}  map[string]string  "Question not found"
// @Failure      405  {object}  map[string]string  "Method not allowed"
// @Router       /questions/{id} [get]
func (h *Handlers) handleGetQuestion(w http.ResponseWriter, r *http.Request, questionID string) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	question := h.store.Get(questionID)
	if question == nil {
		http.Error(w, "Question not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(question)
}

// handleAnswerQuestion handles POST /questions/:id/answer
// @Summary      Answer a question
// @Description  Records an answer to a pending question and delivers it to the agent
// @Tags         questions
// @Accept       json
// @Produce      json
// @Param        id   path      string  true  "Question ID"
// @Param        body body      object  true  "Answer body"  SchemaExample({"answer":"answer text"})
// @Success      200  {object}  map[string]interface{}  "Answer response"
// @Failure      400  {object}  map[string]string       "Invalid request"
// @Failure      404  {object}  map[string]string       "Question not found"
// @Failure      405  {object}  map[string]string       "Method not allowed"
// @Failure      409  {object}  map[string]string       "Question already answered"
// @Router       /questions/{id}/answer [post]
func (h *Handlers) handleAnswerQuestion(w http.ResponseWriter, r *http.Request, questionID string) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Check if question exists
	question := h.store.Get(questionID)
	if question == nil {
		http.Error(w, "Question not found", http.StatusNotFound)
		return
	}

	// Check if already answered
	if question.AnsweredAt != nil {
		http.Error(w, "Question already answered", http.StatusConflict)
		return
	}

	// Parse request body
	var req struct {
		Answer string `json:"answer"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Answer == "" {
		http.Error(w, "Answer is required", http.StatusBadRequest)
		return
	}

	// Mark as answered first
	if err := h.store.MarkAnswered(questionID, req.Answer); err != nil {
		http.Error(w, "Failed to record answer: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Deliver answer to agent stdin using the step task ID
	stepTaskID := question.Context.StepTaskID
	if stepTaskID == "" {
		// Fallback to task ID if no step task ID (shouldn't happen in workflow context)
		stepTaskID = question.TaskID
	}

	deliveryError := ""
	if err := h.processManager.WriteToStdin(stepTaskID, req.Answer); err != nil {
		deliveryError = err.Error()
		h.store.MarkDeliveryFailed(questionID, deliveryError)
	} else {
		h.store.MarkDelivered(questionID)
	}

	response := struct {
		QuestionID    string `json:"question_id"`
		TaskID        string `json:"task_id"`
		StepTaskID    string `json:"step_task_id,omitempty"`
		Status        string `json:"status"`
		Delivered     bool   `json:"delivered"`
		DeliveryError string `json:"delivery_error,omitempty"`
		Message       string `json:"message"`
	}{
		QuestionID:    questionID,
		TaskID:        question.TaskID,
		StepTaskID:    stepTaskID,
		Status:        "answered",
		Delivered:     deliveryError == "",
		DeliveryError: deliveryError,
		Message:       "Answer recorded",
	}

	if deliveryError != "" {
		response.Message = "Answer recorded but delivery failed"
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
