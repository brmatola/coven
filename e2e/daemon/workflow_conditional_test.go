//go:build e2e

package daemon_e2e

import (
	"strings"
	"testing"

	"github.com/coven/e2e/daemon/helpers"
)

// TestWorkflowConditionalStepSkipped verifies steps are skipped when condition is false.
func TestWorkflowConditionalStepSkipped(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// The first step outputs "true", stored in flag_result.
	// The second step should be skipped because {{not .flag_result}} = false.
	// The third step should run unconditionally.
	grimoireYAML := `name: test-condition-skip
description: Workflow with conditional step that should be skipped
timeout: 5m

steps:
  - name: set-flag
    type: script
    command: "echo 'true'"
    output: flag_result
    timeout: 30s

  - name: conditional-skip
    type: script
    command: "echo 'SHOULD_NOT_RUN'"
    when: "{{not .flag_result}}"
    timeout: 30s

  - name: always-runs
    type: script
    command: "echo 'ALWAYS_RUNS'"
    timeout: 30s
`
	writeGrimoire(t, env, "test-condition-skip", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test condition skip", "grimoire:test-condition-skip")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	waitForTaskStatus(t, api, taskID, "closed", 10)

	logContent := readDaemonLog(t, env)

	// Verify the conditional step was skipped
	if strings.Contains(logContent, "SHOULD_NOT_RUN") {
		t.Error("Conditional step should have been skipped")
	}
	// The workflow should complete with status "completed"
	if !strings.Contains(logContent, `"status":"completed"`) {
		t.Log(logContent)
		t.Error("Final step should have executed")
	}
}

// TestWorkflowConditionalStepExecuted verifies steps run when condition is true.
func TestWorkflowConditionalStepExecuted(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// The first step outputs "true", stored in flag_result.
	// The second step should run because {{.flag_result}} = "true" (truthy).
	grimoireYAML := `name: test-condition-run
description: Workflow with conditional step that should run
timeout: 5m

steps:
  - name: set-flag
    type: script
    command: "echo 'true'"
    output: flag_result
    timeout: 30s

  - name: conditional-run
    type: script
    command: "echo 'CONDITION_MET'"
    when: "{{.flag_result}}"
    timeout: 30s
`
	writeGrimoire(t, env, "test-condition-run", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test condition run", "grimoire:test-condition-run")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	waitForTaskStatus(t, api, taskID, "closed", 10)

	// Verify the workflow completed successfully
	logContent := readDaemonLog(t, env)
	if !strings.Contains(logContent, `"status":"completed"`) {
		t.Log(logContent)
		t.Error("Conditional step should have executed when condition was true")
	}
}

// TestWorkflowConditionalWithPreviousResult verifies conditions based on previous step.
func TestWorkflowConditionalWithPreviousResult(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// First step succeeds.
	// Second step runs because {{.previous.success}} = true.
	// Third step is skipped because {{not .previous.success}} = false.
	// Workflow should complete with 3 steps (one skipped).
	grimoireYAML := `name: test-condition-previous
description: Condition based on previous step success
timeout: 5m

steps:
  - name: maybe-fail
    type: script
    command: "echo 'Success' && exit 0"
    timeout: 30s

  - name: on-success
    type: script
    command: "echo 'PREVIOUS_SUCCEEDED'"
    when: "{{.previous.success}}"
    timeout: 30s

  - name: on-failure
    type: script
    command: "echo 'PREVIOUS_FAILED'"
    when: "{{not .previous.success}}"
    timeout: 30s
`
	writeGrimoire(t, env, "test-condition-previous", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test condition previous", "grimoire:test-condition-previous")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	waitForTaskStatus(t, api, taskID, "closed", 10)

	// Verify the workflow completed successfully with 3 steps
	logContent := readDaemonLog(t, env)
	if !strings.Contains(logContent, `"status":"completed"`) {
		t.Log(logContent)
		t.Error("Workflow should have completed successfully")
	}
	if !strings.Contains(logContent, `"steps":3`) {
		t.Log(logContent)
		t.Error("Should have executed 3 steps (including skipped)")
	}
}
