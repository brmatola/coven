package session

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/coven/daemon/internal/api"
)

// Handlers provides HTTP handlers for session operations.
type Handlers struct {
	manager *Manager
}

// NewHandlers creates session HTTP handlers.
func NewHandlers(manager *Manager) *Handlers {
	return &Handlers{manager: manager}
}

// StartRequest is the request body for POST /session/start.
type StartRequest struct {
	// Future: could include options like max_agents, timeout, etc.
}

// StartResponse is the response for POST /session/start.
type StartResponse struct {
	Status    string    `json:"status"`
	StartedAt time.Time `json:"started_at"`
}

// StopRequest is the request body for POST /session/stop.
type StopRequest struct {
	Force   bool `json:"force"`
	Timeout int  `json:"timeout"` // seconds, 0 = default (30s)
}

// StopResponse is the response for POST /session/stop.
type StopResponse struct {
	Status    string     `json:"status"`
	StoppedAt time.Time  `json:"stopped_at"`
	Forced    bool       `json:"forced"`
}

// HandleStart handles POST /session/start.
func (h *Handlers) HandleStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		api.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	if err := h.manager.Start(); err != nil {
		api.WriteError(w, http.StatusConflict, err.Error())
		return
	}

	api.WriteJSON(w, http.StatusOK, StartResponse{
		Status:    "started",
		StartedAt: time.Now(),
	})
}

// HandleStop handles POST /session/stop.
func (h *Handlers) HandleStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		api.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req StopRequest
	if r.Body != nil && r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			api.WriteError(w, http.StatusBadRequest, "invalid request body")
			return
		}
	}

	if req.Force {
		if err := h.manager.ForceStop(); err != nil {
			api.WriteError(w, http.StatusConflict, err.Error())
			return
		}
		api.WriteJSON(w, http.StatusOK, StopResponse{
			Status:    "stopped",
			StoppedAt: time.Now(),
			Forced:    true,
		})
		return
	}

	// Graceful stop with timeout
	timeout := 30 * time.Second
	if req.Timeout > 0 {
		timeout = time.Duration(req.Timeout) * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	if err := h.manager.Stop(ctx); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			api.WriteError(w, http.StatusGatewayTimeout, "stop timed out, use force=true to kill agents")
			return
		}
		api.WriteError(w, http.StatusConflict, err.Error())
		return
	}

	api.WriteJSON(w, http.StatusOK, StopResponse{
		Status:    "stopped",
		StoppedAt: time.Now(),
		Forced:    false,
	})
}

// HandleStatus handles GET /session/status.
func (h *Handlers) HandleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		api.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	type StatusResponse struct {
		Active   bool   `json:"active"`
		Stopping bool   `json:"stopping"`
		Status   string `json:"status"`
	}

	status := "inactive"
	if h.manager.IsActive() {
		status = "active"
	} else if h.manager.IsStopping() {
		status = "stopping"
	}

	api.WriteJSON(w, http.StatusOK, StatusResponse{
		Active:   h.manager.IsActive(),
		Stopping: h.manager.IsStopping(),
		Status:   status,
	})
}

// Register registers session handlers on the given server.
func (h *Handlers) Register(s *api.Server) {
	s.RegisterHandlerFunc("/session/start", h.HandleStart)
	s.RegisterHandlerFunc("/session/stop", h.HandleStop)
	s.RegisterHandlerFunc("/session/status", h.HandleStatus)
}
