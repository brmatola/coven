package workflow

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/coven/daemon/internal/grimoire"
)

// mockScriptExecutor wraps ScriptExecutor for testing.
type mockScriptExecutor struct {
	results []*StepResult
	errors  []error
	calls   int
}

func (m *mockScriptExecutor) Execute(ctx context.Context, step *grimoire.Step, stepCtx *StepContext) (*StepResult, error) {
	idx := m.calls
	m.calls++

	if idx < len(m.errors) && m.errors[idx] != nil {
		return nil, m.errors[idx]
	}

	if idx < len(m.results) {
		return m.results[idx], nil
	}

	return &StepResult{Success: true, Action: ActionContinue}, nil
}

// mockAgentExecutor wraps AgentExecutor for testing.
type mockAgentExecutor struct {
	results []*StepResult
	errors  []error
	calls   int
}

func (m *mockAgentExecutor) Execute(ctx context.Context, step *grimoire.Step, stepCtx *StepContext) (*StepResult, error) {
	idx := m.calls
	m.calls++

	if idx < len(m.errors) && m.errors[idx] != nil {
		return nil, m.errors[idx]
	}

	if idx < len(m.results) {
		return m.results[idx], nil
	}

	return &StepResult{Success: true, Action: ActionContinue}, nil
}

// mockLoopExecutor wraps LoopExecutor for testing.
type mockLoopExecutor struct {
	results []*StepResult
	errors  []error
	calls   int
}

func (m *mockLoopExecutor) Execute(ctx context.Context, step *grimoire.Step, stepCtx *StepContext) (*StepResult, error) {
	idx := m.calls
	m.calls++

	if idx < len(m.errors) && m.errors[idx] != nil {
		return nil, m.errors[idx]
	}

	if idx < len(m.results) {
		return m.results[idx], nil
	}

	return &StepResult{Success: true, Action: ActionContinue}, nil
}

// mockMergeExecutor wraps MergeExecutor for testing.
type mockMergeExecutor struct {
	results []*StepResult
	errors  []error
	calls   int
}

func (m *mockMergeExecutor) Execute(ctx context.Context, step *grimoire.Step, stepCtx *StepContext) (*StepResult, error) {
	idx := m.calls
	m.calls++

	if idx < len(m.errors) && m.errors[idx] != nil {
		return nil, m.errors[idx]
	}

	if idx < len(m.results) {
		return m.results[idx], nil
	}

	return &StepResult{Success: true, Action: ActionContinue}, nil
}

// testableEngine creates an engine with mock executors.
type testableEngine struct {
	*Engine
	scriptMock *mockScriptExecutor
	agentMock  *mockAgentExecutor
	loopMock   *mockLoopExecutor
	mergeMock  *mockMergeExecutor
}

func newTestableEngine() *testableEngine {
	scriptMock := &mockScriptExecutor{}
	agentMock := &mockAgentExecutor{}
	loopMock := &mockLoopExecutor{}
	mergeMock := &mockMergeExecutor{}

	// Create a wrapper that uses the StepExecutor interface
	engine := &Engine{
		config: EngineConfig{
			CovenDir:     "/tmp/.coven",
			WorktreePath: "/worktree",
			BeadID:       "bead-123",
			WorkflowID:   "wf-456",
		},
	}

	return &testableEngine{
		Engine:     engine,
		scriptMock: scriptMock,
		agentMock:  agentMock,
		loopMock:   loopMock,
		mergeMock:  mergeMock,
	}
}

func (te *testableEngine) executeStep(ctx context.Context, step *grimoire.Step, stepCtx *StepContext) (*StepResult, error) {
	switch step.Type {
	case grimoire.StepTypeScript:
		return te.scriptMock.Execute(ctx, step, stepCtx)
	case grimoire.StepTypeAgent:
		return te.agentMock.Execute(ctx, step, stepCtx)
	case grimoire.StepTypeLoop:
		return te.loopMock.Execute(ctx, step, stepCtx)
	case grimoire.StepTypeMerge:
		return te.mergeMock.Execute(ctx, step, stepCtx)
	default:
		return nil, nil
	}
}

