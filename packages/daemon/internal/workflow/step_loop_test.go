package workflow

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/coven/daemon/internal/grimoire"
)

// CapturedContext stores a snapshot of StepContext values at execution time.
type CapturedContext struct {
	WorktreePath  string
	BeadID        string
	WorkflowID    string
	InLoop        bool
	LoopIteration int
	Variables     map[string]interface{}
}

// MockStepExecutor is a mock implementation for testing.
type MockStepExecutor struct {
	// Results is a list of results to return in order.
	Results []*StepResult
	// Errors is a list of errors to return in order.
	Errors []error
	// CallCount tracks how many times Execute was called.
	CallCount int
	// Steps tracks the steps that were executed.
	Steps []*grimoire.Step
	// CapturedContexts stores snapshots of context values at execution time.
	CapturedContexts []CapturedContext
}

func (m *MockStepExecutor) Execute(ctx context.Context, step *grimoire.Step, stepCtx *StepContext) (*StepResult, error) {
	m.Steps = append(m.Steps, step)

	// Capture a snapshot of the context values
	captured := CapturedContext{
		WorktreePath:  stepCtx.WorktreePath,
		BeadID:        stepCtx.BeadID,
		WorkflowID:    stepCtx.WorkflowID,
		InLoop:        stepCtx.InLoop,
		LoopIteration: stepCtx.LoopIteration,
		Variables:     make(map[string]interface{}),
	}
	// Deep copy variables
	for k, v := range stepCtx.Variables {
		captured.Variables[k] = v
	}
	m.CapturedContexts = append(m.CapturedContexts, captured)

	idx := m.CallCount
	m.CallCount++

	if idx < len(m.Errors) && m.Errors[idx] != nil {
		return nil, m.Errors[idx]
	}

	if idx < len(m.Results) {
		return m.Results[idx], nil
	}

	// Default success result
	return &StepResult{
		Success: true,
		Action:  ActionContinue,
	}, nil
}

func TestNewLoopExecutor(t *testing.T) {
	scriptExec := &MockStepExecutor{}
	agentExec := &MockStepExecutor{}

	executor := NewLoopExecutor(scriptExec, agentExec)

	if executor == nil {
		t.Fatal("NewLoopExecutor() returned nil")
	}
	if executor.scriptExecutor == nil {
		t.Error("scriptExecutor is nil")
	}
	if executor.agentExecutor == nil {
		t.Error("agentExecutor is nil")
	}
}

