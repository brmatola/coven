package workflow

import (
	"context"
	"fmt"
	"time"

	"github.com/coven/daemon/internal/grimoire"
	"github.com/coven/daemon/internal/spell"
)

// EngineConfig contains configuration for the workflow engine.
type EngineConfig struct {
	// CovenDir is the path to the .coven directory.
	CovenDir string

	// WorktreePath is the path to the worktree for execution.
	WorktreePath string

	// BeadID is the ID of the bead being processed.
	BeadID string

	// WorkflowID is the unique ID for this workflow execution.
	WorkflowID string

	// Bead contains the full bead data for template context.
	Bead *BeadData
}

// ExecutionResult contains the result of workflow execution.
type ExecutionResult struct {
	// Status is the final workflow status.
	Status WorkflowStatus

	// StepResults contains results for each executed step.
	StepResults map[string]*StepResult

	// CurrentStep is the index of the last executed step.
	CurrentStep int

	// Error contains any error that caused the workflow to fail.
	Error error

	// Duration is the total execution time.
	Duration time.Duration
}

// Engine executes workflow steps in sequence.
type Engine struct {
	config EngineConfig

	// Step executors
	scriptExecutor *ScriptExecutor
	agentExecutor  *AgentExecutor
	loopExecutor   *LoopExecutor
	mergeExecutor  *MergeExecutor

	// Loaders
	spellLoader    *spell.Loader
	grimoireLoader *grimoire.Loader

	// State persistence
	statePersister *StatePersister

	// Event emitter for workflow events (optional)
	eventEmitter EventEmitter
}

// NewEngine creates a new workflow engine.
func NewEngine(config EngineConfig) *Engine {
	spellLoader := spell.NewLoader(config.CovenDir)
	grimoireLoader := grimoire.NewLoader(config.CovenDir)

	scriptExecutor := NewScriptExecutor()
	agentExecutor := NewAgentExecutor(spellLoader, nil) // Agent runner set separately

	// Create loop executor with script and agent executors
	loopExecutor := NewLoopExecutor(scriptExecutor, agentExecutor)

	mergeExecutor := NewMergeExecutor()

	statePersister := NewStatePersister(config.CovenDir)

	return &Engine{
		config:         config,
		scriptExecutor: scriptExecutor,
		agentExecutor:  agentExecutor,
		loopExecutor:   loopExecutor,
		mergeExecutor:  mergeExecutor,
		spellLoader:    spellLoader,
		grimoireLoader: grimoireLoader,
		statePersister: statePersister,
	}
}

// NewEngineWithExecutors creates an engine with custom executors for testing.
func NewEngineWithExecutors(
	config EngineConfig,
	scriptExec *ScriptExecutor,
	agentExec *AgentExecutor,
	loopExec *LoopExecutor,
	mergeExec *MergeExecutor,
) *Engine {
	return &Engine{
		config:         config,
		scriptExecutor: scriptExec,
		agentExecutor:  agentExec,
		loopExecutor:   loopExec,
		mergeExecutor:  mergeExec,
	}
}

// Execute runs a grimoire workflow and returns the result.
func (e *Engine) Execute(ctx context.Context, g *grimoire.Grimoire) *ExecutionResult {
	return e.executeFromStep(ctx, g, 0, nil)
}

// ExecuteFromState resumes a workflow from saved state.
func (e *Engine) ExecuteFromState(ctx context.Context, g *grimoire.Grimoire, state *WorkflowState) *ExecutionResult {
	// Start from the next step after the last completed one
	startStep := state.CurrentStep + 1
	return e.executeFromStep(ctx, g, startStep, state.StepOutputs)
}

