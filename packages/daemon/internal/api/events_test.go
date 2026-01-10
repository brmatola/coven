package api

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coven/daemon/internal/state"
	"github.com/coven/daemon/pkg/types"
)

func TestNewEventBroker(t *testing.T) {
	tmpDir := t.TempDir()
	store := state.NewStore(tmpDir)
	broker := NewEventBroker(store)

	if broker == nil {
		t.Fatal("NewEventBroker() returned nil")
	}
	if broker.ClientCount() != 0 {
		t.Errorf("ClientCount() = %d, want 0", broker.ClientCount())
	}
}

func TestEventBrokerSubscribeUnsubscribe(t *testing.T) {
	tmpDir := t.TempDir()
	store := state.NewStore(tmpDir)
	broker := NewEventBroker(store)

	// Subscribe
	ch := broker.Subscribe()
	if ch == nil {
		t.Fatal("Subscribe() returned nil")
	}
	if broker.ClientCount() != 1 {
		t.Errorf("ClientCount() = %d, want 1", broker.ClientCount())
	}

	// Subscribe another
	ch2 := broker.Subscribe()
	if broker.ClientCount() != 2 {
		t.Errorf("ClientCount() = %d, want 2", broker.ClientCount())
	}

	// Unsubscribe
	broker.Unsubscribe(ch)
	if broker.ClientCount() != 1 {
		t.Errorf("ClientCount() = %d, want 1", broker.ClientCount())
	}

	broker.Unsubscribe(ch2)
	if broker.ClientCount() != 0 {
		t.Errorf("ClientCount() = %d, want 0", broker.ClientCount())
	}

	// Unsubscribe non-existent (should not panic)
	broker.Unsubscribe(make(chan *types.Event))
}

func TestEventBrokerBroadcast(t *testing.T) {
	tmpDir := t.TempDir()
	store := state.NewStore(tmpDir)
	broker := NewEventBroker(store)

	ch1 := broker.Subscribe()
	ch2 := broker.Subscribe()

	event := &types.Event{
		Type:      types.EventTypeTasksUpdated,
		Data:      "test",
		Timestamp: time.Now(),
	}

	broker.Broadcast(event)

	// Both clients should receive the event
	select {
	case received := <-ch1:
		if received.Type != event.Type {
			t.Errorf("ch1 received type = %q, want %q", received.Type, event.Type)
		}
	case <-time.After(time.Second):
		t.Error("ch1 did not receive event")
	}

	select {
	case received := <-ch2:
		if received.Type != event.Type {
			t.Errorf("ch2 received type = %q, want %q", received.Type, event.Type)
		}
	case <-time.After(time.Second):
		t.Error("ch2 did not receive event")
	}

	broker.Unsubscribe(ch1)
	broker.Unsubscribe(ch2)
}

func TestEventBrokerBroadcastFullBuffer(t *testing.T) {
	tmpDir := t.TempDir()
	store := state.NewStore(tmpDir)
	broker := NewEventBroker(store)

	ch := broker.Subscribe()

	// Fill the buffer (100 events)
	for i := 0; i < 150; i++ {
		broker.Broadcast(&types.Event{
			Type:      types.EventTypeHeartbeat,
			Timestamp: time.Now(),
		})
	}

	// Should not block or panic
	// Drain some events
	count := 0
	for {
		select {
		case <-ch:
			count++
		default:
			goto done
		}
	}
done:

	// Should have received up to buffer size
	if count > 100 {
		t.Errorf("Received %d events, expected <= 100", count)
	}

	broker.Unsubscribe(ch)
}

func TestEventBrokerStartStop(t *testing.T) {
	tmpDir := t.TempDir()
	store := state.NewStore(tmpDir)
	broker := NewEventBroker(store)

	broker.Start()

	// Starting again should be idempotent
	broker.Start()

	broker.Stop()

	// Stopping again should be idempotent
	broker.Stop()
}

func TestEventBrokerStopClosesClients(t *testing.T) {
	tmpDir := t.TempDir()
	store := state.NewStore(tmpDir)
	broker := NewEventBroker(store)

	ch := broker.Subscribe()
	broker.Start()

	broker.Stop()

	// Channel should be closed
	select {
	case _, ok := <-ch:
		if ok {
			t.Error("Channel should be closed")
		}
	case <-time.After(time.Second):
		t.Error("Channel was not closed")
	}

	if broker.ClientCount() != 0 {
		t.Errorf("ClientCount() = %d, want 0 after Stop()", broker.ClientCount())
	}
}

func TestEventBrokerHeartbeat(t *testing.T) {
	tmpDir := t.TempDir()
	store := state.NewStore(tmpDir)
	broker := NewEventBroker(store)
	broker.SetHeartbeatInterval(50 * time.Millisecond)

	ch := broker.Subscribe()
	broker.Start()
	defer broker.Stop()

	// Wait for heartbeat
	select {
	case event := <-ch:
		if event.Type != types.EventTypeStateSnapshot {
			t.Errorf("Event type = %q, want %q", event.Type, types.EventTypeStateSnapshot)
		}
	case <-time.After(200 * time.Millisecond):
		t.Error("Did not receive heartbeat")
	}

	broker.Unsubscribe(ch)
}

