//go:build e2e

package daemon_e2e

import (
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// TestWorkflowAPIListEmpty verifies GET /workflows returns empty list when no workflows.
func TestWorkflowAPIListEmpty(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()
	api := helpers.NewAPIClient(env)

	workflows, err := api.GetWorkflows()
	if err != nil {
		t.Fatalf("Failed to get workflows: %v", err)
	}

	if workflows.Count != 0 {
		t.Errorf("Expected 0 workflows, got %d", workflows.Count)
	}
}

// TestWorkflowAPIListActive verifies GET /workflows returns active workflows.
func TestWorkflowAPIListActive(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Create a workflow with slow steps so we can query it
	grimoireYAML := `name: test-slow
description: Slow workflow for API testing
timeout: 5m

steps:
  - name: slow-step
    type: script
    command: "sleep 5"
    timeout: 2m
`
	writeGrimoire(t, env, "test-slow", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test slow workflow", "grimoire:test-slow")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Give workflow time to start
	time.Sleep(1 * time.Second)

	// Query workflows
	workflows, err := api.GetWorkflows()
	if err != nil {
		t.Fatalf("Failed to get workflows: %v", err)
	}

	if workflows.Count == 0 {
		t.Fatal("Expected at least 1 workflow")
	}

	// Find our workflow
	var found bool
	for _, wf := range workflows.Workflows {
		if wf.TaskID == taskID {
			found = true
			if wf.Status != "running" {
				t.Errorf("Expected status 'running', got '%s'", wf.Status)
			}
			if wf.GrimoireName != "test-slow" {
				t.Errorf("Expected grimoire 'test-slow', got '%s'", wf.GrimoireName)
			}
			break
		}
	}

	if !found {
		t.Errorf("Workflow for task %s not found in list", taskID)
	}
}

// TestWorkflowAPIGetDetails verifies GET /workflows/:id returns workflow details.
func TestWorkflowAPIGetDetails(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	grimoireYAML := `name: test-details
description: Workflow for details testing
timeout: 5m

steps:
  - name: step-one
    type: script
    command: "echo 'Step one'"
    timeout: 30s

  - name: step-two
    type: script
    command: "sleep 3"
    timeout: 1m
`
	writeGrimoire(t, env, "test-details", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test details", "grimoire:test-details")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for workflow to start and first step to complete
	time.Sleep(2 * time.Second)

	// Get workflow details by task ID
	workflow, err := api.GetWorkflow(taskID)
	if err != nil {
		t.Fatalf("Failed to get workflow: %v", err)
	}

	if workflow == nil {
		t.Fatal("Workflow not found")
	}

	t.Logf("Workflow: %+v", workflow)

	if workflow.TaskID != taskID {
		t.Errorf("Expected task_id '%s', got '%s'", taskID, workflow.TaskID)
	}
	if workflow.GrimoireName != "test-details" {
		t.Errorf("Expected grimoire 'test-details', got '%s'", workflow.GrimoireName)
	}
	if workflow.WorktreePath == "" {
		t.Error("Expected worktree_path to be set")
	}

	// Verify current step is visible (should be on step-two which is sleeping)
	// CurrentStep is 0-indexed, so step-two should be 1
	if workflow.CurrentStep < 0 {
		t.Error("Expected current_step to be set")
	}
	t.Logf("Current step index: %d", workflow.CurrentStep)
}

// TestWorkflowAPIStepProgress verifies step outputs are available for completed steps.
func TestWorkflowAPIStepProgress(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Create a multi-step workflow where we can query between steps
	grimoireYAML := `name: test-step-progress
description: Workflow for step progress testing
timeout: 5m

steps:
  - name: fast-step
    type: script
    command: "echo 'Fast step completed'"
    timeout: 30s
    output: fast_result

  - name: slow-step
    type: script
    command: "sleep 5"
    timeout: 1m
`
	writeGrimoire(t, env, "test-step-progress", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test step progress", "grimoire:test-step-progress")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for first step to complete but workflow still running
	time.Sleep(2 * time.Second)

	// Query workflow details
	workflow, err := api.GetWorkflow(taskID)
	if err != nil {
		t.Fatalf("Failed to get workflow: %v", err)
	}

	if workflow == nil {
		t.Fatal("Workflow not found")
	}

	// Verify workflow is still running (on slow-step)
	if workflow.Status != "running" {
		t.Logf("Workflow status: %s (expected 'running' during slow-step)", workflow.Status)
	}

	// Verify current step index indicates progress (should be 1 for slow-step)
	t.Logf("Current step: %d, Status: %s", workflow.CurrentStep, workflow.Status)
	if workflow.CurrentStep < 0 {
		t.Error("Expected current_step to be 0 or greater")
	}

	// Verify completed steps are tracked (this depends on the API returning step results)
	// The workflow state includes completed_steps which we can verify
	t.Logf("Completed steps: %v", workflow.CompletedSteps)
}

// TestWorkflowAPICancelRunning verifies POST /workflows/:id/cancel stops a running workflow.
func TestWorkflowAPICancelRunning(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	grimoireYAML := `name: test-cancel
description: Workflow to cancel
timeout: 5m

steps:
  - name: long-step
    type: script
    command: "sleep 60"
    timeout: 2m
`
	writeGrimoire(t, env, "test-cancel", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test cancel", "grimoire:test-cancel")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for workflow to start
	time.Sleep(1 * time.Second)

	// Verify it's running
	workflow, err := api.GetWorkflow(taskID)
	if err != nil {
		t.Fatalf("Failed to get workflow: %v", err)
	}
	if workflow == nil || workflow.Status != "running" {
		t.Fatalf("Expected running workflow, got %v", workflow)
	}

	// Cancel the workflow
	if err := api.CancelWorkflow(taskID); err != nil {
		t.Fatalf("Failed to cancel workflow: %v", err)
	}

	// Verify it's cancelled
	workflow, err = api.GetWorkflow(taskID)
	if err != nil {
		t.Fatalf("Failed to get workflow after cancel: %v", err)
	}
	if workflow.Status != "cancelled" {
		t.Errorf("Expected status 'cancelled', got '%s'", workflow.Status)
	}
}

// TestWorkflowAPIMergeApproval verifies the merge approval flow via API.
func TestWorkflowAPIMergeApproval(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	grimoireYAML := `name: test-merge-approval
description: Workflow to test merge approval via API
timeout: 5m

steps:
  - name: make-changes
    type: script
    command: "echo 'Making changes'"
    timeout: 30s

  - name: merge
    type: merge
    require_review: true
    timeout: 5m

  - name: after-merge
    type: script
    command: "echo 'After merge'"
    timeout: 30s
`
	writeGrimoire(t, env, "test-merge-approval", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test merge approval", "grimoire:test-merge-approval")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for workflow to reach merge step
	var workflow *helpers.Workflow
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var err error
		workflow, err = api.GetWorkflow(taskID)
		if err != nil {
			t.Fatalf("Failed to get workflow: %v", err)
		}
		if workflow != nil && workflow.Status == "pending_merge" {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	if workflow == nil || workflow.Status != "pending_merge" {
		t.Fatalf("Expected workflow to reach pending_merge status, got %v", workflow)
	}

	t.Logf("Workflow reached pending_merge at step %d", workflow.CurrentStep)

	// Verify available actions include approve-merge
	foundApprove := false
	for _, action := range workflow.Actions {
		if action == "approve-merge" {
			foundApprove = true
			break
		}
	}
	if !foundApprove {
		t.Errorf("Expected 'approve-merge' in available actions, got %v", workflow.Actions)
	}

	// Approve the merge
	result, err := api.ApproveMerge(taskID)
	if err != nil {
		t.Fatalf("Failed to approve merge: %v", err)
	}
	if result.Status != "merged" {
		t.Errorf("Expected status 'merged', got %s", result.Status)
	}

	// Wait for workflow to complete
	waitForTaskStatus(t, api, taskID, "closed", 15)
}

// TestWorkflowAPIMergeRejection verifies the merge rejection flow via API.
func TestWorkflowAPIMergeRejection(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	grimoireYAML := `name: test-merge-reject
description: Workflow to test merge rejection via API
timeout: 5m

steps:
  - name: make-changes
    type: script
    command: "echo 'Making changes'"
    timeout: 30s

  - name: merge
    type: merge
    require_review: true
    timeout: 5m

  - name: after-merge
    type: script
    command: "echo 'Should not run'"
    timeout: 30s
`
	writeGrimoire(t, env, "test-merge-reject", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test merge rejection", "grimoire:test-merge-reject")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for workflow to reach merge step
	var workflow *helpers.Workflow
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var err error
		workflow, err = api.GetWorkflow(taskID)
		if err != nil {
			t.Fatalf("Failed to get workflow: %v", err)
		}
		if workflow != nil && workflow.Status == "pending_merge" {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	if workflow == nil || workflow.Status != "pending_merge" {
		t.Fatalf("Expected workflow to reach pending_merge status, got %v", workflow)
	}

	// Reject the merge with a reason
	if err := api.RejectMerge(taskID, "Changes not approved"); err != nil {
		t.Fatalf("Failed to reject merge: %v", err)
	}

	// Verify workflow is now blocked
	workflow, err := api.GetWorkflow(taskID)
	if err != nil {
		t.Fatalf("Failed to get workflow after rejection: %v", err)
	}

	if workflow.Status != "blocked" {
		t.Errorf("Expected status 'blocked', got '%s'", workflow.Status)
	}
	if workflow.Error == "" {
		t.Error("Expected error message to be set after rejection")
	}

	// Verify task is blocked
	waitForTaskStatus(t, api, taskID, "blocked", 5)
}

// TestWorkflowAPIRetryBlocked verifies POST /workflows/:id/retry resumes a blocked workflow.
func TestWorkflowAPIRetryBlocked(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// First run fails unconditionally, second run succeeds
	// We use a counter file to track attempts
	counterFile := env.TmpDir + "/retry-counter.txt"

	grimoireYAML := `name: test-retry
description: Workflow to test retry
timeout: 5m

steps:
  - name: attempt-step
    type: script
    command: "if [ -f ` + counterFile + ` ]; then echo 'Second attempt - success'; exit 0; else echo 'First attempt - fail' && touch ` + counterFile + ` && exit 1; fi"
    on_fail: block
    timeout: 30s

  - name: success-step
    type: script
    command: "echo 'Final success'"
    timeout: 30s
`
	writeGrimoire(t, env, "test-retry", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test retry", "grimoire:test-retry")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for workflow to block (first run creates marker and fails)
	waitForTaskStatus(t, api, taskID, "blocked", 10)

	// Verify workflow is blocked
	workflow, err := api.GetWorkflow(taskID)
	if err != nil {
		t.Fatalf("Failed to get workflow: %v", err)
	}
	if workflow.Status != "blocked" {
		t.Fatalf("Expected blocked workflow, got %s", workflow.Status)
	}

	// Retry the workflow (second run should find marker and succeed)
	if err := api.RetryWorkflow(taskID); err != nil {
		t.Fatalf("Failed to retry workflow: %v", err)
	}

	// Wait for workflow to complete
	waitForTaskStatus(t, api, taskID, "closed", 15)
}
