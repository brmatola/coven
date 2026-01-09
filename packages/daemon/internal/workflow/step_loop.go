package workflow

import (
	"context"
	"fmt"
	"time"

	"github.com/coven/daemon/internal/grimoire"
)

// StepExecutor is the interface for executing any step type.
type StepExecutor interface {
	Execute(ctx context.Context, step *grimoire.Step, stepCtx *StepContext) (*StepResult, error)
}

// LoopExecutor executes loop steps.
type LoopExecutor struct {
	scriptExecutor StepExecutor
	agentExecutor  StepExecutor
}

// NewLoopExecutor creates a new loop executor.
func NewLoopExecutor(scriptExecutor, agentExecutor StepExecutor) *LoopExecutor {
	return &LoopExecutor{
		scriptExecutor: scriptExecutor,
		agentExecutor:  agentExecutor,
	}
}

// Execute runs a loop step and returns the result.
func (e *LoopExecutor) Execute(ctx context.Context, step *grimoire.Step, stepCtx *StepContext) (*StepResult, error) {
	if step.Type != grimoire.StepTypeLoop {
		return nil, fmt.Errorf("expected loop step, got %s", step.Type)
	}

	if len(step.Steps) == 0 {
		return nil, fmt.Errorf("loop step %q has no nested steps", step.Name)
	}

	// Get timeout for entire loop
	timeout, err := step.GetTimeout()
	if err != nil {
		return nil, fmt.Errorf("invalid timeout: %w", err)
	}

	// Create context with timeout
	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// Determine max iterations (0 means unlimited)
	maxIterations := step.MaxIterations
	if maxIterations <= 0 {
		maxIterations = 100 // Default safety limit
	}

	start := time.Now()
	var lastResult *StepResult
	var iteration int

	// Execute loop iterations
	for iteration = 0; iteration < maxIterations; iteration++ {
		// Check for context cancellation/timeout
		if execCtx.Err() != nil {
			duration := time.Since(start)
			if execCtx.Err() == context.DeadlineExceeded {
				return &StepResult{
					Success:  false,
					Output:   fmt.Sprintf("Loop timed out after %d iterations", iteration),
					ExitCode: -1,
					Error:    fmt.Sprintf("loop timed out after %s", timeout),
					Duration: duration,
					Action:   ActionFail,
				}, nil
			}
			return nil, execCtx.Err()
		}

		// Execute nested steps
		result, exitLoop, err := e.executeIteration(execCtx, step, stepCtx, iteration)
		if err != nil {
			return nil, err
		}

		lastResult = result

		// Check if we should exit the loop
		if exitLoop {
			break
		}
	}

	duration := time.Since(start)

	// Check if we hit max iterations
	if iteration >= maxIterations {
		return e.handleMaxIterations(step, lastResult, duration, iteration)
	}

	// Loop completed normally (via exit_loop, block, or success)
	if lastResult == nil {
		lastResult = &StepResult{
			Success:  true,
			Output:   "Loop completed with no iterations",
			Duration: duration,
			Action:   ActionContinue,
		}
	}

	// Preserve block/fail actions from nested steps
	action := ActionContinue
	if lastResult.Action == ActionBlock || lastResult.Action == ActionFail {
		action = lastResult.Action
	}

	return &StepResult{
		Success:  lastResult.Success,
		Output:   lastResult.Output,
		ExitCode: lastResult.ExitCode,
		Error:    lastResult.Error,
		Duration: duration,
		Action:   action,
	}, nil
}