func TestLoopExecutor_Execute_WrongType(t *testing.T) {
	executor := NewLoopExecutor(&MockStepExecutor{}, &MockStepExecutor{})

	step := &grimoire.Step{
		Name: "test",
		Type: grimoire.StepTypeScript,
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	_, err := executor.Execute(context.Background(), step, stepCtx)
	if err == nil {
		t.Fatal("Expected error for wrong step type")
	}
	if !strings.Contains(err.Error(), "expected loop step") {
		t.Errorf("Error should mention expected type, got: %q", err.Error())
	}
}

func TestLoopExecutor_Execute_NoNestedSteps(t *testing.T) {
	executor := NewLoopExecutor(&MockStepExecutor{}, &MockStepExecutor{})

	step := &grimoire.Step{
		Name:  "test",
		Type:  grimoire.StepTypeLoop,
		Steps: []grimoire.Step{},
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	_, err := executor.Execute(context.Background(), step, stepCtx)
	if err == nil {
		t.Fatal("Expected error for no nested steps")
	}
}

func TestLoopExecutor_Execute_SingleIteration(t *testing.T) {
	scriptExec := &MockStepExecutor{
		Results: []*StepResult{
			{Success: true, Action: ActionExitLoop, Output: "done"},
		},
	}
	executor := NewLoopExecutor(scriptExec, &MockStepExecutor{})

	step := &grimoire.Step{
		Name:          "quality-loop",
		Type:          grimoire.StepTypeLoop,
		MaxIterations: 3,
		Steps: []grimoire.Step{
			{Name: "test", Type: grimoire.StepTypeScript, Command: "npm test"},
		},
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if !result.Success {
		t.Error("Expected success")
	}
	if result.Action != ActionContinue {
		t.Errorf("Action = %q, want %q", result.Action, ActionContinue)
	}
	if scriptExec.CallCount != 1 {
		t.Errorf("CallCount = %d, want 1", scriptExec.CallCount)
	}
}

func TestLoopExecutor_Execute_MultipleIterations(t *testing.T) {
	scriptExec := &MockStepExecutor{
		Results: []*StepResult{
			{Success: false, Action: ActionContinue}, // Iteration 0
			{Success: false, Action: ActionContinue}, // Iteration 1
			{Success: true, Action: ActionExitLoop},  // Iteration 2 - exit
		},
	}
	executor := NewLoopExecutor(scriptExec, &MockStepExecutor{})

	step := &grimoire.Step{
		Name:          "retry-loop",
		Type:          grimoire.StepTypeLoop,
		MaxIterations: 5,
		Steps: []grimoire.Step{
			{Name: "try", Type: grimoire.StepTypeScript, Command: "npm test", OnFail: "continue"},
		},
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if !result.Success {
		t.Error("Expected success")
	}
	if scriptExec.CallCount != 3 {
		t.Errorf("CallCount = %d, want 3", scriptExec.CallCount)
	}
}

func TestLoopExecutor_Execute_MaxIterationsReached_Exit(t *testing.T) {
	scriptExec := &MockStepExecutor{
		Results: []*StepResult{
			{Success: false, Action: ActionContinue},
			{Success: false, Action: ActionContinue},
			{Success: false, Action: ActionContinue},
		},
	}
	executor := NewLoopExecutor(scriptExec, &MockStepExecutor{})

	step := &grimoire.Step{
		Name:            "retry-loop",
		Type:            grimoire.StepTypeLoop,
		MaxIterations:   3,
		OnMaxIterations: "exit",
		Steps: []grimoire.Step{
			{Name: "try", Type: grimoire.StepTypeScript, Command: "npm test", OnFail: "continue"},
		},
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if result.Success {
		t.Error("Expected failure when max iterations reached with exit")
	}
	if result.Action != ActionFail {
		t.Errorf("Action = %q, want %q", result.Action, ActionFail)
	}
	if !strings.Contains(result.Error, "max iterations") {
		t.Errorf("Error should mention max iterations, got: %q", result.Error)
	}
}

func TestLoopExecutor_Execute_MaxIterationsReached_Block(t *testing.T) {
	scriptExec := &MockStepExecutor{
		Results: []*StepResult{
			{Success: false, Action: ActionContinue},
			{Success: false, Action: ActionContinue},
		},
	}
	executor := NewLoopExecutor(scriptExec, &MockStepExecutor{})

	step := &grimoire.Step{
		Name:            "retry-loop",
		Type:            grimoire.StepTypeLoop,
		MaxIterations:   2,
		OnMaxIterations: "block",
		Steps: []grimoire.Step{
			{Name: "try", Type: grimoire.StepTypeScript, Command: "npm test", OnFail: "continue"},
		},
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if result.Success {
		t.Error("Expected failure when max iterations reached with block")
	}
	if result.Action != ActionBlock {
		t.Errorf("Action = %q, want %q", result.Action, ActionBlock)
	}
}

func TestLoopExecutor_Execute_MaxIterationsReached_Continue(t *testing.T) {
	scriptExec := &MockStepExecutor{
		Results: []*StepResult{
			{Success: false, Action: ActionContinue},
		},
	}
	executor := NewLoopExecutor(scriptExec, &MockStepExecutor{})

	step := &grimoire.Step{
		Name:            "retry-loop",
		Type:            grimoire.StepTypeLoop,
		MaxIterations:   1,
		OnMaxIterations: "continue",
		Steps: []grimoire.Step{
			{Name: "try", Type: grimoire.StepTypeScript, Command: "npm test", OnFail: "continue"},
		},
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if !result.Success {
		t.Error("Expected success when max iterations reached with continue")
	}
	if result.Action != ActionContinue {
		t.Errorf("Action = %q, want %q", result.Action, ActionContinue)
	}
}

func TestLoopExecutor_Execute_IterationVariable(t *testing.T) {
	scriptExec := &MockStepExecutor{
		Results: []*StepResult{
			{Success: false, Action: ActionContinue},
			{Success: false, Action: ActionContinue},
			{Success: true, Action: ActionExitLoop},
		},
	}
	executor := NewLoopExecutor(scriptExec, &MockStepExecutor{})

	step := &grimoire.Step{
		Name:          "quality-loop",
		Type:          grimoire.StepTypeLoop,
		MaxIterations: 5,
		Steps: []grimoire.Step{
			{Name: "test", Type: grimoire.StepTypeScript, Command: "npm test", OnFail: "continue"},
		},
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	_, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	// Check that iteration variables were set correctly
	if len(scriptExec.CapturedContexts) != 3 {
		t.Fatalf("Expected 3 contexts, got %d", len(scriptExec.CapturedContexts))
	}

	for i, ctx := range scriptExec.CapturedContexts {
		if !ctx.InLoop {
			t.Errorf("Iteration %d: InLoop should be true", i)
		}
		if ctx.LoopIteration != i {
			t.Errorf("Iteration %d: LoopIteration = %d", i, ctx.LoopIteration)
		}

		loopVar := ctx.Variables["quality-loop"]
		if loopVar == nil {
			t.Errorf("Iteration %d: loop variable not set", i)
			continue
		}

		loopMap, ok := loopVar.(map[string]interface{})
		if !ok {
			t.Errorf("Iteration %d: loop variable wrong type", i)
			continue
		}

		if loopMap["iteration"] != i {
			t.Errorf("Iteration %d: {{.quality-loop.iteration}} = %v", i, loopMap["iteration"])
		}
	}
}

func TestLoopExecutor_Execute_MultipleNestedSteps(t *testing.T) {
	scriptExec := &MockStepExecutor{
		Results: []*StepResult{
			// Iteration 0
			{Success: false, Action: ActionContinue}, // test fails
			// Iteration 1
			{Success: true, Action: ActionContinue}, // test passes
			{Success: true, Action: ActionExitLoop}, // final passes, exit
		},
	}
	agentExec := &MockStepExecutor{
		Results: []*StepResult{
			{Success: true, Action: ActionContinue}, // fix-tests
		},
	}
	executor := NewLoopExecutor(scriptExec, agentExec)

	step := &grimoire.Step{
		Name:          "quality-loop",
		Type:          grimoire.StepTypeLoop,
		MaxIterations: 3,
		Steps: []grimoire.Step{
			{Name: "test", Type: grimoire.StepTypeScript, Command: "npm test", OnFail: "continue"},
			{Name: "fix", Type: grimoire.StepTypeAgent, Spell: "fix-tests", When: "{{.previous.failed}}"},
			{Name: "final", Type: grimoire.StepTypeScript, Command: "npm test", OnSuccess: "exit_loop"},
		},
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if !result.Success {
		t.Error("Expected success")
	}
	// 3 script calls (test fail, test pass, final pass)
	// 1 agent call (fix)
	if scriptExec.CallCount != 3 {
		t.Errorf("Script CallCount = %d, want 3", scriptExec.CallCount)
	}
	if agentExec.CallCount != 1 {
		t.Errorf("Agent CallCount = %d, want 1", agentExec.CallCount)
	}
}

func TestLoopExecutor_Execute_NestedStepFailure_Block(t *testing.T) {
	scriptExec := &MockStepExecutor{
		Results: []*StepResult{
			{Success: false, Action: ActionFail},
		},
	}
	executor := NewLoopExecutor(scriptExec, &MockStepExecutor{})

	step := &grimoire.Step{
		Name:          "loop",
		Type:          grimoire.StepTypeLoop,
		MaxIterations: 3,
		Steps: []grimoire.Step{
			{Name: "test", Type: grimoire.StepTypeScript, Command: "npm test", OnFail: "block"},
		},
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if result.Success {
		t.Error("Expected failure")
	}
	if result.Action != ActionBlock {
		t.Errorf("Action = %q, want %q", result.Action, ActionBlock)
	}
}

func TestLoopExecutor_Execute_Timeout(t *testing.T) {
	scriptExec := &MockStepExecutor{
		Results: []*StepResult{},
	}

	// Override Execute to simulate slow execution
	slowExecutor := &slowMockExecutor{delay: 100 * time.Millisecond}
	executor := NewLoopExecutor(slowExecutor, &MockStepExecutor{})

	step := &grimoire.Step{
		Name:          "slow-loop",
		Type:          grimoire.StepTypeLoop,
		Timeout:       "50ms",
		MaxIterations: 100,
		Steps: []grimoire.Step{
			{Name: "slow", Type: grimoire.StepTypeScript, Command: "sleep 1"},
		},
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if result.Success {
		t.Error("Expected failure due to timeout")
	}
	if !strings.Contains(result.Error, "timed out") {
		t.Errorf("Error should mention timeout, got: %q", result.Error)
	}

	// Cleanup
	_ = scriptExec
}

type slowMockExecutor struct {
	delay time.Duration
}

func (m *slowMockExecutor) Execute(ctx context.Context, step *grimoire.Step, stepCtx *StepContext) (*StepResult, error) {
	select {
	case <-time.After(m.delay):
		return &StepResult{Success: true, Action: ActionContinue}, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func TestLoopExecutor_Execute_NoExecutor(t *testing.T) {
	executor := NewLoopExecutor(nil, nil)

	step := &grimoire.Step{
		Name:          "loop",
		Type:          grimoire.StepTypeLoop,
		MaxIterations: 1,
		Steps: []grimoire.Step{
			{Name: "test", Type: grimoire.StepTypeScript, Command: "npm test"},
		},
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	_, err := executor.Execute(context.Background(), step, stepCtx)
	if err == nil {
		t.Fatal("Expected error for missing executor")
	}
	if !strings.Contains(err.Error(), "no script executor") {
		t.Errorf("Error should mention missing executor, got: %q", err.Error())
	}
}

func TestLoopExecutor_Execute_NoAgentExecutor(t *testing.T) {
	executor := NewLoopExecutor(&MockStepExecutor{}, nil)

	step := &grimoire.Step{
		Name:          "loop",
		Type:          grimoire.StepTypeLoop,
		MaxIterations: 1,
		Steps: []grimoire.Step{
			{Name: "test", Type: grimoire.StepTypeAgent, Spell: "test"},
		},
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	_, err := executor.Execute(context.Background(), step, stepCtx)
	if err == nil {
		t.Fatal("Expected error for missing agent executor")
	}
	if !strings.Contains(err.Error(), "no agent executor") {
		t.Errorf("Error should mention missing executor, got: %q", err.Error())
	}
}

func TestLoopExecutor_Execute_UnsupportedStepType(t *testing.T) {
	executor := NewLoopExecutor(&MockStepExecutor{}, &MockStepExecutor{})

	step := &grimoire.Step{
		Name:          "loop",
		Type:          grimoire.StepTypeLoop,
		MaxIterations: 1,
		Steps: []grimoire.Step{
			{Name: "merge", Type: grimoire.StepTypeMerge},
		},
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	_, err := executor.Execute(context.Background(), step, stepCtx)
	if err == nil {
		t.Fatal("Expected error for unsupported step type")
	}
	if !strings.Contains(err.Error(), "unsupported step type") {
		t.Errorf("Error should mention unsupported type, got: %q", err.Error())
	}
}

func TestLoopExecutor_Execute_NestedLoop(t *testing.T) {
	// Provide enough results for all possible iterations
	scriptExec := &MockStepExecutor{
		Results: []*StepResult{
			// Outer iteration 0, inner iteration 0 - exit inner loop
			{Success: true, Action: ActionExitLoop},
			// Outer iteration 1, inner iteration 0 - exit inner loop
			{Success: true, Action: ActionExitLoop},
		},
	}
	executor := NewLoopExecutor(scriptExec, &MockStepExecutor{})

	step := &grimoire.Step{
		Name:            "outer-loop",
		Type:            grimoire.StepTypeLoop,
		MaxIterations:   2,
		OnMaxIterations: "continue", // Continue when max is reached
		Steps: []grimoire.Step{
			{
				Name:          "inner-loop",
				Type:          grimoire.StepTypeLoop,
				MaxIterations: 2,
				Steps: []grimoire.Step{
					{Name: "test", Type: grimoire.StepTypeScript, Command: "npm test", OnSuccess: "exit_loop"},
				},
			},
		},
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if !result.Success {
		t.Errorf("Expected success, got error: %s", result.Error)
	}

	// Both outer iterations should run, each with one inner iteration
	if scriptExec.CallCount != 2 {
		t.Errorf("CallCount = %d, want 2", scriptExec.CallCount)
	}
}

func TestLoopExecutor_Execute_DefaultMaxIterations(t *testing.T) {
	scriptExec := &MockStepExecutor{}

	// Fill results to allow 101 iterations but we should stop at 100
	for i := 0; i < 101; i++ {
		scriptExec.Results = append(scriptExec.Results, &StepResult{
			Success: false,
			Action:  ActionContinue,
		})
	}
	executor := NewLoopExecutor(scriptExec, &MockStepExecutor{})

	step := &grimoire.Step{
		Name: "loop",
		Type: grimoire.StepTypeLoop,
		// No MaxIterations set - should default to 100
		Steps: []grimoire.Step{
			{Name: "test", Type: grimoire.StepTypeScript, Command: "npm test", OnFail: "continue"},
		},
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	// Should hit default max of 100
	if scriptExec.CallCount != 100 {
		t.Errorf("CallCount = %d, want 100 (default max)", scriptExec.CallCount)
	}
	if result.Success {
		t.Error("Expected failure when hitting default max iterations")
	}
}

func TestLoopExecutor_Execute_PreviousVariable(t *testing.T) {
	scriptExec := &MockStepExecutor{
		Results: []*StepResult{
			{Success: false, Output: "test failed", Action: ActionContinue},
			{Success: true, Output: "test passed", Action: ActionExitLoop},
		},
	}
	executor := NewLoopExecutor(scriptExec, &MockStepExecutor{})

	step := &grimoire.Step{
		Name:          "loop",
		Type:          grimoire.StepTypeLoop,
		MaxIterations: 3,
		Steps: []grimoire.Step{
			{Name: "test", Type: grimoire.StepTypeScript, Command: "npm test", OnFail: "continue"},
		},
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	_, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	// Verify previous was set after first iteration
	if len(scriptExec.CapturedContexts) >= 2 {
		ctx := scriptExec.CapturedContexts[1]
		prev := ctx.Variables["previous"]
		if prev == nil {
			t.Error("previous variable should be set for second iteration")
		} else {
			prevMap := prev.(map[string]interface{})
			if prevMap["success"] != false {
				t.Error("previous.success should be false")
			}
			if prevMap["failed"] != true {
				t.Error("previous.failed should be true")
			}
		}
	}
}

func TestLoopExecutor_Execute_InvalidTimeout(t *testing.T) {
	executor := NewLoopExecutor(&MockStepExecutor{}, &MockStepExecutor{})

	step := &grimoire.Step{
		Name:          "loop",
		Type:          grimoire.StepTypeLoop,
		Timeout:       "invalid",
		MaxIterations: 1,
		Steps: []grimoire.Step{
			{Name: "test", Type: grimoire.StepTypeScript, Command: "npm test"},
		},
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	_, err := executor.Execute(context.Background(), step, stepCtx)
	if err == nil {
		t.Fatal("Expected error for invalid timeout")
	}
	if !strings.Contains(err.Error(), "invalid timeout") {
		t.Errorf("Error should mention invalid timeout, got: %q", err.Error())
	}
}
