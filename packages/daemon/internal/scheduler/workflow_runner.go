package scheduler

import (
	"context"
	"fmt"
	"time"

	"github.com/coven/daemon/internal/grimoire"
	"github.com/coven/daemon/internal/logging"
	"github.com/coven/daemon/internal/workflow"
	"github.com/coven/daemon/pkg/types"
)

// WorkflowRunner executes grimoire workflows for beads.
type WorkflowRunner struct {
	covenDir       string
	grimoireMapper *workflow.GrimoireMapper
	logger         *logging.Logger
	eventEmitter   workflow.EventEmitter
}

// NewWorkflowRunner creates a new workflow runner.
func NewWorkflowRunner(covenDir string, logger *logging.Logger) *WorkflowRunner {
	grimoireLoader := grimoire.NewLoader(covenDir)
	mapper := workflow.NewGrimoireMapper(covenDir, grimoireLoader)

	return &WorkflowRunner{
		covenDir:       covenDir,
		grimoireMapper: mapper,
		logger:         logger,
	}
}

// SetEventEmitter sets the event emitter for workflow events.
func (r *WorkflowRunner) SetEventEmitter(emitter workflow.EventEmitter) {
	r.eventEmitter = emitter
}

// WorkflowConfig contains configuration for a workflow execution.
type WorkflowConfig struct {
	// WorktreePath is the path to the worktree for execution.
	WorktreePath string

	// BeadID is the ID of the bead being processed.
	BeadID string

	// WorkflowID is a unique identifier for this workflow run.
	WorkflowID string

	// AgentRunner is the runner for agent steps (optional).
	AgentRunner workflow.AgentRunner

	// ResumeState contains saved state for resuming an interrupted workflow.
	ResumeState *workflow.WorkflowState

	// OnProcessSpawn is called when an agent process is spawned.
	// It provides the step task ID and PID for tracking.
	OnProcessSpawn func(stepTaskID string, pid int)
}

// WorkflowResult represents the result of a workflow execution.
type WorkflowResult struct {
	// Success indicates whether the workflow completed successfully.
	Success bool

	// Status is the final workflow status.
	Status workflow.WorkflowStatus

	// GrimoireName is the name of the grimoire that was executed.
	GrimoireName string

	// Duration is how long the workflow took to execute.
	Duration time.Duration

	// Error contains any error message.
	Error string

	// StepCount is the number of steps that were executed.
	StepCount int

	// LastStepName is the name of the last executed step.
	LastStepName string

	// NeedsAutoMerge indicates the workflow had a merge step with require_review: false
	// and the scheduler should perform the actual merge to main.
	NeedsAutoMerge bool
}

// Run executes the appropriate grimoire for a bead.
func (r *WorkflowRunner) Run(ctx context.Context, task types.Task, config WorkflowConfig) (*WorkflowResult, error) {
	start := time.Now()

	r.logger.Info("starting workflow for bead",
		"bead_id", config.BeadID,
		"worktree", config.WorktreePath,
	)

	// Resolve which grimoire to use
	beadInfo := workflow.BeadInfo{
		ID:       task.ID,
		Type:     string(task.Type),
		Labels:   task.Labels,
		Title:    task.Title,
		Body:     task.Description,
		Priority: fmt.Sprintf("P%d", task.Priority),
	}

	grimoireName, err := r.grimoireMapper.Resolve(beadInfo)
	if err != nil {
		r.logger.Error("failed to resolve grimoire",
			"bead_id", config.BeadID,
			"error", err,
		)
		return &WorkflowResult{
			Success:      false,
			Error:        fmt.Sprintf("failed to resolve grimoire: %v", err),
			Duration:     time.Since(start),
			GrimoireName: "",
		}, nil
	}

	r.logger.Info("resolved grimoire",
		"bead_id", config.BeadID,
		"grimoire", grimoireName,
	)

	// Create bead data for template context
	beadData := &workflow.BeadData{
		ID:       task.ID,
		Title:    task.Title,
		Body:     task.Description,
		Type:     string(task.Type),
		Priority: fmt.Sprintf("P%d", task.Priority),
		Labels:   task.Labels,
	}

	// Create workflow engine
	engine := workflow.NewEngine(workflow.EngineConfig{
		CovenDir:     r.covenDir,
		WorktreePath: config.WorktreePath,
		BeadID:       config.BeadID,
		WorkflowID:   config.WorkflowID,
		Bead:         beadData,
	})

	// Set event emitter if provided
	if r.eventEmitter != nil {
		engine.SetEventEmitter(r.eventEmitter)
	}

	// Set agent runner if provided
	if config.AgentRunner != nil {
		engine.SetAgentRunner(config.AgentRunner)
	}

	// Execute the grimoire
	result := engine.ExecuteByName(ctx, grimoireName)

	r.logger.Info("workflow completed",
		"bead_id", config.BeadID,
		"grimoire", grimoireName,
		"status", result.Status,
		"duration", result.Duration,
	)

	// Determine the last step name
	lastStepName := ""
	if result.CurrentStep >= 0 {
		// Get the grimoire to find step names
		g, err := r.grimoireMapper.GetGrimoire(grimoireName)
		if err == nil && result.CurrentStep < len(g.Steps) {
			lastStepName = g.Steps[result.CurrentStep].Name
		}
	}

	workflowResult := &WorkflowResult{
		Success:        result.Status == workflow.WorkflowCompleted,
		Status:         result.Status,
		GrimoireName:   grimoireName,
		Duration:       result.Duration,
		StepCount:      len(result.StepResults),
		LastStepName:   lastStepName,
		NeedsAutoMerge: result.NeedsAutoMerge,
	}

	if result.Error != nil {
		workflowResult.Error = result.Error.Error()
	}

	return workflowResult, nil
}

