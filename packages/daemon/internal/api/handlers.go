package api

import (
	"net/http"
	"runtime"
	"time"

	"github.com/coven/daemon/internal/state"
	"github.com/coven/daemon/pkg/types"
)

// Handlers provides HTTP handlers for the daemon API.
type Handlers struct {
	store     *state.Store
	version   string
	gitCommit string
	buildTime string
	startTime time.Time
	workspace string
}

// NewHandlers creates a new handlers instance.
func NewHandlers(store *state.Store, version, gitCommit, buildTime, workspace string) *Handlers {
	return &Handlers{
		store:     store,
		version:   version,
		gitCommit: gitCommit,
		buildTime: buildTime,
		startTime: time.Now(),
		workspace: workspace,
	}
}

// HandleHealth returns the daemon health status.
func (h *Handlers) HandleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	health := types.HealthStatus{
		Status:    "healthy",
		Version:   h.version,
		Uptime:    time.Since(h.startTime).String(),
		Workspace: h.workspace,
	}

	WriteJSON(w, http.StatusOK, health)
}

// HandleVersion returns version information.
func (h *Handlers) HandleVersion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	version := types.VersionInfo{
		Version:   h.version,
		GitCommit: h.gitCommit,
		BuildTime: h.buildTime,
		GoVersion: runtime.Version(),
	}

	WriteJSON(w, http.StatusOK, version)
}

// HandleState returns the current daemon state.
func (h *Handlers) HandleState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	state := h.store.GetState()
	response := types.StateResponse{
		State:     state,
		Timestamp: time.Now(),
	}

	WriteJSON(w, http.StatusOK, response)
}

// Register registers all handlers on the given server.
func (h *Handlers) Register(s *Server) {
	s.RegisterHandlerFunc("/health", h.HandleHealth)
	s.RegisterHandlerFunc("/version", h.HandleVersion)
	s.RegisterHandlerFunc("/state", h.HandleState)
}
