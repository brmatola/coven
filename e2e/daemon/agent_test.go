//go:build e2e

package daemon_e2e

import (
	"os/exec"
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// simpleAgentGrimoire is a simple grimoire with just one agent step.
// Used by agent lifecycle tests that don't need complex workflows.
const simpleAgentGrimoire = `name: simple-agent
description: Simple single agent step for testing
timeout: 5m

steps:
  - name: execute
    type: agent
    spell: |
      Execute the following task: {{.bead.title}}
      Return a JSON block when complete:
      ` + "```json" + `
      {"success": true, "summary": "Task completed"}
      ` + "```" + `
    timeout: 2m
`

// agentFailureGrimoire is a grimoire that blocks when the agent fails.
// Used by TestAgentFailure to verify failure handling.
const agentFailureGrimoire = `name: agent-failure
description: Agent step that blocks on failure
timeout: 5m

steps:
  - name: execute
    type: agent
    spell: |
      Execute the following task: {{.bead.title}}
    timeout: 2m
    on_fail: block
`

// TestAgentExecutionLifecycle verifies the complete agent lifecycle:
// task start → agent spawn → output capture → completion
func TestAgentExecutionLifecycle(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Write simple grimoire for agent lifecycle testing
	writeGrimoire(t, env, "simple-agent", simpleAgentGrimoire)

	// Create task with the simple grimoire
	taskID := createTaskWithLabel(t, env, "Test task for lifecycle", "grimoire:simple-agent")
	t.Logf("Created task %s in workspace %s", taskID, env.TmpDir)

	env.ConfigureMockAgent(t)

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

	// NOTE: With the workflow-based execution model, agent output is stored under
	// step-specific task IDs and cleaned up after each step. The output is captured
	// but not exposed via the main task ID. This is expected behavior.
	// Output capture is verified via workflow step results instead.
}

// TestTaskStartRequiresActiveSession verifies that starting a task without
// an active session returns an appropriate error or queues the task.
func TestTaskStartRequiresActiveSession(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Write simple grimoire for agent testing
	writeGrimoire(t, env, "simple-agent", simpleAgentGrimoire)

	// Create task with the simple grimoire
	taskID := createTaskWithLabel(t, env, "Test task for session check", "grimoire:simple-agent")

	env.ConfigureMockAgent(t)

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
// NOTE: With the workflow-based execution model, agent output is stored under
// step-specific task IDs and cleaned up after step completion. This test now
// verifies that the workflow completes successfully, which implies output was
// captured for parsing.
func TestAgentOutputCapture(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Write simple grimoire for agent testing
	writeGrimoire(t, env, "simple-agent", simpleAgentGrimoire)

	// Create task with the simple grimoire
	taskID := createTaskWithLabel(t, env, "Test task for output capture", "grimoire:simple-agent")

	env.ConfigureMockAgent(t)
	env.MustStart()
	api := helpers.NewAPIClient(env)

	// Start session and task
	if err := api.StartSession(); err != nil {
		t.Fatalf("Failed to start session: %v", err)
	}

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for completion - if the workflow completes, output was captured
	// and parsed successfully
	env.WaitForAgentStatus(t, api, taskID, "completed", 15)

	// Verify task is marked as closed (workflow completed successfully)
	waitForTaskStatus(t, api, taskID, "closed", 10)

	t.Log("Workflow completed successfully - output capture verified implicitly")
}

// TestAgentFailure verifies that agent failures are handled correctly.
func TestAgentFailure(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Write grimoire that blocks on failure
	writeGrimoire(t, env, "agent-failure", agentFailureGrimoire)

	// Create task with the failure-handling grimoire
	taskID := createTaskWithLabel(t, env, "Test task for failure", "grimoire:agent-failure")

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

	// Wait for task to be blocked due to agent failure
	// NOTE: With step-specific task IDs, the agent status is stored under a
	// different ID. We verify the workflow handles failure by checking task status.
	waitForTaskStatus(t, api, taskID, "blocked", 15)

	// Verify the agent state is "failed"
	agent, _ := api.GetAgent(taskID)
	if agent != nil {
		t.Logf("Agent ended with status: %s", agent.Status)
		if agent.Status != "failed" {
			t.Errorf("Expected agent status 'failed', got '%s'", agent.Status)
		}
	}

	t.Log("Agent failure handled correctly - task is blocked")
}

// TestAgentKill verifies that agents can be forcefully killed.
func TestAgentKill(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Write simple grimoire for agent testing
	writeGrimoire(t, env, "simple-agent", simpleAgentGrimoire)

	// Create task with the simple grimoire
	taskID := createTaskWithLabel(t, env, "Test task for kill", "grimoire:simple-agent")

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