// RunFromState resumes a workflow from saved state.
func (r *WorkflowRunner) RunFromState(ctx context.Context, task types.Task, config WorkflowConfig, state *workflow.WorkflowState) (*WorkflowResult, error) {
	start := time.Now()

	r.logger.Info("resuming workflow from state",
		"bead_id", config.BeadID,
		"grimoire", state.GrimoireName,
		"from_step", state.CurrentStep+1,
		"worktree", config.WorktreePath,
	)

	// Load the grimoire that was being executed
	g, err := r.grimoireMapper.GetGrimoire(state.GrimoireName)
	if err != nil {
		r.logger.Error("failed to load grimoire for resume",
			"bead_id", config.BeadID,
			"grimoire", state.GrimoireName,
			"error", err,
		)
		return &WorkflowResult{
			Success:      false,
			Error:        fmt.Sprintf("failed to load grimoire %q: %v", state.GrimoireName, err),
			Duration:     time.Since(start),
			GrimoireName: state.GrimoireName,
		}, nil
	}

	// Create bead data for template context
	beadData := &workflow.BeadData{
		ID:       task.ID,
		Title:    task.Title,
		Body:     task.Description,
		Type:     string(task.Type),
		Priority: fmt.Sprintf("P%d", task.Priority),
		Labels:   task.Labels,
	}

	// Create workflow engine
	engine := workflow.NewEngine(workflow.EngineConfig{
		CovenDir:     r.covenDir,
		WorktreePath: config.WorktreePath,
		BeadID:       config.BeadID,
		WorkflowID:   config.WorkflowID,
		Bead:         beadData,
	})

	// Set event emitter if provided
	if r.eventEmitter != nil {
		engine.SetEventEmitter(r.eventEmitter)
	}

	// Set agent runner if provided
	if config.AgentRunner != nil {
		engine.SetAgentRunner(config.AgentRunner)
	}

	// Execute from saved state
	result := engine.ExecuteFromState(ctx, g, state)

	r.logger.Info("resumed workflow completed",
		"bead_id", config.BeadID,
		"grimoire", state.GrimoireName,
		"status", result.Status,
		"duration", result.Duration,
	)

	// Determine the last step name
	lastStepName := ""
	if result.CurrentStep >= 0 && result.CurrentStep < len(g.Steps) {
		lastStepName = g.Steps[result.CurrentStep].Name
	}

	workflowResult := &WorkflowResult{
		Success:        result.Status == workflow.WorkflowCompleted,
		Status:         result.Status,
		GrimoireName:   state.GrimoireName,
		Duration:       result.Duration,
		StepCount:      len(result.StepResults),
		LastStepName:   lastStepName,
		NeedsAutoMerge: result.NeedsAutoMerge,
	}

	if result.Error != nil {
		workflowResult.Error = result.Error.Error()
	}

	return workflowResult, nil
}

// StatusForResult converts a workflow result to a task status.
// Note: beads doesn't support "pending_merge" as a status, so we map it to "blocked".
// The workflow status is still tracked internally for proper state management.
func StatusForResult(result *WorkflowResult) types.TaskStatus {
	if result == nil {
		return types.TaskStatusOpen
	}

	switch result.Status {
	case workflow.WorkflowCompleted:
		return types.TaskStatusClosed
	case workflow.WorkflowPendingMerge:
		// Map pending_merge to blocked for beads compatibility
		return types.TaskStatusBlocked
	case workflow.WorkflowBlocked:
		return types.TaskStatusBlocked
	case workflow.WorkflowCancelled:
		return types.TaskStatusOpen
	case workflow.WorkflowFailed:
		return types.TaskStatusBlocked
	default:
		return types.TaskStatusOpen
	}
}

// ShouldRetry determines if a workflow should be retried.
func ShouldRetry(result *WorkflowResult, attempt int, maxRetries int) bool {
	if result == nil {
		return false
	}

	// Don't retry if we've hit max retries
	if attempt >= maxRetries {
		return false
	}

	// Retry on cancellation or certain failures
	switch result.Status {
	case workflow.WorkflowCancelled:
		return true
	case workflow.WorkflowFailed:
		// Could be more sophisticated - check error type
		return true
	default:
		return false
	}
}