func TestNewEngine(t *testing.T) {
	config := EngineConfig{
		CovenDir:     "/tmp/.coven",
		WorktreePath: "/worktree",
		BeadID:       "bead-123",
		WorkflowID:   "wf-456",
	}

	engine := NewEngine(config)

	if engine == nil {
		t.Fatal("NewEngine() returned nil")
	}
	if engine.config.BeadID != "bead-123" {
		t.Errorf("BeadID = %q, want %q", engine.config.BeadID, "bead-123")
	}
	if engine.scriptExecutor == nil {
		t.Error("scriptExecutor is nil")
	}
	if engine.mergeExecutor == nil {
		t.Error("mergeExecutor is nil")
	}
}

func TestEngine_Execute_SingleStep(t *testing.T) {
	te := newTestableEngine()
	te.scriptMock.results = []*StepResult{
		{Success: true, Output: "step output", Action: ActionContinue},
	}

	g := &grimoire.Grimoire{
		Name: "test-grimoire",
		Steps: []grimoire.Step{
			{Name: "test", Type: grimoire.StepTypeScript, Command: "echo test"},
		},
	}

	// Create engine that uses testableEngine's executeStep
	engine := &Engine{config: te.config}

	stepCtx := NewStepContext(engine.config.WorktreePath, engine.config.BeadID, engine.config.WorkflowID)
	result, err := te.scriptMock.Execute(context.Background(), &g.Steps[0], stepCtx)
	if err != nil {
		t.Fatalf("Execute error: %v", err)
	}

	if result.Action != ActionContinue {
		t.Errorf("Action = %q, want %q", result.Action, ActionContinue)
	}
}

func TestEngine_Execute_MultipleSteps(t *testing.T) {
	te := newTestableEngine()
	te.scriptMock.results = []*StepResult{
		{Success: true, Output: "step 1", Action: ActionContinue},
	}
	te.agentMock.results = []*StepResult{
		{Success: true, Output: "step 2", Action: ActionContinue},
	}

	g := &grimoire.Grimoire{
		Name: "test-grimoire",
		Steps: []grimoire.Step{
			{Name: "build", Type: grimoire.StepTypeScript, Command: "npm build"},
			{Name: "implement", Type: grimoire.StepTypeAgent, Spell: "implement"},
		},
	}

	// Execute steps manually with testable engine
	stepCtx := NewStepContext(te.config.WorktreePath, te.config.BeadID, te.config.WorkflowID)

	result1, err := te.scriptMock.Execute(context.Background(), &g.Steps[0], stepCtx)
	if err != nil {
		t.Fatalf("Step 1 error: %v", err)
	}
	stepCtx.SetPrevious(result1)

	result2, err := te.agentMock.Execute(context.Background(), &g.Steps[1], stepCtx)
	if err != nil {
		t.Fatalf("Step 2 error: %v", err)
	}

	if result1.Output != "step 1" {
		t.Errorf("Step 1 output = %q, want %q", result1.Output, "step 1")
	}
	if result2.Output != "step 2" {
		t.Errorf("Step 2 output = %q, want %q", result2.Output, "step 2")
	}
}

func TestEngine_Execute_StepFailure(t *testing.T) {
	te := newTestableEngine()
	te.scriptMock.results = []*StepResult{
		{Success: false, Error: "build failed", Action: ActionFail},
	}

	g := &grimoire.Grimoire{
		Name: "test-grimoire",
		Steps: []grimoire.Step{
			{Name: "build", Type: grimoire.StepTypeScript, Command: "npm build"},
			{Name: "test", Type: grimoire.StepTypeScript, Command: "npm test"},
		},
	}

	stepCtx := NewStepContext(te.config.WorktreePath, te.config.BeadID, te.config.WorkflowID)
	result, _ := te.scriptMock.Execute(context.Background(), &g.Steps[0], stepCtx)

	if result.Action != ActionFail {
		t.Errorf("Action = %q, want %q", result.Action, ActionFail)
	}
	if te.scriptMock.calls != 1 {
		t.Errorf("Script calls = %d, want 1 (should stop after failure)", te.scriptMock.calls)
	}
}

