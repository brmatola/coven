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

	return &Engine{
		config:         config,
		scriptExecutor: scriptExecutor,
		agentExecutor:  agentExecutor,
		loopExecutor:   loopExecutor,
		mergeExecutor:  mergeExecutor,
		spellLoader:    spellLoader,
		grimoireLoader: grimoireLoader,
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
	start := time.Now()

	result := &ExecutionResult{
		Status:      WorkflowRunning,
		StepResults: make(map[string]*StepResult),
	}

	// Create step context
	stepCtx := NewStepContext(e.config.WorktreePath, e.config.BeadID, e.config.WorkflowID)

	// Execute steps in sequence
	for i := range g.Steps {
		step := &g.Steps[i]
		result.CurrentStep = i

		// Check for context cancellation
		if ctx.Err() != nil {
			result.Status = WorkflowCancelled
			result.Error = ctx.Err()
			result.Duration = time.Since(start)
			return result
		}

		// Execute the step
		stepResult, err := e.executeStep(ctx, step, stepCtx)
		if err != nil {
			result.Status = WorkflowFailed
			result.Error = fmt.Errorf("step %q failed: %w", step.Name, err)
			result.Duration = time.Since(start)
			return result
		}

		// Store result
		result.StepResults[step.Name] = stepResult

		// Store output in context if configured
		if step.Output != "" {
			stepCtx.SetVariable(step.Output, stepResult.Output)
		}

		// Update previous step result for next step
		stepCtx.SetPrevious(stepResult)

		// Handle step action
		switch stepResult.Action {
		case ActionContinue:
			// Continue to next step
			continue

		case ActionBlock:
			// Workflow blocked, needs human intervention
			result.Status = WorkflowBlocked
			result.Duration = time.Since(start)
			return result

		case ActionFail:
			// Step failed, workflow fails
			result.Status = WorkflowFailed
			result.Error = fmt.Errorf("step %q failed: %s", step.Name, stepResult.Error)
			result.Duration = time.Since(start)
			return result

		case ActionExitLoop:
			// This shouldn't happen at top level, treat as continue
			continue
		}
	}

	// All steps completed successfully
	result.Status = WorkflowCompleted
	result.Duration = time.Since(start)
	return result
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
