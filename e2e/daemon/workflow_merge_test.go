//go:build e2e

package daemon_e2e

import (
	"testing"

	"github.com/coven/e2e/daemon/helpers"
)

// TestWorkflowMergeStepBlocksForReview verifies merge step blocks workflow for human review.
func TestWorkflowMergeStepBlocksForReview(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	grimoireYAML := `name: test-merge-block
description: Workflow that blocks at merge step
timeout: 5m

steps:
  - name: make-changes
    type: script
    command: "echo 'Making changes...'"
    timeout: 30s

  - name: review
    type: merge
    require_review: true
    timeout: 5m
`
	writeGrimoire(t, env, "test-merge-block", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test merge block", "grimoire:test-merge-block")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Task should reach pending_merge when it hits merge step
	waitForTaskStatus(t, api, taskID, "pending_merge", 30)

	// Verify task is actually blocked at pending_merge
	tasks, err := api.GetTasks()
	if err != nil {
		t.Fatalf("Failed to get tasks: %v", err)
	}

	var found bool
	for _, task := range tasks.Tasks {
		if task.ID == taskID {
			if task.Status != "pending_merge" {
				t.Errorf("Expected status 'pending_merge', got '%s'", task.Status)
			}
			found = true
			break
		}
	}
	if !found {
		t.Error("Task not found after starting")
	}
}

// TestWorkflowMergeAutoApprove verifies merge can auto-approve without review.
func TestWorkflowMergeAutoApprove(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	grimoireYAML := `name: test-merge-auto
description: Workflow with auto-merge (no review required)
timeout: 5m

steps:
  - name: make-changes
    type: script
    command: "echo 'Making changes...'"
    timeout: 30s

  - name: auto-merge
    type: merge
    require_review: false
    timeout: 1m

  - name: after-merge
    type: script
    command: "echo 'After merge completed'"
    timeout: 30s
`
	writeGrimoire(t, env, "test-merge-auto", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test auto merge", "grimoire:test-merge-auto")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Should complete without blocking (require_review: false)
	waitForTaskStatus(t, api, taskID, "closed", 30)
}
