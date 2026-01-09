package questions

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/coven/daemon/internal/api"
)

// Handlers provides HTTP handlers for question operations.
type Handlers struct {
	detector *Detector
}

// NewHandlers creates new question handlers.
func NewHandlers(detector *Detector) *Handlers {
	return &Handlers{
		detector: detector,
	}
}

// Register registers question handlers with the server.
func (h *Handlers) Register(server *api.Server) {
	server.RegisterHandlerFunc("/questions", h.handleQuestions)
	server.RegisterHandlerFunc("/questions/", h.handleQuestionByID)
}

// handleQuestions handles GET /questions
func (h *Handlers) handleQuestions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Check for task_id filter
	taskID := r.URL.Query().Get("task_id")
	pendingOnly := r.URL.Query().Get("pending") == "true"

	var questions []*Question
	if taskID != "" {
		questions = h.detector.GetPendingQuestionsForTask(taskID)
	} else if pendingOnly {
		questions = h.detector.GetPendingQuestions()
	} else {
		// Return all questions for now
		questions = h.detector.GetPendingQuestions()
	}

	response := struct {
		Questions    []*Question `json:"questions"`
		Count        int         `json:"count"`
		PendingCount int         `json:"pending_count"`
	}{
		Questions:    questions,
		Count:        len(questions),
		PendingCount: h.detector.PendingCount(),
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
func (h *Handlers) handleGetQuestion(w http.ResponseWriter, r *http.Request, questionID string) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	question := h.detector.GetQuestion(questionID)
	if question == nil {
		http.Error(w, "Question not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(question)
}

// handleAnswerQuestion handles POST /questions/:id/answer
func (h *Handlers) handleAnswerQuestion(w http.ResponseWriter, r *http.Request, questionID string) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Check if question exists
	question := h.detector.GetQuestion(questionID)
	if question == nil {
		http.Error(w, "Question not found", http.StatusNotFound)
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

	// Mark as answered
	h.detector.AnswerQuestion(questionID, req.Answer)

	response := struct {
		QuestionID string `json:"question_id"`
		TaskID     string `json:"task_id"`
		Status     string `json:"status"`
		Message    string `json:"message"`
	}{
		QuestionID: questionID,
		TaskID:     question.TaskID,
		Status:     "answered",
		Message:    "Answer recorded",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
