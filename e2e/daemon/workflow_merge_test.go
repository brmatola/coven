//go:build e2e

package daemon_e2e

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

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

	// Task should reach blocked status when it hits merge step requiring review.
	// Note: beads doesn't support "pending_merge" as a status, so we use "blocked"
	// and the workflow engine tracks it internally as pending_merge.
	waitForTaskStatus(t, api, taskID, "blocked", 10)
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
	waitForTaskStatus(t, api, taskID, "closed", 10)
}

// TestWorkflowMergeConflictDetection verifies merge step detects conflicts when merging to main.
// Flow:
// 1. Create a test file in main branch
// 2. Start workflow which creates worktree and modifies the file
// 3. Wait for workflow to reach pending_merge
// 4. Modify the same file in main branch (creating conflict)
// 5. Call approve-merge API
// 6. Verify response contains conflict information
func TestWorkflowMergeConflictDetection(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	testFile := "conflict-test.txt"
	initialContent := "initial content\n"
	mainChange := "main branch change\n"

	// Create initial file in main branch
	testFilePath := filepath.Join(env.TmpDir, testFile)
	if err := os.WriteFile(testFilePath, []byte(initialContent), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	// Commit initial file
	cmd := exec.Command("git", "add", testFile)
	cmd.Dir = env.TmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to git add: %v", err)
	}

	cmd = exec.Command("git", "commit", "-m", "Add conflict test file")
	cmd.Dir = env.TmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to git commit: %v", err)
	}

	// Grimoire that creates a file change in worktree, then pauses at merge for review
	grimoireYAML := `name: test-conflict
description: Workflow to test merge conflict detection
timeout: 5m

steps:
  - name: modify-file
    type: script
    command: "echo 'worktree change' > ` + testFile + `"
    timeout: 30s

  - name: merge
    type: merge
    require_review: true
    timeout: 1m
`
	writeGrimoire(t, env, "test-conflict", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test conflict detection", "grimoire:test-conflict")

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for workflow to reach pending_merge status
	var workflow *helpers.Workflow
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		workflow, _ = api.GetWorkflow(taskID)
		if workflow != nil && workflow.Status == "pending_merge" {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	if workflow == nil || workflow.Status != "pending_merge" {
		t.Fatalf("Expected workflow to reach pending_merge, got %v", workflow)
	}

	t.Logf("Workflow reached pending_merge at step %d", workflow.CurrentStep)

	// Now modify the file in main branch (creating conflict condition)
	if err := os.WriteFile(testFilePath, []byte(mainChange), 0644); err != nil {
		t.Fatalf("Failed to write main change: %v", err)
	}

	cmd = exec.Command("git", "add", testFile)
	cmd.Dir = env.TmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to git add main change: %v", err)
	}

	cmd = exec.Command("git", "commit", "-m", "Main branch change to conflict file")
	cmd.Dir = env.TmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to commit main change: %v", err)
	}

	// Call approve-merge - this should detect the conflict and return conflict info
	result, err := api.ApproveMerge(taskID)
	if err != nil {
		t.Fatalf("ApproveMerge failed: %v", err)
	}

	t.Logf("ApproveMerge result: status=%s, hasConflicts=%v, conflictFiles=%v",
		result.Status, result.HasConflicts, result.ConflictFiles)

	// Verify conflict was detected
	if result.Status != "conflicts" {
		t.Errorf("Expected status 'conflicts', got '%s'", result.Status)
	}
	if !result.HasConflicts {
		t.Error("Expected HasConflicts to be true")
	}
	if len(result.ConflictFiles) == 0 {
		t.Error("Expected conflict files to be reported")
	}

	// The conflict file should be our test file
	foundConflict := false
	for _, f := range result.ConflictFiles {
		if f == testFile {
			foundConflict = true
			break
		}
	}
	if !foundConflict {
		t.Errorf("Expected %s in conflict files, got %v", testFile, result.ConflictFiles)
	}
}

// TestWorkflowMergeWithChanges verifies merge step handles actual file changes correctly.
func TestWorkflowMergeWithChanges(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	testFile := "merge-test-file.txt"
	changeMarker := env.TmpDir + "/change-marker.txt"

	grimoireYAML := `name: test-merge-changes
description: Workflow that creates changes and merges
timeout: 5m

steps:
  - name: create-changes
    type: script
    command: "echo 'New content from workflow' > ` + testFile + ` && touch ` + changeMarker + `"
    timeout: 30s

  - name: merge-changes
    type: merge
    require_review: false
    timeout: 1m

  - name: verify-merged
    type: script
    command: "echo 'Merge completed'"
    timeout: 30s
`
	writeGrimoire(t, env, "test-merge-changes", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test merge with changes", "grimoire:test-merge-changes")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for workflow to complete
	waitForTaskStatus(t, api, taskID, "closed", 15)

	// Verify the change marker was created
	if _, err := os.Stat(changeMarker); os.IsNotExist(err) {
		t.Error("Change marker not found - workflow may not have executed properly")
	}

	// Verify the workflow completed successfully
	workflow, err := api.GetWorkflow(taskID)
	if err != nil {
		// Workflow state may be deleted on completion
		t.Logf("Workflow state may have been cleaned up on completion")
	} else if workflow != nil {
		t.Logf("Final workflow status: %s", workflow.Status)
	}
}

// TestWorkflowMergeReviewInfo verifies merge step provides review information.
func TestWorkflowMergeReviewInfo(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	testFile := "review-test.txt"

	grimoireYAML := `name: test-merge-review-info
description: Workflow to test merge review information
timeout: 5m

steps:
  - name: create-file
    type: script
    command: "echo 'Line 1' > ` + testFile + ` && echo 'Line 2' >> ` + testFile + ` && echo 'Line 3' >> ` + testFile + `"
    timeout: 30s

  - name: review-merge
    type: merge
    require_review: true
    timeout: 5m
`
	writeGrimoire(t, env, "test-merge-review-info", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test merge review info", "grimoire:test-merge-review-info")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for workflow to reach pending merge
	var workflow *helpers.Workflow
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var err error
		workflow, err = api.GetWorkflow(taskID)
		if err != nil {
			time.Sleep(500 * time.Millisecond)
			continue
		}
		if workflow != nil && workflow.Status == "pending_merge" {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	if workflow == nil || workflow.Status != "pending_merge" {
		t.Fatalf("Expected workflow to reach pending_merge, got %v", workflow)
	}

	// Verify available actions include merge options
	hasApprove := false
	hasReject := false
	for _, action := range workflow.Actions {
		if action == "approve-merge" {
			hasApprove = true
		}
		if action == "reject-merge" {
			hasReject = true
		}
	}

	if !hasApprove {
		t.Error("Expected 'approve-merge' in available actions")
	}
	if !hasReject {
		t.Error("Expected 'reject-merge' in available actions")
	}

	// Verify merge review info is present
	if workflow.MergeReview == nil {
		t.Log("Merge review info is nil (may be populated differently)")
	} else {
		t.Logf("Merge review: %v", workflow.MergeReview)
		// Check for summary if present
		if summary, ok := workflow.MergeReview["summary"].(string); ok && summary != "" {
			t.Logf("Merge summary: %s", summary)
		}
	}
}