func TestEventEmitters(t *testing.T) {
	tmpDir := t.TempDir()
	store := state.NewStore(tmpDir)
	broker := NewEventBroker(store)

	ch := broker.Subscribe()
	defer broker.Unsubscribe(ch)

	tests := []struct {
		name     string
		emit     func()
		wantType string
	}{
		{
			name:     "TasksUpdated",
			emit:     func() { broker.EmitTasksUpdated([]types.Task{}) },
			wantType: types.EventTypeTasksUpdated,
		},
		{
			name:     "AgentStarted",
			emit:     func() { broker.EmitAgentStarted(&types.Agent{}) },
			wantType: types.EventTypeAgentStarted,
		},
		{
			name:     "AgentOutput",
			emit:     func() { broker.EmitAgentOutput("task-1", "output") },
			wantType: types.EventTypeAgentOutput,
		},
		{
			name:     "AgentCompleted",
			emit:     func() { broker.EmitAgentCompleted(&types.Agent{}) },
			wantType: types.EventTypeAgentCompleted,
		},
		{
			name:     "AgentFailed",
			emit:     func() { broker.EmitAgentFailed(&types.Agent{}, "error") },
			wantType: types.EventTypeAgentFailed,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.emit()

			select {
			case event := <-ch:
				if event.Type != tt.wantType {
					t.Errorf("Event type = %q, want %q", event.Type, tt.wantType)
				}
			case <-time.After(time.Second):
				t.Error("Did not receive event")
			}
		})
	}
}

func TestHandleEventsSSE(t *testing.T) {
	tmpDir := t.TempDir()
	store := state.NewStore(tmpDir)
	broker := NewEventBroker(store)

	socketPath := "/tmp/coven-events-test.sock"
	server := NewServer(socketPath)
	broker.Register(server)

	if err := server.Start(); err != nil {
		t.Fatalf("Failed to start server: %v", err)
	}
	defer server.Stop(context.Background())

	// Create client with SSE support
	client := &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return net.Dial("unix", socketPath)
			},
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", "http://unix/events", nil)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("Request error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	contentType := resp.Header.Get("Content-Type")
	if contentType != "text/event-stream" {
		t.Errorf("Content-Type = %q, want %q", contentType, "text/event-stream")
	}

	// Read initial state snapshot
	reader := bufio.NewReader(resp.Body)

	// Read event line
	eventLine, err := reader.ReadString('\n')
	if err != nil {
		t.Fatalf("Failed to read event line: %v", err)
	}
	if !strings.HasPrefix(eventLine, "event: ") {
		t.Errorf("Event line = %q, want prefix 'event: '", eventLine)
	}

	// Read data line
	dataLine, err := reader.ReadString('\n')
	if err != nil {
		t.Fatalf("Failed to read data line: %v", err)
	}
	if !strings.HasPrefix(dataLine, "data: ") {
		t.Errorf("Data line = %q, want prefix 'data: '", dataLine)
	}

	// Parse the event data
	jsonData := strings.TrimPrefix(dataLine, "data: ")
	var event types.Event
	if err := json.Unmarshal([]byte(jsonData), &event); err != nil {
		t.Fatalf("Failed to parse event: %v", err)
	}

	if event.Type != types.EventTypeStateSnapshot {
		t.Errorf("Event type = %q, want %q", event.Type, types.EventTypeStateSnapshot)
	}
}

func TestHandleEventsBroadcast(t *testing.T) {
	tmpDir := t.TempDir()
	store := state.NewStore(tmpDir)
	broker := NewEventBroker(store)

	socketPath := "/tmp/coven-events-test2.sock"
	server := NewServer(socketPath)
	broker.Register(server)

	if err := server.Start(); err != nil {
		t.Fatalf("Failed to start server: %v", err)
	}
	defer server.Stop(context.Background())

	client := &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return net.Dial("unix", socketPath)
			},
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, "GET", "http://unix/events", nil)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("Request error: %v", err)
	}
	defer resp.Body.Close()

	reader := bufio.NewReader(resp.Body)

	// Skip initial state snapshot (4 lines: event, data, empty, empty)
	for i := 0; i < 3; i++ {
		reader.ReadString('\n')
	}

	// Broadcast an event
	go func() {
		time.Sleep(50 * time.Millisecond)
		broker.EmitTasksUpdated([]types.Task{})
	}()

	// Read the broadcasted event
	eventLine, err := reader.ReadString('\n')
	if err != nil {
		t.Fatalf("Failed to read event: %v", err)
	}

	if !strings.Contains(eventLine, types.EventTypeTasksUpdated) {
		t.Errorf("Expected tasks.updated event, got: %s", eventLine)
	}
}

func TestSetHeartbeatInterval(t *testing.T) {
	tmpDir := t.TempDir()
	store := state.NewStore(tmpDir)
	broker := NewEventBroker(store)

	broker.SetHeartbeatInterval(5 * time.Second)

	if broker.heartbeatInterval != 5*time.Second {
		t.Errorf("heartbeatInterval = %v, want 5s", broker.heartbeatInterval)
	}
}