// executeIteration executes all nested steps for one loop iteration.
// Returns the last step result, whether to exit the loop, and any error.
func (e *LoopExecutor) executeIteration(ctx context.Context, loopStep *grimoire.Step, stepCtx *StepContext, iteration int) (*StepResult, bool, error) {
	// Set loop context
	stepCtx.InLoop = true
	stepCtx.LoopIteration = iteration

	// Set loop variable for template access
	stepCtx.SetVariable(loopStep.Name, map[string]interface{}{
		"iteration": iteration,
	})

	var lastResult *StepResult

	for i := range loopStep.Steps {
		nestedStep := &loopStep.Steps[i]

		// Check for context cancellation before each step
		if ctx.Err() != nil {
			return nil, false, nil // Let the main loop handle timeout
		}

		// Execute the nested step
		result, err := e.executeStep(ctx, nestedStep, stepCtx)
		if err != nil {
			// Check if it's a context error (timeout)
			if ctx.Err() != nil {
				return nil, false, nil // Let the main loop handle timeout
			}
			return nil, false, fmt.Errorf("failed to execute step %q: %w", nestedStep.Name, err)
		}

		// Set previous result for next step
		stepCtx.SetPrevious(result)
		lastResult = result

		// Check for exit_loop action
		if result.Action == ActionExitLoop {
			return result, true, nil
		}

		// Check for block action
		if result.Action == ActionBlock {
			return result, true, nil
		}

		// Check for fail action
		if result.Action == ActionFail {
			// Loop step handles failure based on on_fail configuration
			// By default, continue to next step in iteration
			if nestedStep.OnFail == "block" {
				return &StepResult{
					Success:  false,
					Output:   result.Output,
					ExitCode: result.ExitCode,
					Error:    result.Error,
					Duration: result.Duration,
					Action:   ActionBlock,
				}, true, nil
			}
			if nestedStep.OnFail == "" || nestedStep.OnFail == "continue" {
				continue
			}
			// "fail" or "exit" breaks out with failure
			return result, true, nil
		}
	}

	return lastResult, false, nil
}

// executeStep dispatches to the appropriate executor based on step type.
func (e *LoopExecutor) executeStep(ctx context.Context, step *grimoire.Step, stepCtx *StepContext) (*StepResult, error) {
	switch step.Type {
	case grimoire.StepTypeScript:
		if e.scriptExecutor == nil {
			return nil, fmt.Errorf("no script executor configured")
		}
		return e.scriptExecutor.Execute(ctx, step, stepCtx)

	case grimoire.StepTypeAgent:
		if e.agentExecutor == nil {
			return nil, fmt.Errorf("no agent executor configured")
		}
		return e.agentExecutor.Execute(ctx, step, stepCtx)

	case grimoire.StepTypeLoop:
		// Nested loops are supported
		return e.Execute(ctx, step, stepCtx)

	default:
		return nil, fmt.Errorf("unsupported step type in loop: %s", step.Type)
	}
}

// handleMaxIterations handles the case when max iterations is reached.
func (e *LoopExecutor) handleMaxIterations(step *grimoire.Step, lastResult *StepResult, duration time.Duration, iterations int) (*StepResult, error) {
	var output string
	if lastResult != nil {
		output = lastResult.Output
	}

	switch step.OnMaxIterations {
	case string(grimoire.OnMaxIterationsBlock):
		return &StepResult{
			Success:  false,
			Output:   output,
			ExitCode: -1,
			Error:    fmt.Sprintf("loop reached max iterations (%d)", iterations),
			Duration: duration,
			Action:   ActionBlock,
		}, nil

	case string(grimoire.OnMaxIterationsContinue):
		return &StepResult{
			Success:  true,
			Output:   output,
			Duration: duration,
			Action:   ActionContinue,
		}, nil

	case string(grimoire.OnMaxIterationsExit), "":
		// Default behavior: fail the workflow
		return &StepResult{
			Success:  false,
			Output:   output,
			ExitCode: -1,
			Error:    fmt.Sprintf("loop reached max iterations (%d)", iterations),
			Duration: duration,
			Action:   ActionFail,
		}, nil

	default:
		// Unknown action, fail safely
		return &StepResult{
			Success:  false,
			Output:   output,
			ExitCode: -1,
			Error:    fmt.Sprintf("loop reached max iterations (%d)", iterations),
			Duration: duration,
			Action:   ActionFail,
		}, nil
	}
}
