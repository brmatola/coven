package beads

import (
	"net/http"

	"github.com/coven/daemon/internal/api"
	"github.com/coven/daemon/internal/state"
)

// Handlers provides HTTP handlers for task operations.
type Handlers struct {
	store *state.Store
}

// NewHandlers creates task HTTP handlers.
func NewHandlers(store *state.Store) *Handlers {
	return &Handlers{store: store}
}

// HandleTasks handles GET /tasks.
func (h *Handlers) HandleTasks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		api.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	tasks := h.store.GetTasks()
	lastSync := h.store.GetLastTaskSync()

	response := struct {
		Tasks    any    `json:"tasks"`
		Count    int    `json:"count"`
		LastSync any    `json:"last_sync,omitempty"`
	}{
		Tasks:    tasks,
		Count:    len(tasks),
		LastSync: lastSync,
	}

	api.WriteJSON(w, http.StatusOK, response)
}

// Register registers task handlers on the given server.
func (h *Handlers) Register(s *api.Server) {
	s.RegisterHandlerFunc("/tasks", h.HandleTasks)
}
