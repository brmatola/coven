//go:build e2e

package daemon_e2e

import (
	"strings"
	"testing"

	"github.com/coven/e2e/daemon/helpers"
)

// TestWorkflowLoopExitOnSuccess verifies loop exits early when step succeeds.
func TestWorkflowLoopExitOnSuccess(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	grimoireYAML := `name: test-loop-exit
description: Loop that exits on success
timeout: 5m

steps:
  - name: retry-loop
    type: loop
    max_iterations: 5
    steps:
      - name: attempt
        type: script
        command: "echo 'Attempt executed' && exit 0"
        on_success: exit_loop
        timeout: 30s
`
	writeGrimoire(t, env, "test-loop-exit", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test loop exit", "grimoire:test-loop-exit")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Should complete after first successful iteration
	waitForTaskStatus(t, api, taskID, "closed", 30)

	// Verify workflow completed successfully
	logContent := readDaemonLog(t, env)
	if !strings.Contains(logContent, `"status":"completed"`) {
		t.Logf("Log: %s", logContent)
		t.Error("Expected workflow to complete successfully")
	}
}

// TestWorkflowLoopContinueOnFail verifies loop continues when step fails.
func TestWorkflowLoopContinueOnFail(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// This grimoire succeeds on 3rd attempt using a counter file
	grimoireYAML := `name: test-loop-retry
description: Loop that retries on failure
timeout: 5m

steps:
  - name: init-counter
    type: script
    command: "echo '0' > /tmp/coven-e2e-counter.txt"
    timeout: 10s

  - name: retry-loop
    type: loop
    max_iterations: 5
    steps:
      - name: attempt-with-counter
        type: script
        command: |
          count=$(cat /tmp/coven-e2e-counter.txt)
          count=$((count + 1))
          echo $count > /tmp/coven-e2e-counter.txt
          echo "Attempt $count"
          if [ $count -lt 3 ]; then exit 1; fi
          exit 0
        on_success: exit_loop
        on_fail: continue
        timeout: 30s
`
	writeGrimoire(t, env, "test-loop-retry", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test loop retry", "grimoire:test-loop-retry")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	waitForTaskStatus(t, api, taskID, "closed", 60)

	// Verify workflow completed successfully
	logContent := readDaemonLog(t, env)
	if !strings.Contains(logContent, `"status":"completed"`) {
		t.Logf("Log: %s", logContent)
		t.Error("Expected workflow to complete successfully")
	}
}

// TestWorkflowLoopMaxIterations verifies loop respects max_iterations.
func TestWorkflowLoopMaxIterations(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	grimoireYAML := `name: test-loop-max
description: Loop that hits max iterations
timeout: 5m

steps:
  - name: bounded-loop
    type: loop
    max_iterations: 3
    on_max_iterations: block
    steps:
      - name: always-fail
        type: script
        command: "exit 1"
        on_fail: continue
        timeout: 30s
`
	writeGrimoire(t, env, "test-loop-max", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test loop max", "grimoire:test-loop-max")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Should block after max iterations
	waitForTaskStatus(t, api, taskID, "blocked", 60)

	// Verify workflow ended up blocked (from log)
	logContent := readDaemonLog(t, env)
	if !strings.Contains(logContent, `"status":"blocked"`) {
		t.Logf("Log: %s", logContent)
		t.Error("Expected workflow to reach blocked status")
	}
}

// TestWorkflowLoopWithAgent verifies loops containing agent steps.
func TestWorkflowLoopWithAgent(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	grimoireYAML := `name: test-loop-agent
description: Loop with agent step (implement-then-test pattern)
timeout: 10m

steps:
  - name: implement-test-loop
    type: loop
    max_iterations: 3
    steps:
      - name: implement
        type: agent
        spell: |
          Implement feature for bead {{.bead.id}}.
          Return: {"success": true, "summary": "Done"}
        timeout: 2m

      - name: run-tests
        type: script
        command: "exit 0"
        on_success: exit_loop
        timeout: 1m
`
	writeGrimoire(t, env, "test-loop-agent", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Implement with tests", "grimoire:test-loop-agent")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Should complete after one successful iteration
	waitForTaskStatus(t, api, taskID, "closed", 120)
}
