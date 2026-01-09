package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/coven/daemon/internal/state"
	"github.com/coven/daemon/pkg/types"
)

// EventBroker manages SSE client connections and event broadcasting.
type EventBroker struct {
	mu      sync.RWMutex
	clients map[chan *types.Event]struct{}
	store   *state.Store

	// Heartbeat configuration
	heartbeatInterval time.Duration
	stopCh            chan struct{}
	running           bool
}

// NewEventBroker creates a new event broker.
func NewEventBroker(store *state.Store) *EventBroker {
	return &EventBroker{
		clients:           make(map[chan *types.Event]struct{}),
		store:             store,
		heartbeatInterval: 30 * time.Second,
	}
}

// Start begins the heartbeat loop.
func (b *EventBroker) Start() {
	b.mu.Lock()
	if b.running {
		b.mu.Unlock()
		return
	}
	b.running = true
	b.stopCh = make(chan struct{})
	b.mu.Unlock()

	go b.heartbeatLoop()
}

// Stop stops the heartbeat loop and disconnects all clients.
func (b *EventBroker) Stop() {
	b.mu.Lock()
	if !b.running {
		b.mu.Unlock()
		return
	}
	b.running = false
	close(b.stopCh)

	// Close all client channels
	for ch := range b.clients {
		close(ch)
		delete(b.clients, ch)
	}
	b.mu.Unlock()
}

// Subscribe adds a new client and returns their event channel.
func (b *EventBroker) Subscribe() chan *types.Event {
	ch := make(chan *types.Event, 100) // Buffer to prevent blocking

	b.mu.Lock()
	b.clients[ch] = struct{}{}
	b.mu.Unlock()

	return ch
}

// Unsubscribe removes a client.
func (b *EventBroker) Unsubscribe(ch chan *types.Event) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if _, ok := b.clients[ch]; ok {
		close(ch)
		delete(b.clients, ch)
	}
}

// Broadcast sends an event to all connected clients.
func (b *EventBroker) Broadcast(event *types.Event) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	for ch := range b.clients {
		select {
		case ch <- event:
		default:
			// Client buffer full, skip this event
		}
	}
}

// ClientCount returns the number of connected clients.
func (b *EventBroker) ClientCount() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.clients)
}

// heartbeatLoop sends periodic state snapshots to all clients.
func (b *EventBroker) heartbeatLoop() {
	ticker := time.NewTicker(b.heartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-b.stopCh:
			return
		case <-ticker.C:
			b.sendHeartbeat()
		}
	}
}

// sendHeartbeat sends a state snapshot to all clients.
func (b *EventBroker) sendHeartbeat() {
	state := b.store.GetState()
	b.Broadcast(&types.Event{
		Type:      types.EventTypeStateSnapshot,
		Data:      state,
		Timestamp: time.Now(),
	})
}

// Event helper methods for common events

// EmitSessionStarted broadcasts a session started event.
func (b *EventBroker) EmitSessionStarted() {
	b.Broadcast(&types.Event{
		Type:      types.EventTypeSessionStarted,
		Data:      b.store.GetSession(),
		Timestamp: time.Now(),
	})
}

// EmitSessionStopped broadcasts a session stopped event.
func (b *EventBroker) EmitSessionStopped() {
	b.Broadcast(&types.Event{
		Type:      types.EventTypeSessionStopped,
		Data:      b.store.GetSession(),
		Timestamp: time.Now(),
	})
}

// EmitTasksUpdated broadcasts a tasks updated event.
func (b *EventBroker) EmitTasksUpdated(tasks []types.Task) {
	b.Broadcast(&types.Event{
		Type:      types.EventTypeTasksUpdated,
		Data:      tasks,
		Timestamp: time.Now(),
	})
}

// EmitAgentStarted broadcasts an agent started event.
func (b *EventBroker) EmitAgentStarted(agent *types.Agent) {
	b.Broadcast(&types.Event{
		Type:      types.EventTypeAgentStarted,
		Data:      agent,
		Timestamp: time.Now(),
	})
}

// EmitAgentOutput broadcasts agent output.
func (b *EventBroker) EmitAgentOutput(taskID string, output string) {
	b.Broadcast(&types.Event{
		Type: types.EventTypeAgentOutput,
		Data: map[string]string{
			"task_id": taskID,
			"output":  output,
		},
		Timestamp: time.Now(),
	})
}

// EmitAgentCompleted broadcasts an agent completed event.
func (b *EventBroker) EmitAgentCompleted(agent *types.Agent) {
	b.Broadcast(&types.Event{
		Type:      types.EventTypeAgentCompleted,
		Data:      agent,
		Timestamp: time.Now(),
	})
}

// EmitAgentFailed broadcasts an agent failed event.
func (b *EventBroker) EmitAgentFailed(agent *types.Agent, err string) {
	b.Broadcast(&types.Event{
		Type: types.EventTypeAgentFailed,
		Data: map[string]any{
			"agent": agent,
			"error": err,
		},
		Timestamp: time.Now(),
	})
}

// SSE HTTP Handler

// HandleEvents handles the SSE endpoint.
func (b *EventBroker) HandleEvents(w http.ResponseWriter, r *http.Request) {
	// Check if the client supports SSE
	flusher, ok := w.(http.Flusher)
	if !ok {
		WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // Disable nginx buffering

	// Subscribe to events
	eventCh := b.Subscribe()
	defer b.Unsubscribe(eventCh)

	// Send initial state snapshot
	state := b.store.GetState()
	initialEvent := &types.Event{
		Type:      types.EventTypeStateSnapshot,
		Data:      state,
		Timestamp: time.Now(),
	}
	if err := writeSSEEvent(w, initialEvent); err != nil {
		return
	}
	flusher.Flush()

	// Stream events
	for {
		select {
		case <-r.Context().Done():
			// Client disconnected
			return
		case event, ok := <-eventCh:
			if !ok {
				// Channel closed
				return
			}
			if err := writeSSEEvent(w, event); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// writeSSEEvent writes a single SSE event to the response writer.
func writeSSEEvent(w http.ResponseWriter, event *types.Event) error {
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}

	// SSE format: "event: <type>\ndata: <json>\n\n"
	_, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, string(data))
	return err
}

// Register registers the SSE handler on the given server.
func (b *EventBroker) Register(s *Server) {
	s.RegisterHandlerFunc("/events", b.HandleEvents)
}

// SetHeartbeatInterval sets the heartbeat interval (for testing).
func (b *EventBroker) SetHeartbeatInterval(d time.Duration) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.heartbeatInterval = d
}
