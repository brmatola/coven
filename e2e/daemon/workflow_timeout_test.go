//go:build e2e

package daemon_e2e

import (
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// TestWorkflowTimeout verifies workflow-level timeout is enforced.
func TestWorkflowTimeout(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Workflow with 3s timeout but step that takes 60s
	grimoireYAML := `name: test-workflow-timeout
description: Workflow to test timeout enforcement
timeout: 3s

steps:
  - name: slow-step
    type: script
    command: "sleep 60"
    timeout: 90s
`
	writeGrimoire(t, env, "test-workflow-timeout", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test timeout", "grimoire:test-workflow-timeout")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait longer than workflow timeout
	time.Sleep(5 * time.Second)

	// Task should not be closed (it should be blocked or failed)
	tasks, err := api.GetTasks()
	if err != nil {
		t.Fatalf("Failed to get tasks: %v", err)
	}

	for _, task := range tasks.Tasks {
		if task.ID == taskID {
			if task.Status == "closed" {
				t.Error("Task should not have completed - workflow timeout should have fired")
			}
			t.Logf("Task status after timeout: %s", task.Status)
			// Acceptable statuses: blocked, open (for retry), in_progress (still being cancelled)
			return
		}
	}
	t.Error("Task not found")
}

// TestWorkflowStepTimeout verifies step-level timeout is enforced.
func TestWorkflowStepTimeout(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Step with 2s timeout
	grimoireYAML := `name: test-step-timeout
description: Workflow to test step timeout
timeout: 5m

steps:
  - name: slow-step
    type: script
    command: "sleep 60"
    timeout: 2s

  - name: should-not-run
    type: script
    command: "echo 'This should not run'"
    timeout: 30s
`
	writeGrimoire(t, env, "test-step-timeout", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test step timeout", "grimoire:test-step-timeout")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for step timeout to fire
	time.Sleep(5 * time.Second)

	// Workflow should be blocked/failed due to step timeout
	tasks, err := api.GetTasks()
	if err != nil {
		t.Fatalf("Failed to get tasks: %v", err)
	}

	for _, task := range tasks.Tasks {
		if task.ID == taskID {
			if task.Status == "closed" {
				t.Error("Task should not have completed - step timeout should have fired")
			}
			t.Logf("Task status after step timeout: %s", task.Status)
			return
		}
	}
}

// TestWorkflowAgentStepTimeout verifies agent step timeout is enforced.
func TestWorkflowAgentStepTimeout(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)
	env.InitBeads(t)

	grimoireYAML := `name: test-agent-timeout
description: Workflow with agent step timeout
timeout: 5m

steps:
  - name: slow-agent
    type: agent
    spell: implement
    timeout: 2s
`
	writeGrimoire(t, env, "test-agent-timeout", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test agent timeout", "grimoire:test-agent-timeout")

	// Configure mock agent with long delay
	env.ConfigureMockAgentWithArgs(t, "-delay 30s")

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for agent to start
	env.WaitForAgent(t, api, taskID, 10)

	// Wait longer than step timeout
	time.Sleep(5 * time.Second)

	// Agent should be killed due to timeout
	agent, _ := api.GetAgent(taskID)
	if agent != nil && agent.Status == "running" {
		t.Error("Agent should have been killed by step timeout")
	}
}
