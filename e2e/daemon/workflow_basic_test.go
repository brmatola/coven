//go:build e2e

package daemon_e2e

import (
	"strings"
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// TestWorkflowExecution verifies that tasks trigger grimoire-based workflow execution.
// When a task is started, the scheduler should:
// 1. Resolve the grimoire based on task labels/type
// 2. Execute steps in sequence
// 3. Pass context between steps
func TestWorkflowExecution(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Create a simple test grimoire with two sequential script steps
	grimoireYAML := `name: test-simple
description: Simple test workflow
timeout: 5m

steps:
  - name: step-one
    type: script
    command: "echo 'Step one executed' && echo 'OUTPUT=step1_done'"
    output: step1_result
    timeout: 1m

  - name: step-two
    type: script
    command: "echo 'Step two received: {{.step1_result}}'"
    timeout: 1m
`
	writeGrimoire(t, env, "test-simple", grimoireYAML)

	// Create a task with label that maps to our test grimoire
	taskID := createTaskWithLabel(t, env, "Test workflow task", "grimoire:test-simple")

	env.ConfigureMockAgent(t)
	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Give the workflow time to start
	time.Sleep(2 * time.Second)

	// Wait for workflow to complete
	// First, let's see what's happening
	logContent := readDaemonLog(t, env)
	t.Logf("Daemon log after start:\n%s", logContent)

	waitForTaskStatus(t, api, taskID, "closed", 10)

	// Verify both steps executed by checking the step count in logs
	logContent = readDaemonLog(t, env)
	if !strings.Contains(logContent, `"steps":2`) {
		t.Logf("Log content: %s", logContent)
		t.Error("Expected workflow to execute 2 steps")
	}

	// Verify workflow completed successfully
	if !strings.Contains(logContent, `"status":"completed"`) {
		t.Logf("Log content: %s", logContent)
		t.Error("Expected workflow status to be completed")
	}
}

// TestWorkflowWithAgentStep verifies workflows that include agent steps.
func TestWorkflowWithAgentStep(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Grimoire with setup script -> agent step -> verify script
	// Note: Agent step uses inline spell to avoid needing external spell file
	grimoireYAML := `name: test-agent-step
description: Workflow with agent step
timeout: 5m

steps:
  - name: setup
    type: script
    command: "echo 'Setting up...'"
    timeout: 30s

  - name: implement
    type: agent
    spell: |
      Implement the requested feature for bead {{.bead.id}}.
      Title: {{.bead.title}}

      Return a JSON block with:
      {"success": true, "summary": "Implementation complete"}
    timeout: 2m

  - name: verify
    type: script
    command: "echo 'Verifying implementation...'"
    timeout: 30s
`
	writeGrimoire(t, env, "test-agent-step", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Implement feature X", "grimoire:test-agent-step")

	env.ConfigureMockAgent(t)
	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for agent step - should see agent spawn
	agent := env.WaitForAgent(t, api, taskID, 15)
	if agent == nil {
		t.Fatal("Agent should have spawned for agent step")
	}

	// Wait for workflow to complete
	waitForTaskStatus(t, api, taskID, "closed", 15)
}

// TestWorkflowScriptStepFailure verifies that script step failures are handled.
func TestWorkflowScriptStepFailure(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	grimoireYAML := `name: test-fail
description: Workflow with failing step
timeout: 5m

steps:
  - name: will-fail
    type: script
    command: "exit 1"
    timeout: 30s

  - name: should-not-run
    type: script
    command: "echo 'This should not execute'"
    timeout: 30s
`
	writeGrimoire(t, env, "test-fail", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test failure handling", "grimoire:test-fail")

	env.ConfigureMockAgent(t)
	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Task should end up blocked or open (not closed) due to failure
	// Give it time to fail
	waitForTaskStatus(t, api, taskID, "blocked", 10)

	// Verify second step did not run
	logContent := readDaemonLog(t, env)
	if strings.Contains(logContent, "This should not execute") {
		t.Error("Second step should not have executed after first step failed")
	}
}
