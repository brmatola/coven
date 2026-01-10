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

	grimoireYAML := `name: test-condition-skip
description: Workflow with conditional step that should be skipped
timeout: 5m

steps:
  - name: set-flag
    type: script
    command: "echo 'SKIP=true'"
    output: flag_result
    timeout: 30s

  - name: conditional-skip
    type: script
    command: "echo 'SHOULD_NOT_RUN'"
    when: "{{.SKIP}} != 'true'"
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

	waitForTaskStatus(t, api, taskID, "closed", 30)

	logContent := readDaemonLog(t, env)

	if strings.Contains(logContent, "SHOULD_NOT_RUN") {
		t.Error("Conditional step should have been skipped")
	}
	if !strings.Contains(logContent, "ALWAYS_RUNS") {
		t.Error("Final step should have executed")
	}
}

// TestWorkflowConditionalStepExecuted verifies steps run when condition is true.
func TestWorkflowConditionalStepExecuted(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	grimoireYAML := `name: test-condition-run
description: Workflow with conditional step that should run
timeout: 5m

steps:
  - name: set-flag
    type: script
    command: "echo 'RUN=true'"
    output: flag_result
    timeout: 30s

  - name: conditional-run
    type: script
    command: "echo 'CONDITION_MET'"
    when: "{{.RUN}} == 'true'"
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

	waitForTaskStatus(t, api, taskID, "closed", 30)

	logContent := readDaemonLog(t, env)
	if !strings.Contains(logContent, "CONDITION_MET") {
		t.Error("Conditional step should have executed when condition was true")
	}
}

// TestWorkflowConditionalWithPreviousResult verifies conditions based on previous step.
func TestWorkflowConditionalWithPreviousResult(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

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

	waitForTaskStatus(t, api, taskID, "closed", 30)

	logContent := readDaemonLog(t, env)
	if !strings.Contains(logContent, "PREVIOUS_SUCCEEDED") {
		t.Error("Should have run on-success step")
	}
	if strings.Contains(logContent, "PREVIOUS_FAILED") {
		t.Error("Should NOT have run on-failure step")
	}
}