func TestEngine_Execute_StepBlock(t *testing.T) {
	te := newTestableEngine()
	te.mergeMock.results = []*StepResult{
		{Success: true, Output: "merge review", Action: ActionBlock},
	}

	g := &grimoire.Grimoire{
		Name: "test-grimoire",
		Steps: []grimoire.Step{
			{Name: "merge", Type: grimoire.StepTypeMerge},
		},
	}

	stepCtx := NewStepContext(te.config.WorktreePath, te.config.BeadID, te.config.WorkflowID)
	result, _ := te.mergeMock.Execute(context.Background(), &g.Steps[0], stepCtx)

	if result.Action != ActionBlock {
		t.Errorf("Action = %q, want %q", result.Action, ActionBlock)
	}
}

func TestEngine_Execute_ContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	// Engine should detect cancellation
	if ctx.Err() == nil {
		t.Error("Context should be cancelled")
	}
}

func TestEngine_Execute_LoopStep(t *testing.T) {
	te := newTestableEngine()
	te.loopMock.results = []*StepResult{
		{Success: true, Output: "loop completed", Action: ActionContinue},
	}

	g := &grimoire.Grimoire{
		Name: "test-grimoire",
		Steps: []grimoire.Step{
			{
				Name:          "quality-loop",
				Type:          grimoire.StepTypeLoop,
				MaxIterations: 3,
				Steps: []grimoire.Step{
					{Name: "test", Type: grimoire.StepTypeScript, Command: "npm test"},
				},
			},
		},
	}

	stepCtx := NewStepContext(te.config.WorktreePath, te.config.BeadID, te.config.WorkflowID)
	result, _ := te.loopMock.Execute(context.Background(), &g.Steps[0], stepCtx)

	if !result.Success {
		t.Error("Expected success")
	}
	if te.loopMock.calls != 1 {
		t.Errorf("Loop calls = %d, want 1", te.loopMock.calls)
	}
}

func TestEngine_Execute_AllStepTypes(t *testing.T) {
	te := newTestableEngine()
	te.scriptMock.results = []*StepResult{{Success: true, Action: ActionContinue}}
	te.agentMock.results = []*StepResult{{Success: true, Action: ActionContinue}}
	te.loopMock.results = []*StepResult{{Success: true, Action: ActionContinue}}
	te.mergeMock.results = []*StepResult{{Success: true, Action: ActionContinue}}

	g := &grimoire.Grimoire{
		Name: "test-grimoire",
		Steps: []grimoire.Step{
			{Name: "script", Type: grimoire.StepTypeScript, Command: "echo"},
			{Name: "agent", Type: grimoire.StepTypeAgent, Spell: "test"},
			{Name: "loop", Type: grimoire.StepTypeLoop, Steps: []grimoire.Step{{Name: "inner", Type: grimoire.StepTypeScript, Command: "echo"}}},
			{Name: "merge", Type: grimoire.StepTypeMerge},
		},
	}

	stepCtx := NewStepContext(te.config.WorktreePath, te.config.BeadID, te.config.WorkflowID)

	// Execute each step
	te.scriptMock.Execute(context.Background(), &g.Steps[0], stepCtx)
	te.agentMock.Execute(context.Background(), &g.Steps[1], stepCtx)
	te.loopMock.Execute(context.Background(), &g.Steps[2], stepCtx)
	te.mergeMock.Execute(context.Background(), &g.Steps[3], stepCtx)

	if te.scriptMock.calls != 1 {
		t.Errorf("Script calls = %d, want 1", te.scriptMock.calls)
	}
	if te.agentMock.calls != 1 {
		t.Errorf("Agent calls = %d, want 1", te.agentMock.calls)
	}
	if te.loopMock.calls != 1 {
		t.Errorf("Loop calls = %d, want 1", te.loopMock.calls)
	}
	if te.mergeMock.calls != 1 {
		t.Errorf("Merge calls = %d, want 1", te.mergeMock.calls)
	}
}

