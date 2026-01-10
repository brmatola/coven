//go:build e2e

package daemon_e2e

import (
	"strings"
	"testing"

	"github.com/coven/e2e/daemon/helpers"
)

// TestWorkflowNestedLoops verifies nested loop execution (loop within loop).
func TestWorkflowNestedLoops(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Outer loop runs 2 iterations, inner loop runs 2 iterations each.
	// Total: 4 inner loop executions.
	grimoireYAML := `name: test-nested-loops
description: Test nested loop execution
timeout: 5m

steps:
  - name: outer-loop
    type: loop
    max_iterations: 2
    steps:
      - name: inner-loop
        type: loop
        max_iterations: 2
        steps:
          - name: inner-step
            type: script
            command: "echo 'Inner iteration complete'"
            timeout: 10s
`
	writeGrimoire(t, env, "test-nested-loops", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test nested loops", "grimoire:test-nested-loops")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Should complete after all iterations
	waitForTaskStatus(t, api, taskID, "closed", 15)

	// Verify workflow completed successfully
	logContent := readDaemonLog(t, env)
	if !strings.Contains(logContent, `"status":"completed"`) {
		t.Logf("Log: %s", logContent)
		t.Error("Expected workflow to complete successfully")
	}
}

// TestWorkflowNestedLoopEarlyExit verifies inner loop exit doesn't exit outer loop.
func TestWorkflowNestedLoopEarlyExit(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Inner loop exits on first success, but outer loop should continue.
	grimoireYAML := `name: test-nested-early-exit
description: Inner loop early exit
timeout: 5m

steps:
  - name: init-counter
    type: script
    command: "echo '0' > /tmp/coven-nested-counter.txt"
    timeout: 10s

  - name: outer-loop
    type: loop
    max_iterations: 3
    steps:
      - name: inner-loop
        type: loop
        max_iterations: 5
        steps:
          - name: inner-step
            type: script
            command: |
              count=$(cat /tmp/coven-nested-counter.txt)
              count=$((count + 1))
              echo $count > /tmp/coven-nested-counter.txt
              echo "Count: $count"
            on_success: exit_loop
            timeout: 10s
`
	writeGrimoire(t, env, "test-nested-early-exit", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test nested early exit", "grimoire:test-nested-early-exit")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Should complete - inner loop exits early, outer loop still runs 3 times
	waitForTaskStatus(t, api, taskID, "closed", 15)

	// Verify workflow completed successfully
	logContent := readDaemonLog(t, env)
	if !strings.Contains(logContent, `"status":"completed"`) {
		t.Logf("Log: %s", logContent)
		t.Error("Expected workflow to complete successfully")
	}
}

// TestWorkflowNestedLoopWithAgent verifies nested loops containing agent steps.
func TestWorkflowNestedLoopWithAgent(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Outer loop for features, inner loop for implement-test cycle.
	grimoireYAML := `name: test-nested-agent
description: Nested loops with agent step
timeout: 10m

steps:
  - name: feature-loop
    type: loop
    max_iterations: 2
    steps:
      - name: implement-test-loop
        type: loop
        max_iterations: 2
        steps:
          - name: implement
            type: agent
            spell: |
              Implement feature {{.loop.iteration}}.
              Return: {"success": true}
            timeout: 1m

          - name: run-tests
            type: script
            command: "exit 0"
            on_success: exit_loop
            timeout: 30s
`
	writeGrimoire(t, env, "test-nested-agent", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test nested agent", "grimoire:test-nested-agent")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Should complete after both outer iterations
	waitForTaskStatus(t, api, taskID, "closed", 30)

	// Verify workflow completed
	logContent := readDaemonLog(t, env)
	if !strings.Contains(logContent, `"status":"completed"`) {
		t.Logf("Log: %s", logContent)
		t.Error("Expected workflow to complete successfully")
	}
}