// executeFromStep runs a grimoire starting from a specific step.
func (e *Engine) executeFromStep(ctx context.Context, g *grimoire.Grimoire, startStep int, savedOutputs map[string]string) *ExecutionResult {
	start := time.Now()

	result := &ExecutionResult{
		Status:      WorkflowRunning,
		StepResults: make(map[string]*StepResult),
	}

	// Emit workflow started event
	e.emitWorkflowStarted(g.Name)

	// Create step context
	stepCtx := NewStepContext(e.config.WorktreePath, e.config.BeadID, e.config.WorkflowID)

	// Set bead data in context if provided
	if e.config.Bead != nil {
		stepCtx.SetBead(e.config.Bead)
	}

	// Restore saved outputs from previous steps
	if savedOutputs != nil {
		for key, value := range savedOutputs {
			stepCtx.SetVariable(key, value)
		}
	}

	// Initialize persisted state
	workflowState := &WorkflowState{
		TaskID:         e.config.BeadID,
		WorkflowID:     e.config.WorkflowID,
		GrimoireName:   g.Name,
		WorktreePath:   e.config.WorktreePath,
		Status:         WorkflowRunning,
		CurrentStep:    startStep - 1, // -1 because we haven't started yet
		CompletedSteps: make(map[string]*StepResult),
		StepOutputs:    make(map[string]string),
		StartedAt:      start,
	}

	// Copy any saved outputs to the new state
	if savedOutputs != nil {
		for k, v := range savedOutputs {
			workflowState.StepOutputs[k] = v
		}
	}

	// Save initial state
	if e.statePersister != nil {
		e.statePersister.Save(workflowState)
	}

	// Execute steps starting from startStep
	for i := startStep; i < len(g.Steps); i++ {
		step := &g.Steps[i]
		result.CurrentStep = i

		// Check for context cancellation
		if ctx.Err() != nil {
			result.Status = WorkflowCancelled
			result.Error = ctx.Err()
			result.Duration = time.Since(start)
			e.saveWorkflowState(workflowState, result)
			e.emitWorkflowCancelled()
			return result
		}

		// Check 'when' condition - skip step if condition is false
		if step.When != "" {
			shouldSkip, err := ShouldSkipStep(step.When, stepCtx)
			if err != nil {
				result.Status = WorkflowFailed
				result.Error = fmt.Errorf("step %q: failed to evaluate condition: %w", step.Name, err)
				result.Duration = time.Since(start)
				e.saveWorkflowState(workflowState, result)
				return result
			}
			if shouldSkip {
				// Store a skipped result and continue
				stepResult := &StepResult{
					Success: true,
					Skipped: true,
					Output:  fmt.Sprintf("skipped: condition %q evaluated to false", step.When),
				}
				result.StepResults[step.Name] = stepResult
				workflowState.CurrentStep = i
				workflowState.CompletedSteps[step.Name] = stepResult
				e.saveWorkflowState(workflowState, result)
				continue
			}
		}

		// Emit step started event
		e.emitStepStarted(step.Name, string(step.Type), i)
		stepStart := time.Now()

		// Execute the step
		stepResult, err := e.executeStep(ctx, step, stepCtx)
		stepDuration := time.Since(stepStart)

		if err != nil {
			result.Status = WorkflowFailed
			result.Error = fmt.Errorf("step %q failed: %w", step.Name, err)
			result.Duration = time.Since(start)
			e.saveWorkflowState(workflowState, result)
			e.emitStepCompleted(step.Name, i, false, stepDuration, err.Error())
			e.emitWorkflowBlocked(err.Error())
			return result
		}

		// Emit step completed event
		e.emitStepCompleted(step.Name, i, stepResult.Success, stepDuration, stepResult.Error)

		// Store result
		result.StepResults[step.Name] = stepResult
		workflowState.CurrentStep = i
		workflowState.CompletedSteps[step.Name] = stepResult

		// Store output in context if configured
		if step.Output != "" {
			stepCtx.SetVariable(step.Output, stepResult.Output)
			workflowState.StepOutputs[step.Output] = stepResult.Output
		}

		// Save state after each step completes
		e.saveWorkflowState(workflowState, result)

		// Update previous step result for next step
		stepCtx.SetPrevious(stepResult)

		// Handle step action
		switch stepResult.Action {
		case ActionContinue:
			// Continue to next step
			continue

		case ActionBlock:
			// Workflow blocked, needs human intervention
			// Use WorkflowPendingMerge for merge steps, WorkflowBlocked for others
			if step.Type == grimoire.StepTypeMerge {
				result.Status = WorkflowPendingMerge
				e.emitWorkflowMergePending()
			} else {
				result.Status = WorkflowBlocked
				e.emitWorkflowBlocked(stepResult.Error)
			}
			result.Duration = time.Since(start)
			e.saveWorkflowState(workflowState, result)
			return result

		case ActionFail:
			// Step failed, workflow fails
			result.Status = WorkflowFailed
			result.Error = fmt.Errorf("step %q failed: %s", step.Name, stepResult.Error)
			result.Duration = time.Since(start)
			e.saveWorkflowState(workflowState, result)
			e.emitWorkflowBlocked(stepResult.Error)
			return result

		case ActionExitLoop:
			// This shouldn't happen at top level, treat as continue
			continue
		}
	}

	// All steps completed successfully
	result.Status = WorkflowCompleted
	result.Duration = time.Since(start)

	// Delete state file on successful completion
	if e.statePersister != nil {
		e.statePersister.Delete(e.config.BeadID)
	}

	// Emit workflow completed event
	e.emitWorkflowCompleted(g.Name, result.Duration)

	return result
}

// saveWorkflowState persists the current workflow state.
func (e *Engine) saveWorkflowState(state *WorkflowState, result *ExecutionResult) {
	if e.statePersister == nil {
		return
	}

	state.Status = result.Status
	if result.Error != nil {
		state.Error = result.Error.Error()
	}

	e.statePersister.Save(state)
}

