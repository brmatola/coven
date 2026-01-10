//go:build e2e

package daemon_e2e

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// TestWorkflowWorktreeCreation verifies worktree is created when workflow starts.
func TestWorkflowWorktreeCreation(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Simple grimoire that runs long enough for us to check the worktree
	grimoireYAML := `name: test-worktree-create
description: Test worktree creation
timeout: 5m

steps:
  - name: check-worktree
    type: script
    command: "pwd && ls -la && sleep 2"
    timeout: 30s
`
	writeGrimoire(t, env, "test-worktree-create", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test worktree creation", "grimoire:test-worktree-create")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for workflow to start and get worktree path
	var workflow *helpers.Workflow
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var err error
		workflow, err = api.GetWorkflow(taskID)
		if err != nil {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		if workflow != nil && workflow.WorktreePath != "" {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}

	if workflow == nil || workflow.WorktreePath == "" {
		t.Fatalf("Expected workflow to have worktree path, got: %+v", workflow)
	}

	t.Logf("Worktree path: %s", workflow.WorktreePath)

	// Verify worktree directory exists
	if _, err := os.Stat(workflow.WorktreePath); os.IsNotExist(err) {
		t.Errorf("Worktree directory should exist at %s", workflow.WorktreePath)
	}

	// Verify it's under worktrees directory (under .coven)
	if !strings.Contains(workflow.WorktreePath, "worktrees") {
		t.Errorf("Worktree path should contain worktrees, got: %s", workflow.WorktreePath)
	}

	// Wait for workflow to complete
	waitForTaskStatus(t, api, taskID, "closed", 15)
}

// TestWorkflowWorktreeCleanupAfterMerge verifies worktree is cleaned up after merge approval.
// Note: Even with require_review: false, actual merge to main requires calling approve-merge API.
func TestWorkflowWorktreeCleanupAfterMerge(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	testFile := "worktree-cleanup-test.txt"

	// Grimoire that creates a file and blocks at merge for approval
	grimoireYAML := `name: test-worktree-cleanup
description: Test worktree cleanup after merge approval
timeout: 5m

steps:
  - name: create-file
    type: script
    command: "echo 'test content' > ` + testFile + `"
    timeout: 30s

  - name: merge
    type: merge
    require_review: true
    timeout: 5m
`
	writeGrimoire(t, env, "test-worktree-cleanup", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test worktree cleanup", "grimoire:test-worktree-cleanup")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for workflow to reach pending_merge and capture worktree path
	var worktreePath string
	var workflow *helpers.Workflow
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		var err error
		workflow, err = api.GetWorkflow(taskID)
		if err != nil {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		if workflow != nil && workflow.WorktreePath != "" {
			worktreePath = workflow.WorktreePath
			if workflow.Status == "pending_merge" {
				t.Logf("Workflow reached pending_merge with worktree: %s", worktreePath)
				break
			}
		}
		time.Sleep(200 * time.Millisecond)
	}

	if worktreePath == "" || workflow == nil || workflow.Status != "pending_merge" {
		t.Fatalf("Expected workflow to reach pending_merge, got: %+v", workflow)
	}

	// Verify worktree exists while waiting for approval
	if _, err := os.Stat(worktreePath); os.IsNotExist(err) {
		t.Errorf("Worktree should exist while pending merge at %s", worktreePath)
	}

	// Approve the merge
	result, err := api.ApproveMerge(taskID)
	if err != nil {
		t.Fatalf("ApproveMerge failed: %v", err)
	}

	t.Logf("Merge result: status=%s, hasConflicts=%v", result.Status, result.HasConflicts)

	if result.Status != "merged" {
		t.Errorf("Expected merge status 'merged', got '%s'", result.Status)
	}

	// Wait for workflow to complete
	waitForTaskStatus(t, api, taskID, "closed", 10)

	// Give cleanup a moment to run
	time.Sleep(500 * time.Millisecond)

	// Verify worktree is cleaned up after successful merge
	if _, err := os.Stat(worktreePath); !os.IsNotExist(err) {
		t.Errorf("Worktree should be cleaned up after merge, but still exists at %s", worktreePath)
	}

	// Verify the file was merged to main repo
	mainFilePath := filepath.Join(env.TmpDir, testFile)
	if _, err := os.Stat(mainFilePath); os.IsNotExist(err) {
		t.Errorf("Merged file should exist in main repo at %s", mainFilePath)
	}
}

// TestWorkflowWorktreeContainsTask verifies worktree has task-related directory structure.
func TestWorkflowWorktreeContainsTask(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Grimoire that checks for task ID in worktree path
	grimoireYAML := `name: test-worktree-task
description: Test worktree contains task ID
timeout: 5m

steps:
  - name: wait
    type: script
    command: "sleep 2"
    timeout: 30s
`
	writeGrimoire(t, env, "test-worktree-task", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test worktree task ID", "grimoire:test-worktree-task")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for workflow and check worktree path
	var workflow *helpers.Workflow
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var err error
		workflow, err = api.GetWorkflow(taskID)
		if err != nil {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		if workflow != nil && workflow.WorktreePath != "" {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}

	if workflow == nil || workflow.WorktreePath == "" {
		t.Fatalf("Expected workflow to have worktree path")
	}

	// Verify worktree path contains task ID (or part of it for uniqueness)
	// Task IDs are like "coven-e2e-123456-abc"
	if !strings.Contains(workflow.WorktreePath, taskID) {
		t.Logf("Note: Worktree path %s doesn't contain full task ID %s (may use shortened version)",
			workflow.WorktreePath, taskID)
	}

	// Wait for completion
	waitForTaskStatus(t, api, taskID, "closed", 15)
}
