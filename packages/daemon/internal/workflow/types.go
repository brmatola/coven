package workflow

import (
	"time"
)

// StepResult contains the outcome of executing a step.
type StepResult struct {
	// Success indicates whether the step completed successfully.
	Success bool

	// Skipped indicates whether the step was skipped due to a 'when' condition.
	Skipped bool

	// Output is the captured output from the step.
	// For script steps, this is stdout+stderr.
	// For agent steps, this is the AgentOutput JSON.
	Output string

	// ExitCode is the exit code for script steps (0 = success).
	ExitCode int

	// Error contains the error message if the step failed.
	Error string

	// Duration is how long the step took to execute.
	Duration time.Duration

	// Action indicates what the workflow should do after this step.
	Action StepAction
}

// StepAction indicates what the workflow should do after a step completes.
type StepAction string

const (
	// ActionContinue indicates the workflow should proceed to the next step.
	ActionContinue StepAction = "continue"

	// ActionExitLoop indicates the workflow should exit the current loop.
	ActionExitLoop StepAction = "exit_loop"

	// ActionBlock indicates the workflow should block and wait for user action.
	ActionBlock StepAction = "block"

	// ActionFail indicates the workflow should fail and stop execution.
	ActionFail StepAction = "fail"
)

// StepContext provides context for step execution.
type StepContext struct {
	// WorktreePath is the path to the worktree where the step executes.
	WorktreePath string

	// BeadID is the ID of the bead being processed.
	BeadID string

	// WorkflowID is the ID of the current workflow run.
	WorkflowID string

	// Variables contains the workflow context variables.
	// Step outputs are stored here as variables["step_name"] = result.
	Variables map[string]interface{}

	// InLoop indicates whether the step is executing inside a loop.
	InLoop bool

	// LoopIteration is the current loop iteration (0-indexed) if InLoop is true.
	LoopIteration int
}

// NewStepContext creates a new step context.
func NewStepContext(worktreePath, beadID, workflowID string) *StepContext {
	return &StepContext{
		WorktreePath: worktreePath,
		BeadID:       beadID,
		WorkflowID:   workflowID,
		Variables:    make(map[string]interface{}),
	}
}

// GetVariable retrieves a variable from the context.
// Returns nil if the variable doesn't exist.
func (c *StepContext) GetVariable(name string) interface{} {
	return c.Variables[name]
}

// SetVariable stores a variable in the context.
func (c *StepContext) SetVariable(name string, value interface{}) {
	c.Variables[name] = value
}

// SetPrevious sets the previous step result in the context.
func (c *StepContext) SetPrevious(result *StepResult) {
	c.Variables["previous"] = map[string]interface{}{
		"success": result.Success,
		"failed":  !result.Success,
		"output":  result.Output,
	}
}

// WorkflowStatus represents the current state of a workflow.
type WorkflowStatus string

const (
	WorkflowRunning      WorkflowStatus = "running"
	WorkflowBlocked      WorkflowStatus = "blocked"
	WorkflowCompleted    WorkflowStatus = "completed"
	WorkflowFailed       WorkflowStatus = "failed"
	WorkflowPendingMerge WorkflowStatus = "pending_merge"
	WorkflowCancelled    WorkflowStatus = "cancelled"
)

// EventEmitter is an interface for emitting workflow events.
// This allows decoupling the workflow engine from the event broker.
type EventEmitter interface {
	// EmitWorkflowStarted is called when a workflow begins execution.
	EmitWorkflowStarted(workflowID, taskID, grimoireName string)

	// EmitWorkflowStepStarted is called when a step begins execution.
	EmitWorkflowStepStarted(workflowID, taskID, stepName, stepType string, stepIndex int)

	// EmitWorkflowStepCompleted is called when a step finishes.
	// success indicates whether the step completed without error.
	// duration is the step execution time as a string.
	// stepErr is the error message if the step failed.
	EmitWorkflowStepCompleted(workflowID, taskID, stepName string, stepIndex int, success bool, duration string, stepErr string)

	// EmitWorkflowBlocked is called when a workflow blocks (needs user action).
	EmitWorkflowBlocked(workflowID, taskID, reason string)

	// EmitWorkflowMergePending is called when a workflow is waiting for merge approval.
	EmitWorkflowMergePending(workflowID, taskID string)

	// EmitWorkflowCompleted is called when a workflow finishes successfully.
	EmitWorkflowCompleted(workflowID, taskID, grimoireName, duration string)

	// EmitWorkflowCancelled is called when a workflow is cancelled.
	EmitWorkflowCancelled(workflowID, taskID string)
}
