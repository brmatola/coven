//go:build e2e

package daemon_e2e

import (
	"strings"
	"testing"

	"github.com/coven/e2e/daemon/helpers"
)

// TestWorkflowLoopConditionalSkip verifies conditionals inside loops work correctly.
func TestWorkflowLoopConditionalSkip(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Loop with conditional step that should be skipped on odd iterations.
	grimoireYAML := `name: test-loop-conditional
description: Loop with conditional step
timeout: 5m

steps:
  - name: init
    type: script
    command: "echo '0' > /tmp/coven-loop-cond.txt"
    timeout: 10s

  - name: conditional-loop
    type: loop
    max_iterations: 4
    steps:
      - name: increment
        type: script
        command: |
          count=$(cat /tmp/coven-loop-cond.txt)
          count=$((count + 1))
          echo $count > /tmp/coven-loop-cond.txt
          if [ $((count % 2)) -eq 0 ]; then
            echo "true"
          else
            echo "false"
          fi
        output: is_even
        timeout: 10s

      - name: even-only
        type: script
        command: "echo 'EVEN_ITERATION'"
        when: "{{eq .is_even \"true\"}}"
        timeout: 10s
`
	writeGrimoire(t, env, "test-loop-conditional", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test loop conditional", "grimoire:test-loop-conditional")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	waitForTaskStatus(t, api, taskID, "closed", 15)

	// Verify workflow completed
	logContent := readDaemonLog(t, env)
	if !strings.Contains(logContent, `"status":"completed"`) {
		t.Logf("Log: %s", logContent)
		t.Error("Expected workflow to complete successfully")
	}
}

// TestWorkflowLoopConditionalExitLoop verifies conditional exit_loop works.
func TestWorkflowLoopConditionalExitLoop(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Loop that conditionally exits based on a flag.
	grimoireYAML := `name: test-loop-cond-exit
description: Loop with conditional exit
timeout: 5m

steps:
  - name: init
    type: script
    command: "echo '0' > /tmp/coven-cond-exit.txt"
    timeout: 10s

  - name: conditional-exit-loop
    type: loop
    max_iterations: 10
    steps:
      - name: increment
        type: script
        command: |
          count=$(cat /tmp/coven-cond-exit.txt)
          count=$((count + 1))
          echo $count > /tmp/coven-cond-exit.txt
          echo "Iteration $count"
          if [ $count -ge 3 ]; then
            echo "true"
          else
            echo "false"
          fi
        output: should_exit
        timeout: 10s

      - name: maybe-exit
        type: script
        command: "echo 'Exiting loop'"
        when: "{{eq .should_exit \"true\"}}"
        on_success: exit_loop
        timeout: 10s
`
	writeGrimoire(t, env, "test-loop-cond-exit", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test loop conditional exit", "grimoire:test-loop-cond-exit")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Should complete after 3 iterations (exits when count >= 3)
	waitForTaskStatus(t, api, taskID, "closed", 15)

	// Verify workflow completed
	logContent := readDaemonLog(t, env)
	if !strings.Contains(logContent, `"status":"completed"`) {
		t.Logf("Log: %s", logContent)
		t.Error("Expected workflow to complete successfully")
	}
}

// TestWorkflowLoopPreviousResultCondition verifies using previous step result in loop.
func TestWorkflowLoopPreviousResultCondition(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Loop where second step conditionally runs based on first step's success.
	grimoireYAML := `name: test-loop-previous
description: Loop with previous result condition
timeout: 5m

steps:
  - name: init
    type: script
    command: "echo '0' > /tmp/coven-loop-prev.txt"
    timeout: 10s

  - name: previous-loop
    type: loop
    max_iterations: 3
    steps:
      - name: maybe-fail
        type: script
        command: |
          count=$(cat /tmp/coven-loop-prev.txt)
          count=$((count + 1))
          echo $count > /tmp/coven-loop-prev.txt
          if [ $count -eq 2 ]; then exit 1; fi
          exit 0
        on_fail: continue
        timeout: 10s

      - name: on-success
        type: script
        command: "echo 'Previous step succeeded'"
        when: "{{.previous.success}}"
        timeout: 10s
`
	writeGrimoire(t, env, "test-loop-previous", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test loop previous", "grimoire:test-loop-previous")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	waitForTaskStatus(t, api, taskID, "closed", 15)

	// Verify workflow completed
	logContent := readDaemonLog(t, env)
	if !strings.Contains(logContent, `"status":"completed"`) {
		t.Logf("Log: %s", logContent)
		t.Error("Expected workflow to complete successfully")
	}
}