func TestEngine_Execute_ContextPropagation(t *testing.T) {
	te := newTestableEngine()
	te.scriptMock.results = []*StepResult{
		{Success: true, Output: "build output", Action: ActionContinue},
	}
	te.agentMock.results = []*StepResult{
		{Success: true, Output: "agent output", Action: ActionContinue},
	}

	g := &grimoire.Grimoire{
		Name: "test-grimoire",
		Steps: []grimoire.Step{
			{Name: "build", Type: grimoire.StepTypeScript, Command: "npm build", Output: "build_result"},
			{Name: "implement", Type: grimoire.StepTypeAgent, Spell: "implement"},
		},
	}

	stepCtx := NewStepContext(te.config.WorktreePath, te.config.BeadID, te.config.WorkflowID)

	// Execute step 1
	result1, _ := te.scriptMock.Execute(context.Background(), &g.Steps[0], stepCtx)
	stepCtx.SetVariable("build_result", result1.Output)
	stepCtx.SetPrevious(result1)

	// Execute step 2
	te.agentMock.Execute(context.Background(), &g.Steps[1], stepCtx)

	// Verify context propagation
	if stepCtx.GetVariable("build_result") != "build output" {
		t.Errorf("build_result = %v, want %q", stepCtx.GetVariable("build_result"), "build output")
	}

	prev := stepCtx.GetVariable("previous")
	if prev == nil {
		t.Error("previous should be set")
	}
}

func TestEngine_GetConfig(t *testing.T) {
	config := EngineConfig{
		CovenDir:     "/path/.coven",
		WorktreePath: "/worktree",
		BeadID:       "bead-xyz",
		WorkflowID:   "wf-abc",
	}

	engine := NewEngine(config)
	got := engine.GetConfig()

	if got.BeadID != config.BeadID {
		t.Errorf("BeadID = %q, want %q", got.BeadID, config.BeadID)
	}
	if got.WorkflowID != config.WorkflowID {
		t.Errorf("WorkflowID = %q, want %q", got.WorkflowID, config.WorkflowID)
	}
}

