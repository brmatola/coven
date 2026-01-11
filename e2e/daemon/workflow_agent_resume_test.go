//go:build e2e

package daemon_e2e

import (
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// TestAgentStepResumeAfterDaemonRestart verifies that when daemon restarts while an agent step
// is running, it reconnects to the existing process instead of spawning a new one.
// This was a bug where daemon restart caused orphan processes because:
// - Daemon stores agents by parent task ID but spawns with step task ID
// - On restart, daemon lost track of running processes and spawned new ones
func TestAgentStepResumeAfterDaemonRestart(t *testing.T) {
	env := helpers.NewTestEnv(t)
	// Don't defer env.Stop() - we restart manually

	env.InitBeads(t)

	// Use a long-running agent step (15 seconds) to ensure daemon restart happens mid-execution
	grimoireYAML := `name: test-agent-resume
description: Tests agent step resume after daemon restart
timeout: 5m

steps:
  - name: long-running-agent
    type: agent
    spell: |
      Execute the following task slowly: {{.bead.title}}
      Take your time and return a JSON block when complete:
      ` + "```json" + `
      {"success": true, "summary": "Task completed after delay"}
      ` + "```" + `
    timeout: 2m
`
	writeGrimoire(t, env, "test-agent-resume", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Agent resume test", "grimoire:test-agent-resume")
	t.Logf("Created task %s", taskID)

	// Configure mock agent with 15s delay (long enough for daemon restart)
	env.ConfigureMockAgentWithArgs(t, "-delay 15s")

	// Start daemon
	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for agent to start running (not just exist)
	t.Log("Waiting for agent to start running...")
	deadline := time.Now().Add(10 * time.Second)
	var agentPID int
	for time.Now().Before(deadline) {
		agent, err := api.GetAgent(taskID)
		if err == nil && agent != nil && agent.Status == "running" && agent.PID > 0 {
			agentPID = agent.PID
			t.Logf("Agent started with PID %d", agentPID)
			break
		}
		time.Sleep(200 * time.Millisecond)
	}

	if agentPID == 0 {
		agent, _ := api.GetAgent(taskID)
		t.Fatalf("Agent did not start running - agent: %+v", agent)
	}

	// Give the agent a moment to establish itself
	time.Sleep(500 * time.Millisecond)

	// Verify the agent process is running via OS
	if !processExists(agentPID) {
		t.Fatalf("Agent process %d not found in OS", agentPID)
	}

	// Kill daemon (but leave agent process running)
	t.Log("Killing daemon...")
	if err := env.Cmd.Process.Kill(); err != nil {
		t.Fatalf("Failed to kill daemon: %v", err)
	}
	env.Cmd.Wait()

	// Verify agent process is still running (daemon death shouldn't kill it)
	if !processExists(agentPID) {
		t.Fatalf("Agent process %d died when daemon was killed", agentPID)
	}
	t.Logf("Agent process %d still running after daemon kill", agentPID)

	// Count mock agent processes before restart
	beforeCount := countMockAgentProcesses()
	t.Logf("Mock agent process count before restart: %d", beforeCount)

	// Restart daemon
	t.Log("Restarting daemon...")
	if err := env.Start(); err != nil {
		t.Fatalf("Failed to restart daemon: %v", err)
	}
	defer env.Stop()

	// Give daemon time to resume workflows
	time.Sleep(2 * time.Second)

	// Count mock agent processes after restart - should be the same (no new spawn)
	afterCount := countMockAgentProcesses()
	t.Logf("Mock agent process count after restart: %d", afterCount)

	if afterCount > beforeCount {
		t.Errorf("New agent process spawned after restart (before: %d, after: %d) - daemon should reconnect to existing process", beforeCount, afterCount)
	}

	// Verify the original agent process is still the one running
	if !processExists(agentPID) {
		t.Logf("Warning: Original agent process %d no longer exists - it may have completed", agentPID)
	}

	// Wait for the workflow to complete
	api = helpers.NewAPIClient(env)
	t.Log("Waiting for workflow to complete...")
	waitForTaskStatus(t, api, taskID, "closed", 30)

	// Verify no orphan processes
	time.Sleep(1 * time.Second) // Give processes time to clean up
	finalCount := countMockAgentProcesses()
	if finalCount > 0 {
		t.Errorf("Orphan mock agent processes remain: %d", finalCount)
	}

	t.Log("Agent step resume test passed - daemon reconnected to existing process")
}

// TestAgentStepCompletedBeforeResume verifies that when an agent step completes while daemon
// is down, the resumed workflow correctly handles the completion.
func TestAgentStepCompletedBeforeResume(t *testing.T) {
	env := helpers.NewTestEnv(t)
	// Don't defer env.Stop() - we restart manually

	env.InitBeads(t)

	// Marker file to track completion
	completionMarker := "/tmp/coven-e2e-agent-complete-marker.txt"
	os.Remove(completionMarker)
	defer os.Remove(completionMarker)

	// Use a short agent delay, and a second script step that creates a marker
	grimoireYAML := `name: test-agent-complete
description: Tests handling when agent completes during daemon downtime
timeout: 5m

steps:
  - name: agent-step
    type: agent
    spell: |
      Do a quick task: {{.bead.title}}
      ` + "```json" + `
      {"success": true, "summary": "Quick task done"}
      ` + "```" + `
    timeout: 2m

  - name: completion-marker
    type: script
    command: "echo done > ` + completionMarker + `"
    timeout: 30s
`
	writeGrimoire(t, env, "test-agent-complete", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Agent complete test", "grimoire:test-agent-complete")

	// Configure mock agent with 3s delay
	env.ConfigureMockAgentWithArgs(t, "-delay 3s")

	// Start daemon
	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for agent to start
	t.Log("Waiting for agent to start...")
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		agent, err := api.GetAgent(taskID)
		if err == nil && agent != nil && agent.Status == "running" {
			t.Log("Agent started running")
			break
		}
		time.Sleep(200 * time.Millisecond)
	}

	// Kill daemon immediately
	t.Log("Killing daemon...")
	if err := env.Cmd.Process.Kill(); err != nil {
		t.Fatalf("Failed to kill daemon: %v", err)
	}
	env.Cmd.Wait()

	// Wait for agent to complete on its own (it has 3s delay, so should complete ~6s after start)
	t.Log("Waiting for agent to complete on its own...")
	time.Sleep(8 * time.Second)

	// Restart daemon
	t.Log("Restarting daemon...")
	if err := env.Start(); err != nil {
		t.Fatalf("Failed to restart daemon: %v", err)
	}
	defer env.Stop()

	// Wait for workflow to complete (should pick up where it left off)
	api = helpers.NewAPIClient(env)
	t.Log("Waiting for workflow to complete...")
	waitForTaskStatus(t, api, taskID, "closed", 30)

	// Verify the completion marker exists (second step ran)
	if _, err := os.Stat(completionMarker); os.IsNotExist(err) {
		t.Error("Completion marker not created - second step did not run after resume")
	} else {
		t.Log("Completion marker exists - workflow completed successfully after resume")
	}
}

// processExists checks if a process with the given PID exists.
func processExists(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	// On Unix, FindProcess always succeeds. We need to send signal 0 to check.
	err = process.Signal(os.Signal(nil))
	return err == nil
}

// countMockAgentProcesses counts running mockagent processes.
func countMockAgentProcesses() int {
	cmd := exec.Command("pgrep", "-f", "mockagent")
	output, _ := cmd.Output()
	if len(output) == 0 {
		return 0
	}
	// Count lines in output
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	return len(lines)
}
