//go:build e2e

package daemon_e2e

import (
	"bufio"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// TestEventStreamConnection verifies that clients can connect to the SSE event stream.
func TestEventStreamConnection(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	// Connect to event stream
	resp, err := env.Client.Get("http://unix/events")
	if err != nil {
		t.Fatalf("Failed to connect to events: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Unexpected status: %d", resp.StatusCode)
	}

	// Read first event (should be state snapshot or heartbeat)
	reader := bufio.NewReader(resp.Body)

	// Read with timeout
	done := make(chan struct{})
	var event string
	go func() {
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				close(done)
				return
			}
			event += line
			// SSE events end with double newline
			if strings.HasSuffix(event, "\n\n") || strings.Contains(event, "data:") {
				close(done)
				return
			}
		}
	}()

	select {
	case <-done:
		t.Logf("Received event: %s", strings.TrimSpace(event))
	case <-time.After(5 * time.Second):
		t.Fatal("Timeout waiting for event")
	}

	// Verify it's a valid SSE event
	if !strings.Contains(event, "event:") && !strings.Contains(event, "data:") {
		t.Errorf("Expected SSE format, got: %s", event)
	}
}

// TestEventStreamAgentEvents verifies that agent lifecycle events are emitted.
func TestEventStreamAgentEvents(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	// Set up environment
	taskID := env.SetupWithMockAgentAndTask(t, "Test task for events")

	env.MustStart()
	api := helpers.NewAPIClient(env)

	// Start session

	// Connect to event stream
	resp, err := env.Client.Get("http://unix/events")
	if err != nil {
		t.Fatalf("Failed to connect to events: %v", err)
	}
	defer resp.Body.Close()

	// Wait for tasks to sync
	time.Sleep(500 * time.Millisecond)

	// Start task (this should generate events)
	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Read events and look for agent events
	reader := bufio.NewReader(resp.Body)
	events := []string{}

	timeout := time.After(10 * time.Second)
	foundAgentEvent := false

	for !foundAgentEvent {
		select {
		case <-timeout:
			t.Logf("Events received: %v", events)
			t.Fatal("Timeout waiting for agent events")
		default:
			line, err := reader.ReadString('\n')
			if err != nil {
				continue
			}

			if strings.HasPrefix(line, "event:") || strings.HasPrefix(line, "data:") {
				events = append(events, strings.TrimSpace(line))
			}

			// Check for agent-related events
			if strings.Contains(line, "agent") {
				foundAgentEvent = true
				t.Logf("Found agent event: %s", strings.TrimSpace(line))
			}
		}
	}

	t.Logf("Total events received: %d", len(events))
}

// TestEventStreamHeartbeat verifies that periodic heartbeat events (state.snapshot) are sent.
// This is critical for SSE clients to detect connection health.
func TestEventStreamHeartbeat(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	// Connect to event stream (use SSEClient which has no timeout)
	resp, err := env.SSEClient.Get("http://unix/events")
	if err != nil {
		t.Fatalf("Failed to connect to events: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Unexpected status: %d", resp.StatusCode)
	}

	reader := bufio.NewReader(resp.Body)

	// We should receive:
	// 1. Initial state.snapshot on connect
	// 2. Another state.snapshot within 35 seconds (heartbeat interval is 30s)

	snapshotCount := 0
	start := time.Now()

	// Read events in a goroutine with proper line reading
	lineCh := make(chan string, 100)
	errCh := make(chan error, 1)

	go func() {
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				errCh <- err
				return
			}
			lineCh <- line
		}
	}()

	timeout := time.After(35 * time.Second)

	for snapshotCount < 2 {
		select {
		case <-timeout:
			t.Fatalf("Timeout: only received %d state.snapshot events in 35s (expected at least 2)", snapshotCount)
		case err := <-errCh:
			t.Fatalf("Read error: %v", err)
		case line := <-lineCh:
			if strings.HasPrefix(line, "event: state.snapshot") {
				snapshotCount++
				t.Logf("Received state.snapshot #%d at %v", snapshotCount, time.Since(start))
			}
		}
	}

	elapsed := time.Since(start)
	t.Logf("Received 2 state.snapshot events in %v", elapsed)

	// The second snapshot should arrive around 30 seconds after the first
	if elapsed < 25*time.Second {
		t.Logf("Note: snapshots arrived faster than expected (%v), which is fine", elapsed)
	}
}
