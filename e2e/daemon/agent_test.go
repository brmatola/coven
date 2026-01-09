//go:build e2e

package daemon_e2e

import (
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// TestAgentExecutionLifecycle verifies the complete agent lifecycle:
// task start → agent spawn → output capture → completion
func TestAgentExecutionLifecycle(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	// Set up beads, mock agent, and create a task
	taskID := env.SetupWithMockAgentAndTask(t, "Test task for lifecycle")
	t.Logf("Created task %s in workspace %s", taskID, env.TmpDir)

	// Verify beads sees the task before starting daemon
	verifyCmd := exec.Command("bd", "ready", "--json")
	verifyCmd.Dir = env.TmpDir
	verifyOut, _ := verifyCmd.CombinedOutput()
	t.Logf("bd ready --json output: %s", string(verifyOut))

	// Start daemon
	env.MustStart()
	api := helpers.NewAPIClient(env)

	// Start session first (required for agent spawning)
	if err := api.StartSession(); err != nil {
		t.Fatalf("Failed to start session: %v", err)
	}

	// Wait for task to appear in daemon (beads polling)
	var foundTask bool
	for i := 0; i < 30; i++ { // Wait up to 3 seconds
		tasks, err := api.GetTasks()
		if err != nil {
			t.Logf("GetTasks error (retrying): %v", err)
		} else {
			for _, task := range tasks.Tasks {
				if task.ID == taskID {
					foundTask = true
					break
				}
			}
			if foundTask {
				break
			}
		}
		time.Sleep(100 * time.Millisecond)
	}

	if !foundTask {
		tasks, _ := api.GetTasks()
		t.Logf("Available tasks: %+v", tasks.Tasks)

		// Check daemon log for errors
		logPath := env.TmpDir + "/.coven/covend.log"
		if logData, err := exec.Command("cat", logPath).Output(); err == nil {
			t.Logf("Daemon log:\n%s", string(logData))
		}

		t.Fatalf("Task %s not found in daemon tasks after waiting", taskID)
	}

	// Start the task
	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for agent to appear
	agent := env.WaitForAgent(t, api, taskID, 10)
	if agent == nil {
		t.Fatal("Agent did not appear")
	}

	t.Logf("Agent appeared with status: %s", agent.Status)

	// Wait for agent to complete (mock agent completes quickly)
	var completedAgent *helpers.Agent
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		currentAgent, _ := api.GetAgent(taskID)
		if currentAgent != nil && currentAgent.Status == "completed" {
			completedAgent = currentAgent
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	if completedAgent == nil {
		// Get current agent state for debugging
		currentAgent, _ := api.GetAgent(taskID)
		t.Logf("Agent current state: %+v", currentAgent)

		// Check agent output for errors
		output, _ := api.GetAgentOutput(taskID)
		if output != nil {
			t.Logf("Agent output (%d lines):", output.LineCount)
			for _, line := range output.Lines {
				t.Logf("  [%d] %s: %s", line.Sequence, line.Stream, line.Data)
			}
		}

		// Check daemon log
		logPath := env.TmpDir + "/.coven/covend.log"
		if logData, err := exec.Command("tail", "-50", logPath).Output(); err == nil {
			t.Logf("Daemon log (last 50 lines):\n%s", string(logData))
		}

		// Check config
		configPath := env.TmpDir + "/.coven/config.json"
		if configData, err := exec.Command("cat", configPath).Output(); err == nil {
			t.Logf("Config:\n%s", string(configData))
		}

		t.Fatal("Agent did not complete")
	}

	t.Logf("Agent completed successfully")

	// Verify we have output
	output, err := api.GetAgentOutput(taskID)
	if err != nil {
		t.Fatalf("Failed to get agent output: %v", err)
	}

	if output.LineCount == 0 {
		t.Error("Expected output lines, got none")
	}

	t.Logf("Agent output: %d lines", output.LineCount)
	for _, line := range output.Lines {
		t.Logf("  [%d] %s", line.Sequence, line.Data)
	}
}

// TestTaskStartRequiresActiveSession verifies that starting a task without
// an active session returns an appropriate error or queues the task.
func TestTaskStartRequiresActiveSession(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	// Set up beads, mock agent, and create a task
	taskID := env.SetupWithMockAgentAndTask(t, "Test task for session check")

	// Start daemon (but don't start session)
	env.MustStart()
	api := helpers.NewAPIClient(env)

	// Try to start task without session
	err := api.StartTask(taskID)

	// This should either:
	// 1. Return an error indicating session is required
	// 2. Queue the task for when session starts
	// The implementation may vary, but we verify the agent doesn't spawn

	if err != nil {
		t.Logf("StartTask without session returned error (expected): %v", err)
	}

	// Give it a moment
	time.Sleep(500 * time.Millisecond)

	// Either way, there should be no running agents
	agents, err := api.GetAgents()
	if err != nil {
		t.Fatalf("Failed to get agents: %v", err)
	}

	// Check no agent is running for our task
	for _, a := range agents.Agents {
		if a.TaskID == taskID && (a.Status == "running" || a.Status == "starting") {
			t.Errorf("Agent should not be running without active session, got status: %s", a.Status)
		}
	}
}

// TestAgentOutputCapture verifies that agent output is captured correctly.
func TestAgentOutputCapture(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	// Set up environment
	taskID := env.SetupWithMockAgentAndTask(t, "Test task for output capture")

	env.MustStart()
	api := helpers.NewAPIClient(env)

	// Start session and task
	if err := api.StartSession(); err != nil {
		t.Fatalf("Failed to start session: %v", err)
	}

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for completion
	env.WaitForAgentStatus(t, api, taskID, "completed", 15)

	// Get output
	output, err := api.GetAgentOutput(taskID)
	if err != nil {
		t.Fatalf("Failed to get output: %v", err)
	}

	// Mock agent outputs:
	// "Starting work on: <task>"
	// "Task completed successfully"
	// Verify we captured at least these
	if output.LineCount < 2 {
		t.Errorf("Expected at least 2 output lines, got %d", output.LineCount)
	}

	// Check for expected content
	foundStarting := false
	foundCompleted := false
	for _, line := range output.Lines {
		if strings.Contains(line.Data, "Starting work on") {
			foundStarting = true
		}
		if strings.Contains(line.Data, "Task completed") {
			foundCompleted = true
		}
	}

	if !foundStarting {
		t.Error("Output should contain 'Starting work on'")
	}
	if !foundCompleted {
		t.Error("Output should contain 'Task completed'")
	}

	// Test output pagination with since parameter
	if output.LastSeq > 1 {
		partialOutput, err := api.GetAgentOutputSince(taskID, 1)
		if err != nil {
			t.Fatalf("Failed to get partial output: %v", err)
		}
		if partialOutput.LineCount >= output.LineCount {
			t.Errorf("Partial output should have fewer lines: got %d, expected less than %d",
				partialOutput.LineCount, output.LineCount)
		}
	}
}

// TestAgentFailure verifies that agent failures are handled correctly.
func TestAgentFailure(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	// Set up beads and task
	env.InitBeads(t)
	taskID := env.CreateBeadsTask(t, "Test task for failure", 1)

	// Configure mock agent with -fail flag using wrapper script
	env.ConfigureMockAgentWithArgs(t, "-fail")

	env.MustStart()
	api := helpers.NewAPIClient(env)

	// Start session and task
	if err := api.StartSession(); err != nil {
		t.Fatalf("Failed to start session: %v", err)
	}

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for agent to fail
	agent := env.WaitForAgentStatus(t, api, taskID, "failed", 15)
	if agent == nil {
		// Try checking for other terminal states
		finalAgent, _ := api.GetAgent(taskID)
		if finalAgent != nil {
			t.Logf("Agent ended with status: %s", finalAgent.Status)
			if finalAgent.Status != "failed" {
				t.Errorf("Expected agent status 'failed', got '%s'", finalAgent.Status)
			}
		} else {
			t.Error("Agent should have failed status")
		}
	}

	// Verify output contains error message
	output, err := api.GetAgentOutput(taskID)
	if err != nil {
		t.Fatalf("Failed to get output: %v", err)
	}

	foundError := false
	for _, line := range output.Lines {
		if strings.Contains(line.Data, "Error") || strings.Contains(line.Data, "failed") {
			foundError = true
			break
		}
	}
	if !foundError {
		t.Log("Output:")
		for _, line := range output.Lines {
			t.Logf("  [%d] %s", line.Sequence, line.Data)
		}
		t.Error("Expected error message in output")
	}
}

// TestAgentKill verifies that agents can be forcefully killed.
func TestAgentKill(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	// Set up environment with slow agent
	env.InitBeads(t)
	taskID := env.CreateBeadsTask(t, "Test task for kill", 1)

	// Configure mock agent with long delay using wrapper script
	env.ConfigureMockAgentWithArgs(t, "-delay 30s")

	env.MustStart()
	api := helpers.NewAPIClient(env)

	// Start session and task
	if err := api.StartSession(); err != nil {
		t.Fatalf("Failed to start session: %v", err)
	}

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for agent to start running
	env.WaitForAgentStatus(t, api, taskID, "running", 10)

	// Kill the agent
	if err := api.KillAgent(taskID); err != nil {
		t.Fatalf("Failed to kill agent: %v", err)
	}

	// Wait for killed status
	agent := env.WaitForAgentStatus(t, api, taskID, "killed", 10)
	if agent == nil {
		finalAgent, _ := api.GetAgent(taskID)
		if finalAgent != nil && finalAgent.Status != "killed" {
			t.Errorf("Expected agent status 'killed', got '%s'", finalAgent.Status)
		}
	}
}