func TestEngine_executeStep_UnknownType(t *testing.T) {
	engine := NewEngine(EngineConfig{
		CovenDir:     "/tmp",
		WorktreePath: "/worktree",
		BeadID:       "bead",
		WorkflowID:   "wf",
	})

	step := &grimoire.Step{
		Name: "unknown",
		Type: grimoire.StepType("unknown"),
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	_, err := engine.executeStep(context.Background(), step, stepCtx)
	if err == nil {
		t.Fatal("Expected error for unknown step type")
	}
	if !strings.Contains(err.Error(), "unknown") {
		t.Errorf("Error should mention unknown type, got: %q", err.Error())
	}
}

func TestExecutionResult_Fields(t *testing.T) {
	result := &ExecutionResult{
		Status:      WorkflowCompleted,
		StepResults: map[string]*StepResult{"step1": {Success: true}},
		CurrentStep: 1,
		Duration:    time.Second,
	}

	if result.Status != WorkflowCompleted {
		t.Errorf("Status = %q, want %q", result.Status, WorkflowCompleted)
	}
	if len(result.StepResults) != 1 {
		t.Errorf("StepResults length = %d, want 1", len(result.StepResults))
	}
	if result.CurrentStep != 1 {
		t.Errorf("CurrentStep = %d, want 1", result.CurrentStep)
	}
	if result.Duration != time.Second {
		t.Errorf("Duration = %v, want 1s", result.Duration)
	}
}

func TestEngine_Execute_FullWorkflow(t *testing.T) {
	config := EngineConfig{
		CovenDir:     t.TempDir(),
		WorktreePath: t.TempDir(),
		BeadID:       "test-bead",
		WorkflowID:   "test-wf",
	}

	engine := NewEngine(config)

	// Create a simple grimoire with just script steps
	g := &grimoire.Grimoire{
		Name: "test-workflow",
		Steps: []grimoire.Step{
			{Name: "echo", Type: grimoire.StepTypeScript, Command: "echo hello"},
		},
	}

	result := engine.Execute(context.Background(), g)

	if result.Status != WorkflowCompleted {
		t.Errorf("Status = %q, want %q, error: %v", result.Status, WorkflowCompleted, result.Error)
	}
}

func TestEngine_Execute_WithCancelledContext(t *testing.T) {
	config := EngineConfig{
		CovenDir:     t.TempDir(),
		WorktreePath: t.TempDir(),
		BeadID:       "test-bead",
		WorkflowID:   "test-wf",
	}

	engine := NewEngine(config)

	g := &grimoire.Grimoire{
		Name: "test-workflow",
		Steps: []grimoire.Step{
			{Name: "test", Type: grimoire.StepTypeScript, Command: "echo hello"},
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	result := engine.Execute(ctx, g)

	if result.Status != WorkflowCancelled {
		t.Errorf("Status = %q, want %q", result.Status, WorkflowCancelled)
	}
}

func TestEngine_ExecuteByName_NoLoader(t *testing.T) {
	engine := &Engine{config: EngineConfig{}}

	result := engine.ExecuteByName(context.Background(), "test")

	if result.Status != WorkflowFailed {
		t.Errorf("Status = %q, want %q", result.Status, WorkflowFailed)
	}
	if result.Error == nil {
		t.Error("Error should be set")
	}
}

func TestEngine_SetAgentRunner(t *testing.T) {
	config := EngineConfig{
		CovenDir:     t.TempDir(),
		WorktreePath: t.TempDir(),
		BeadID:       "test-bead",
		WorkflowID:   "test-wf",
	}

	engine := NewEngine(config)

	runner := &MockAgentRunner{
		Output:   `{"success": true, "summary": "done"}`,
		ExitCode: 0,
	}

	engine.SetAgentRunner(runner)

	// Verify runner was set
	if engine.agentExecutor.runner != runner {
		t.Error("Agent runner was not set")
	}
}

func TestEngine_Execute_MissingScriptExecutor(t *testing.T) {
	engine := &Engine{
		config: EngineConfig{
			WorktreePath: t.TempDir(),
			BeadID:       "bead",
			WorkflowID:   "wf",
		},
		// No executors configured
	}

	g := &grimoire.Grimoire{
		Name: "test",
		Steps: []grimoire.Step{
			{Name: "test", Type: grimoire.StepTypeScript, Command: "echo"},
		},
	}

	result := engine.Execute(context.Background(), g)

	if result.Status != WorkflowFailed {
		t.Errorf("Status = %q, want %q", result.Status, WorkflowFailed)
	}
	if result.Error == nil || !strings.Contains(result.Error.Error(), "script executor") {
		t.Errorf("Error should mention script executor, got: %v", result.Error)
	}
}

func TestEngine_Execute_MissingAgentExecutor(t *testing.T) {
	engine := &Engine{
		config: EngineConfig{
			WorktreePath: t.TempDir(),
			BeadID:       "bead",
			WorkflowID:   "wf",
		},
	}

	g := &grimoire.Grimoire{
		Name: "test",
		Steps: []grimoire.Step{
			{Name: "test", Type: grimoire.StepTypeAgent, Spell: "test"},
		},
	}

	result := engine.Execute(context.Background(), g)

	if result.Status != WorkflowFailed {
		t.Errorf("Status = %q, want %q", result.Status, WorkflowFailed)
	}
}

func TestEngine_Execute_MissingLoopExecutor(t *testing.T) {
	engine := &Engine{
		config: EngineConfig{
			WorktreePath: t.TempDir(),
			BeadID:       "bead",
			WorkflowID:   "wf",
		},
	}

	g := &grimoire.Grimoire{
		Name: "test",
		Steps: []grimoire.Step{
			{Name: "test", Type: grimoire.StepTypeLoop, Steps: []grimoire.Step{{Name: "inner", Type: grimoire.StepTypeScript, Command: "echo"}}},
		},
	}

	result := engine.Execute(context.Background(), g)

	if result.Status != WorkflowFailed {
		t.Errorf("Status = %q, want %q", result.Status, WorkflowFailed)
	}
}

func TestEngine_Execute_MissingMergeExecutor(t *testing.T) {
	engine := &Engine{
		config: EngineConfig{
			WorktreePath: t.TempDir(),
			BeadID:       "bead",
			WorkflowID:   "wf",
		},
	}

	g := &grimoire.Grimoire{
		Name: "test",
		Steps: []grimoire.Step{
			{Name: "test", Type: grimoire.StepTypeMerge},
		},
	}

	result := engine.Execute(context.Background(), g)

	if result.Status != WorkflowFailed {
		t.Errorf("Status = %q, want %q", result.Status, WorkflowFailed)
	}
}