// GetStatePersister returns the state persister (for external use like resume detection).
func (e *Engine) GetStatePersister() *StatePersister {
	return e.statePersister
}

// executeStep dispatches to the appropriate executor.
func (e *Engine) executeStep(ctx context.Context, step *grimoire.Step, stepCtx *StepContext) (*StepResult, error) {
	switch step.Type {
	case grimoire.StepTypeScript:
		if e.scriptExecutor == nil {
			return nil, fmt.Errorf("script executor not configured")
		}
		return e.scriptExecutor.Execute(ctx, step, stepCtx)

	case grimoire.StepTypeAgent:
		if e.agentExecutor == nil {
			return nil, fmt.Errorf("agent executor not configured")
		}
		return e.agentExecutor.Execute(ctx, step, stepCtx)

	case grimoire.StepTypeLoop:
		if e.loopExecutor == nil {
			return nil, fmt.Errorf("loop executor not configured")
		}
		return e.loopExecutor.Execute(ctx, step, stepCtx)

	case grimoire.StepTypeMerge:
		if e.mergeExecutor == nil {
			return nil, fmt.Errorf("merge executor not configured")
		}
		return e.mergeExecutor.Execute(ctx, step, stepCtx)

	default:
		return nil, fmt.Errorf("unknown step type: %s", step.Type)
	}
}

// ExecuteByName loads a grimoire by name and executes it.
func (e *Engine) ExecuteByName(ctx context.Context, grimoireName string) *ExecutionResult {
	if e.grimoireLoader == nil {
		return &ExecutionResult{
			Status: WorkflowFailed,
			Error:  fmt.Errorf("grimoire loader not configured"),
		}
	}

	g, err := e.grimoireLoader.Load(grimoireName)
	if err != nil {
		return &ExecutionResult{
			Status: WorkflowFailed,
			Error:  fmt.Errorf("failed to load grimoire %q: %w", grimoireName, err),
		}
	}

	return e.Execute(ctx, g)
}

// SetAgentRunner sets the agent runner for agent steps.
func (e *Engine) SetAgentRunner(runner AgentRunner) {
	if e.agentExecutor != nil {
		e.agentExecutor.runner = runner
	}
	// Also update the loop executor's agent executor
	if e.loopExecutor != nil && e.loopExecutor.agentExecutor != nil {
		if agentExec, ok := e.loopExecutor.agentExecutor.(*AgentExecutor); ok {
			agentExec.runner = runner
		}
	}
}

// GetConfig returns the engine configuration.
func (e *Engine) GetConfig() EngineConfig {
	return e.config
}

// SetEventEmitter sets the event emitter for workflow events.
func (e *Engine) SetEventEmitter(emitter EventEmitter) {
	e.eventEmitter = emitter
}

// emit helper methods

func (e *Engine) emitWorkflowStarted(grimoireName string) {
	if e.eventEmitter != nil {
		e.eventEmitter.EmitWorkflowStarted(e.config.WorkflowID, e.config.BeadID, grimoireName)
	}
}

func (e *Engine) emitStepStarted(stepName, stepType string, stepIndex int) {
	if e.eventEmitter != nil {
		e.eventEmitter.EmitWorkflowStepStarted(e.config.WorkflowID, e.config.BeadID, stepName, stepType, stepIndex)
	}
}

func (e *Engine) emitStepCompleted(stepName string, stepIndex int, success bool, duration time.Duration, stepErr string) {
	if e.eventEmitter != nil {
		e.eventEmitter.EmitWorkflowStepCompleted(e.config.WorkflowID, e.config.BeadID, stepName, stepIndex, success, duration.String(), stepErr)
	}
}

func (e *Engine) emitWorkflowBlocked(reason string) {
	if e.eventEmitter != nil {
		e.eventEmitter.EmitWorkflowBlocked(e.config.WorkflowID, e.config.BeadID, reason)
	}
}

func (e *Engine) emitWorkflowMergePending() {
	if e.eventEmitter != nil {
		e.eventEmitter.EmitWorkflowMergePending(e.config.WorkflowID, e.config.BeadID)
	}
}

func (e *Engine) emitWorkflowCompleted(grimoireName string, duration time.Duration) {
	if e.eventEmitter != nil {
		e.eventEmitter.EmitWorkflowCompleted(e.config.WorkflowID, e.config.BeadID, grimoireName, duration.String())
	}
}

func (e *Engine) emitWorkflowCancelled() {
	if e.eventEmitter != nil {
		e.eventEmitter.EmitWorkflowCancelled(e.config.WorkflowID, e.config.BeadID)
	}
}
