package workflow

import (
	"testing"
)

func TestNewStepContext(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "wf-456")

	if ctx.WorktreePath != "/worktree" {
		t.Errorf("WorktreePath = %q, want %q", ctx.WorktreePath, "/worktree")
	}
	if ctx.BeadID != "bead-123" {
		t.Errorf("BeadID = %q, want %q", ctx.BeadID, "bead-123")
	}
	if ctx.WorkflowID != "wf-456" {
		t.Errorf("WorkflowID = %q, want %q", ctx.WorkflowID, "wf-456")
	}
	if ctx.Variables == nil {
		t.Error("Variables should not be nil")
	}
	if ctx.InLoop {
		t.Error("InLoop should be false by default")
	}
}

func TestStepContext_GetSetVariable(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead", "wf")

	// Set a variable
	ctx.SetVariable("test", "value")

	// Get it back
	val := ctx.GetVariable("test")
	if val != "value" {
		t.Errorf("GetVariable() = %v, want %q", val, "value")
	}

	// Get missing variable
	missing := ctx.GetVariable("missing")
	if missing != nil {
		t.Errorf("GetVariable(missing) = %v, want nil", missing)
	}
}

func TestStepContext_SetPrevious(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead", "wf")

	result := &StepResult{
		Success: true,
		Output:  "output content",
	}
	ctx.SetPrevious(result)

	prev := ctx.GetVariable("previous")
	if prev == nil {
		t.Fatal("previous variable should be set")
	}

	prevMap, ok := prev.(map[string]interface{})
	if !ok {
		t.Fatalf("previous should be map, got %T", prev)
	}

	if prevMap["success"] != true {
		t.Error("previous.success should be true")
	}
	if prevMap["failed"] != false {
		t.Error("previous.failed should be false")
	}
	if prevMap["output"] != "output content" {
		t.Errorf("previous.output = %q, want %q", prevMap["output"], "output content")
	}
}

func TestStepContext_SetPrevious_Failure(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead", "wf")

	result := &StepResult{
		Success: false,
		Output:  "error content",
	}
	ctx.SetPrevious(result)

	prev := ctx.GetVariable("previous")
	prevMap := prev.(map[string]interface{})

	if prevMap["success"] != false {
		t.Error("previous.success should be false")
	}
	if prevMap["failed"] != true {
		t.Error("previous.failed should be true")
	}
}

func TestStepAction_Constants(t *testing.T) {
	if ActionContinue != "continue" {
		t.Errorf("ActionContinue = %q, want %q", ActionContinue, "continue")
	}
	if ActionExitLoop != "exit_loop" {
		t.Errorf("ActionExitLoop = %q, want %q", ActionExitLoop, "exit_loop")
	}
	if ActionBlock != "block" {
		t.Errorf("ActionBlock = %q, want %q", ActionBlock, "block")
	}
	if ActionFail != "fail" {
		t.Errorf("ActionFail = %q, want %q", ActionFail, "fail")
	}
}

func TestWorkflowStatus_Constants(t *testing.T) {
	if WorkflowRunning != "running" {
		t.Errorf("WorkflowRunning = %q, want %q", WorkflowRunning, "running")
	}
	if WorkflowBlocked != "blocked" {
		t.Errorf("WorkflowBlocked = %q, want %q", WorkflowBlocked, "blocked")
	}
	if WorkflowCompleted != "completed" {
		t.Errorf("WorkflowCompleted = %q, want %q", WorkflowCompleted, "completed")
	}
	if WorkflowFailed != "failed" {
		t.Errorf("WorkflowFailed = %q, want %q", WorkflowFailed, "failed")
	}
	if WorkflowPendingMerge != "pending_merge" {
		t.Errorf("WorkflowPendingMerge = %q, want %q", WorkflowPendingMerge, "pending_merge")
	}
	if WorkflowCancelled != "cancelled" {
		t.Errorf("WorkflowCancelled = %q, want %q", WorkflowCancelled, "cancelled")
	}
}
