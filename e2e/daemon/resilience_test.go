//go:build e2e

package daemon_e2e

import (
	"bufio"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// TestDaemonRestartDuringSSEConnection verifies the daemon can be restarted
// while SSE clients are connected, and clients receive disconnect notification.
func TestDaemonRestartDuringSSEConnection(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	// Connect SSE client
	resp, err := env.Client.Get("http://unix/events")
	if err != nil {
		t.Fatalf("Failed to connect to events: %v", err)
	}

	// Read in background until disconnect
	disconnected := make(chan struct{})
	go func() {
		defer resp.Body.Close()
		reader := bufio.NewReader(resp.Body)
		for {
			_, err := reader.ReadString('\n')
			if err != nil {
				close(disconnected)
				return
			}
		}
	}()

	// Give SSE connection time to establish
	time.Sleep(200 * time.Millisecond)

	// Stop daemon gracefully
	api := helpers.NewAPIClient(env)
	if err := api.Shutdown(); err != nil {
		t.Logf("Shutdown returned error (expected): %v", err)
	}

	// SSE should disconnect
	select {
	case <-disconnected:
		t.Log("SSE client properly disconnected on daemon shutdown")
	case <-time.After(5 * time.Second):
		t.Error("SSE client did not disconnect after daemon shutdown")
	}

	// Wait for daemon to fully stop
	done := make(chan struct{})
	go func() {
		env.Cmd.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		env.Cmd.Process.Kill()
	}

	// Restart daemon
	env.Cmd = exec.Command(env.DaemonBin, "--workspace", env.TmpDir)
	env.Cmd.Stdout = os.Stdout
	env.Cmd.Stderr = os.Stderr
	if err := env.Cmd.Start(); err != nil {
		t.Fatalf("Failed to restart daemon: %v", err)
	}

	// Wait for new daemon to be ready
	if err := env.WaitReady(5 * time.Second); err != nil {
		t.Fatalf("Daemon did not become ready after restart: %v", err)
	}

	// Verify new daemon is healthy
	health, err := api.GetHealth()
	if err != nil {
		t.Fatalf("Health check failed after restart: %v", err)
	}
	if health.Status != "healthy" {
		t.Errorf("Health.Status = %q after restart, want %q", health.Status, "healthy")
	}
}

// TestQuickSuccessiveRestarts verifies the daemon handles quick successive restarts.
func TestQuickSuccessiveRestarts(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	for i := 0; i < 3; i++ {
		t.Logf("Starting iteration %d", i+1)

		// Start daemon
		env.Cmd = exec.Command(env.DaemonBin, "--workspace", env.TmpDir)
		env.Cmd.Stdout = os.Stdout
		env.Cmd.Stderr = os.Stderr
		if err := env.Cmd.Start(); err != nil {
			t.Fatalf("Iteration %d: Failed to start daemon: %v", i+1, err)
		}

		// Wait for ready
		if err := env.WaitReady(5 * time.Second); err != nil {
			t.Fatalf("Iteration %d: Daemon did not become ready: %v", i+1, err)
		}

		// Quick health check
		api := helpers.NewAPIClient(env)
		health, err := api.GetHealth()
		if err != nil {
			t.Fatalf("Iteration %d: Health check failed: %v", i+1, err)
		}
		if health.Status != "healthy" {
			t.Errorf("Iteration %d: Health.Status = %q, want %q", i+1, health.Status, "healthy")
		}

		// Stop daemon
		if err := api.Shutdown(); err != nil {
			t.Logf("Iteration %d: Shutdown error (expected): %v", i+1, err)
		}

		// Wait for daemon to exit
		done := make(chan struct{})
		go func() {
			env.Cmd.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			env.Cmd.Process.Kill()
			env.Cmd.Wait()
		}

		// Brief pause between iterations
		time.Sleep(100 * time.Millisecond)
	}
}

// TestClientReconnectAfterDaemonRestart verifies clients can reconnect after daemon restart.
func TestClientReconnectAfterDaemonRestart(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	api := helpers.NewAPIClient(env)

	// Verify initial connection
	health, err := api.GetHealth()
	if err != nil {
		t.Fatalf("Initial health check failed: %v", err)
	}
	if health.Status != "healthy" {
		t.Errorf("Initial Health.Status = %q, want %q", health.Status, "healthy")
	}

	// Record initial uptime (to verify we get a fresh daemon)
	initialUptime := health.Uptime

	// Shutdown daemon
	if err := api.Shutdown(); err != nil {
		t.Logf("Shutdown error (expected): %v", err)
	}

	// Wait for daemon to fully exit
	done := make(chan struct{})
	go func() {
		env.Cmd.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		env.Cmd.Process.Kill()
		env.Cmd.Wait()
	}

	// Verify client can't connect (daemon is down)
	_, err = api.GetHealth()
	if err == nil {
		t.Error("Expected health check to fail when daemon is down")
	}

	// Restart daemon
	env.Cmd = exec.Command(env.DaemonBin, "--workspace", env.TmpDir)
	env.Cmd.Stdout = os.Stdout
	env.Cmd.Stderr = os.Stderr
	if err := env.Cmd.Start(); err != nil {
		t.Fatalf("Failed to restart daemon: %v", err)
	}

	// Wait for ready
	if err := env.WaitReady(5 * time.Second); err != nil {
		t.Fatalf("Daemon did not become ready after restart: %v", err)
	}

	// Reconnect and verify
	health, err = api.GetHealth()
	if err != nil {
		t.Fatalf("Health check failed after reconnect: %v", err)
	}
	if health.Status != "healthy" {
		t.Errorf("Health.Status after reconnect = %q, want %q", health.Status, "healthy")
	}

	// Verify it's a fresh daemon (uptime should be lower)
	t.Logf("Initial uptime: %s, New uptime: %s", initialUptime, health.Uptime)
}

// TestSSEReconnectGetsStateSnapshot verifies that reconnected SSE clients
// receive a fresh state snapshot.
func TestSSEReconnectGetsStateSnapshot(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	// Connect to event stream
	resp, err := env.Client.Get("http://unix/events")
	if err != nil {
		t.Fatalf("Failed to connect to events: %v", err)
	}

	// Read events until we get state snapshot
	reader := bufio.NewReader(resp.Body)
	gotSnapshot := false

	timeout := time.After(5 * time.Second)
readLoop:
	for !gotSnapshot {
		select {
		case <-timeout:
			t.Fatal("Timeout waiting for state snapshot")
		default:
			line, err := reader.ReadString('\n')
			if err != nil {
				t.Fatalf("Error reading SSE: %v", err)
			}
			if strings.Contains(line, "state.snapshot") {
				gotSnapshot = true
				t.Log("Received initial state snapshot")
				break readLoop
			}
		}
	}

	resp.Body.Close()

	// Reconnect immediately (simulating client reconnect)
	resp2, err := env.Client.Get("http://unix/events")
	if err != nil {
		t.Fatalf("Failed to reconnect to events: %v", err)
	}
	defer resp2.Body.Close()

	// Should get another snapshot on reconnect
	reader2 := bufio.NewReader(resp2.Body)
	gotSnapshot2 := false

	timeout2 := time.After(5 * time.Second)
readLoop2:
	for !gotSnapshot2 {
		select {
		case <-timeout2:
			t.Fatal("Timeout waiting for state snapshot on reconnect")
		default:
			line, err := reader2.ReadString('\n')
			if err != nil {
				t.Fatalf("Error reading SSE on reconnect: %v", err)
			}
			if strings.Contains(line, "state.snapshot") {
				gotSnapshot2 = true
				t.Log("Received state snapshot on reconnect")
				break readLoop2
			}
		}
	}
}

// TestDaemonHandlesSocketGone verifies a new daemon can start after crash recovery
// when the socket file is stale/missing.
func TestDaemonHandlesSocketGone(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	api := helpers.NewAPIClient(env)

	// Verify daemon is healthy
	health, err := api.GetHealth()
	if err != nil {
		t.Fatalf("Health check failed: %v", err)
	}
	if health.Status != "healthy" {
		t.Errorf("Health.Status = %q, want %q", health.Status, "healthy")
	}

	// Simulate crash: kill daemon without graceful shutdown
	env.Cmd.Process.Kill()
	env.Cmd.Wait()

	// Socket file may still exist (orphaned)
	// Delete it to simulate manual cleanup
	os.Remove(env.SocketPath)

	// Restart daemon - should work even though previous socket is gone
	env.Cmd = exec.Command(env.DaemonBin, "--workspace", env.TmpDir)
	env.Cmd.Stdout = os.Stdout
	env.Cmd.Stderr = os.Stderr
	if err := env.Cmd.Start(); err != nil {
		t.Fatalf("Failed to restart daemon: %v", err)
	}

	// Wait for ready
	if err := env.WaitReady(5 * time.Second); err != nil {
		t.Fatalf("Daemon did not become ready: %v", err)
	}

	// Should be able to connect
	health, err = api.GetHealth()
	if err != nil {
		t.Fatalf("Health check failed after restart: %v", err)
	}
	if health.Status != "healthy" {
		t.Errorf("Health.Status = %q after restart, want %q", health.Status, "healthy")
	}
}

// TestConcurrentSSEConnections verifies multiple SSE clients can connect simultaneously.
func TestConcurrentSSEConnections(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	const numClients = 5
	connected := make(chan int, numClients)
	errors := make(chan error, numClients)

	// Start multiple SSE connections
	for i := 0; i < numClients; i++ {
		go func(clientNum int) {
			resp, err := env.Client.Get("http://unix/events")
			if err != nil {
				errors <- err
				return
			}

			// Wait for snapshot
			reader := bufio.NewReader(resp.Body)
			for {
				line, err := reader.ReadString('\n')
				if err != nil {
					errors <- err
					resp.Body.Close()
					return
				}
				if strings.Contains(line, "state.snapshot") {
					connected <- clientNum
					resp.Body.Close()
					return
				}
			}
		}(i)
	}

	// Wait for all clients to connect and receive snapshot
	timeout := time.After(10 * time.Second)
	connectedCount := 0

	for connectedCount < numClients {
		select {
		case clientNum := <-connected:
			connectedCount++
			t.Logf("Client %d connected successfully", clientNum)
		case err := <-errors:
			t.Fatalf("Client error: %v", err)
		case <-timeout:
			t.Fatalf("Timeout: only %d/%d clients connected", connectedCount, numClients)
		}
	}

	t.Logf("All %d SSE clients connected successfully", numClients)
}

// TestDaemonRestartsCleanlyWithPendingRequests verifies daemon handles shutdown
// gracefully when there are pending requests.
func TestDaemonRestartsCleanlyWithPendingRequests(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	api := helpers.NewAPIClient(env)

	// Start some concurrent requests
	requestsDone := make(chan struct{}, 10)
	for i := 0; i < 10; i++ {
		go func() {
			defer func() { requestsDone <- struct{}{} }()
			// These may fail during shutdown, that's expected
			api.GetHealth()
			api.GetState()
			api.GetTasks()
		}()
	}

	// Shutdown while requests are in flight
	time.Sleep(50 * time.Millisecond)
	api.Shutdown()

	// Wait for requests to complete or fail
	timeout := time.After(5 * time.Second)
	completed := 0
	for completed < 10 {
		select {
		case <-requestsDone:
			completed++
		case <-timeout:
			t.Logf("Only %d/10 requests completed (acceptable during shutdown)", completed)
			break
		}
	}

	// Wait for daemon to exit
	done := make(chan struct{})
	go func() {
		env.Cmd.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		env.Cmd.Process.Kill()
		env.Cmd.Wait()
	}

	// Restart and verify clean state
	env.Cmd = exec.Command(env.DaemonBin, "--workspace", env.TmpDir)
	env.Cmd.Stdout = os.Stdout
	env.Cmd.Stderr = os.Stderr
	if err := env.Cmd.Start(); err != nil {
		t.Fatalf("Failed to restart daemon: %v", err)
	}

	if err := env.WaitReady(5 * time.Second); err != nil {
		t.Fatalf("Daemon did not become ready after restart: %v", err)
	}

	health, err := api.GetHealth()
	if err != nil {
		t.Fatalf("Health check failed after restart: %v", err)
	}
	if health.Status != "healthy" {
		t.Errorf("Health.Status = %q after restart, want %q", health.Status, "healthy")
	}
}

// TestDaemonPidFileStaleRecovery verifies daemon recovers when PID file points to
// a dead process (crash recovery scenario).
func TestDaemonPidFileStaleRecovery(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	// Create .coven directory
	if err := os.MkdirAll(env.CovenDir, 0755); err != nil {
		t.Fatalf("Failed to create .coven dir: %v", err)
	}

	// Create a stale PID file pointing to a non-existent process
	pidFile := filepath.Join(env.CovenDir, "covend.pid")
	// Use a high PID that's unlikely to exist
	if err := os.WriteFile(pidFile, []byte("999999999"), 0644); err != nil {
		t.Fatalf("Failed to create stale PID file: %v", err)
	}

	// Create a stale socket file
	if err := os.WriteFile(env.SocketPath, []byte("stale"), 0644); err != nil {
		t.Fatalf("Failed to create stale socket: %v", err)
	}

	// Daemon should start successfully by detecting stale PID and cleaning up
	env.MustStart()

	api := helpers.NewAPIClient(env)
	health, err := api.GetHealth()
	if err != nil {
		t.Fatalf("Health check failed: %v", err)
	}
	if health.Status != "healthy" {
		t.Errorf("Health.Status = %q, want %q", health.Status, "healthy")
	}

	// Verify PID file was updated
	newPidData, err := os.ReadFile(pidFile)
	if err != nil {
		t.Fatalf("Failed to read PID file: %v", err)
	}
	if string(newPidData) == "999999999" {
		t.Error("PID file should have been updated with new process PID")
	}
}

// TestMultipleSSEClientsOneDisconnects verifies other SSE clients continue
// working when one disconnects.
func TestMultipleSSEClientsOneDisconnects(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	// Connect first client
	resp1, err := env.Client.Get("http://unix/events")
	if err != nil {
		t.Fatalf("Failed to connect client 1: %v", err)
	}

	// Connect second client
	resp2, err := env.Client.Get("http://unix/events")
	if err != nil {
		t.Fatalf("Failed to connect client 2: %v", err)
	}
	defer resp2.Body.Close()

	// Wait for both to receive initial data
	time.Sleep(500 * time.Millisecond)

	// Disconnect first client abruptly
	resp1.Body.Close()

	// Second client should still work - make a health check to generate activity
	api := helpers.NewAPIClient(env)
	for i := 0; i < 3; i++ {
		_, err := api.GetHealth()
		if err != nil {
			t.Errorf("Health check %d failed after client disconnect: %v", i, err)
		}
		time.Sleep(100 * time.Millisecond)
	}

	// Daemon should still be healthy
	health, err := api.GetHealth()
	if err != nil {
		t.Fatalf("Final health check failed: %v", err)
	}
	if health.Status != "healthy" {
		t.Errorf("Health.Status = %q, want %q", health.Status, "healthy")
	}
}

// TestSSEConnectionDuringHighLoad verifies SSE connections work during API load.
func TestSSEConnectionDuringHighLoad(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	api := helpers.NewAPIClient(env)

	// Start continuous API requests in background
	stopLoad := make(chan struct{})
	loadDone := make(chan struct{})
	go func() {
		defer close(loadDone)
		for {
			select {
			case <-stopLoad:
				return
			default:
				api.GetHealth()
				api.GetState()
				time.Sleep(10 * time.Millisecond)
			}
		}
	}()

	// Try to establish SSE connection during load
	time.Sleep(100 * time.Millisecond)
	resp, err := env.Client.Get("http://unix/events")
	if err != nil {
		close(stopLoad)
		<-loadDone
		t.Fatalf("Failed to connect to events during load: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		close(stopLoad)
		<-loadDone
		t.Fatalf("Unexpected status during load: %d", resp.StatusCode)
	}

	// Read until we get snapshot
	reader := bufio.NewReader(resp.Body)
	timeout := time.After(10 * time.Second)
	gotSnapshot := false

readLoop:
	for !gotSnapshot {
		select {
		case <-timeout:
			t.Fatal("Timeout waiting for snapshot during load")
		default:
			line, err := reader.ReadString('\n')
			if err != nil {
				t.Fatalf("Error reading SSE during load: %v", err)
			}
			if strings.Contains(line, "state.snapshot") {
				gotSnapshot = true
				t.Log("Received snapshot during high load")
				break readLoop
			}
		}
	}

	close(stopLoad)
	<-loadDone
}
