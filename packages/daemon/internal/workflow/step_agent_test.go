package workflow

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coven/daemon/internal/grimoire"
	"github.com/coven/daemon/internal/spell"
)

// MockAgentRunner is a mock implementation for testing.
type MockAgentRunner struct {
	// Prompt is the last prompt that was passed.
	Prompt string
	// WorkDir is the last working directory used.
	WorkDir string
	// Output is the output to return.
	Output string
	// ExitCode is the exit code to return.
	ExitCode int
	// Err is the error to return.
	Err error
	// Delay is how long to wait before returning.
	Delay time.Duration
}

func (m *MockAgentRunner) Run(ctx context.Context, workDir, prompt string) (string, int, error) {
	m.WorkDir = workDir
	m.Prompt = prompt

	if m.Delay > 0 {
		select {
		case <-time.After(m.Delay):
		case <-ctx.Done():
			return m.Output, -1, nil
		}
	}

	return m.Output, m.ExitCode, m.Err
}

func setupTestSpellLoader(t *testing.T, spells map[string]string) (*spell.Loader, string) {
	t.Helper()

	tmpDir := t.TempDir()
	spellsDir := filepath.Join(tmpDir, "spells")
	if err := os.MkdirAll(spellsDir, 0755); err != nil {
		t.Fatalf("Failed to create spells dir: %v", err)
	}

	for name, content := range spells {
		path := filepath.Join(spellsDir, name+".md")
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatalf("Failed to write spell %s: %v", name, err)
		}
	}

	return spell.NewLoader(tmpDir), tmpDir
}

func TestNewAgentExecutor(t *testing.T) {
	loader := spell.NewLoader("/tmp")
	runner := &MockAgentRunner{}
	executor := NewAgentExecutor(loader, runner)

	if executor == nil {
		t.Fatal("NewAgentExecutor() returned nil")
	}
	if executor.runner == nil {
		t.Fatal("executor.runner is nil")
	}
	if executor.spellLoader == nil {
		t.Fatal("executor.spellLoader is nil")
	}
}

func TestAgentExecutor_Execute_Success(t *testing.T) {
	loader, _ := setupTestSpellLoader(t, map[string]string{
		"implement": "Implement the feature: {{.task}}",
	})

	output := `Working on the task...

` + "```json\n" + `{
  "success": true,
  "summary": "Implemented the feature successfully",
  "outputs": {
    "files_changed": ["src/main.go"]
  }
}` + "\n```"

	runner := &MockAgentRunner{
		Output:   output,
		ExitCode: 0,
	}
	executor := NewAgentExecutor(loader, runner)

	step := &grimoire.Step{
		Name:  "implement",
		Type:  grimoire.StepTypeAgent,
		Spell: "implement",
		Input: map[string]string{
			"task": "Add login feature",
		},
		Output: "result",
	}
	stepCtx := NewStepContext("/worktree", "bead-123", "wf-456")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if !result.Success {
		t.Error("Expected success")
	}
	if result.ExitCode != 0 {
		t.Errorf("ExitCode = %d, want 0", result.ExitCode)
	}
	if result.Action != ActionContinue {
		t.Errorf("Action = %q, want %q", result.Action, ActionContinue)
	}

	// Check that prompt was rendered
	if !strings.Contains(runner.Prompt, "Add login feature") {
		t.Errorf("Prompt should contain rendered input, got: %s", runner.Prompt)
	}

	// Check that output was stored in context
	storedOutput := stepCtx.GetVariable("result")
	if storedOutput == nil {
		t.Fatal("Output should be stored in context")
	}
	agentOutput, ok := storedOutput.(*AgentOutput)
	if !ok {
		t.Fatalf("Stored output should be *AgentOutput, got %T", storedOutput)
	}
	if agentOutput.Summary != "Implemented the feature successfully" {
		t.Errorf("Summary = %q, want %q", agentOutput.Summary, "Implemented the feature successfully")
	}
}

func TestAgentExecutor_Execute_InlineSpell(t *testing.T) {
	loader := spell.NewLoader(t.TempDir())
	runner := &MockAgentRunner{
		Output: `{"success": true, "summary": "done"}`,
	}
	executor := NewAgentExecutor(loader, runner)

	step := &grimoire.Step{
		Name: "quick-fix",
		Type: grimoire.StepTypeAgent,
		Spell: `Fix the issue:
{{.error_message}}
`,
		Input: map[string]string{
			"error_message": "undefined variable",
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

	// Check that inline spell was used
	if !strings.Contains(runner.Prompt, "Fix the issue:") {
		t.Error("Prompt should contain inline spell content")
	}
	if !strings.Contains(runner.Prompt, "undefined variable") {
		t.Error("Prompt should contain rendered input")
	}
}

func TestAgentExecutor_Execute_Failure(t *testing.T) {
	loader, _ := setupTestSpellLoader(t, map[string]string{
		"test": "Run tests",
	})

	output := `{"success": false, "summary": "Tests failed", "error": "3 tests failed"}`
	runner := &MockAgentRunner{
		Output:   output,
		ExitCode: 0,
	}
	executor := NewAgentExecutor(loader, runner)

	step := &grimoire.Step{
		Name:  "test",
		Type:  grimoire.StepTypeAgent,
		Spell: "test",
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if result.Success {
		t.Error("Expected failure")
	}
	if result.Action != ActionFail {
		t.Errorf("Action = %q, want %q", result.Action, ActionFail)
	}
}

func TestAgentExecutor_Execute_Timeout(t *testing.T) {
	loader, _ := setupTestSpellLoader(t, map[string]string{
		"slow": "Do something slow",
	})

	runner := &MockAgentRunner{
		Delay: 5 * time.Second,
	}
	executor := NewAgentExecutor(loader, runner)

	step := &grimoire.Step{
		Name:    "slow",
		Type:    grimoire.StepTypeAgent,
		Spell:   "slow",
		Timeout: "100ms",
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
}

func TestAgentExecutor_Execute_MissingSpell(t *testing.T) {
	loader := spell.NewLoader(t.TempDir())
	runner := &MockAgentRunner{}
	executor := NewAgentExecutor(loader, runner)

	step := &grimoire.Step{
		Name:  "test",
		Type:  grimoire.StepTypeAgent,
		Spell: "nonexistent",
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	_, err := executor.Execute(context.Background(), step, stepCtx)
	if err == nil {
		t.Fatal("Execute() should return error for missing spell")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("Error should mention not found, got: %q", err.Error())
	}
}

func TestAgentExecutor_Execute_WrongStepType(t *testing.T) {
	loader := spell.NewLoader(t.TempDir())
	runner := &MockAgentRunner{}
	executor := NewAgentExecutor(loader, runner)

	step := &grimoire.Step{
		Name: "test",
		Type: grimoire.StepTypeScript,
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	_, err := executor.Execute(context.Background(), step, stepCtx)
	if err == nil {
		t.Fatal("Execute() should return error for wrong step type")
	}
}

func TestAgentExecutor_Execute_NoSpell(t *testing.T) {
	loader := spell.NewLoader(t.TempDir())
	runner := &MockAgentRunner{}
	executor := NewAgentExecutor(loader, runner)

	step := &grimoire.Step{
		Name: "test",
		Type: grimoire.StepTypeAgent,
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	_, err := executor.Execute(context.Background(), step, stepCtx)
	if err == nil {
		t.Fatal("Execute() should return error for no spell")
	}
}

func TestAgentExecutor_Execute_WorkDir(t *testing.T) {
	loader, _ := setupTestSpellLoader(t, map[string]string{
		"test": "Test",
	})

	runner := &MockAgentRunner{
		Output: `{"success": true, "summary": "done"}`,
	}
	executor := NewAgentExecutor(loader, runner)

	step := &grimoire.Step{
		Name:  "test",
		Type:  grimoire.StepTypeAgent,
		Spell: "test",
	}
	stepCtx := NewStepContext("/expected/worktree", "bead", "wf")

	_, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if runner.WorkDir != "/expected/worktree" {
		t.Errorf("WorkDir = %q, want %q", runner.WorkDir, "/expected/worktree")
	}
}

func TestParseAgentOutput(t *testing.T) {
	executor := &AgentExecutor{}

	tests := []struct {
		name     string
		output   string
		success  bool
		summary  string
		hasError bool
	}{
		{
			name: "json code block",
			output: "Working...\n```json\n" + `{
  "success": true,
  "summary": "Done"
}` + "\n```\n",
			success: true,
			summary: "Done",
		},
		{
			name:    "plain json",
			output:  `Some text {"success": false, "summary": "Failed", "error": "reason"}`,
			success: false,
			summary: "Failed",
		},
		{
			name: "multiple json blocks",
			output: `{"success": true, "summary": "first"}
Some text
` + "```json\n" + `{"success": false, "summary": "last"}` + "\n```",
			success: false,
			summary: "last", // Last block wins
		},
		{
			name:    "no json",
			output:  "Just plain text output",
			success: false,
			summary: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := executor.parseAgentOutput(tt.output)

			if tt.summary == "" {
				if result != nil {
					t.Error("Expected nil result for no valid JSON")
				}
				return
			}

			if result == nil {
				t.Fatal("Expected non-nil result")
			}
			if result.Success != tt.success {
				t.Errorf("Success = %v, want %v", result.Success, tt.success)
			}
			if result.Summary != tt.summary {
				t.Errorf("Summary = %q, want %q", result.Summary, tt.summary)
			}
		})
	}
}

func TestExtractJSONBlocks(t *testing.T) {
	tests := []struct {
		name     string
		output   string
		expected int
	}{
		{
			name:     "single code block",
			output:   "```json\n{\"key\": \"value\"}\n```",
			expected: 1,
		},
		{
			name:     "multiple code blocks",
			output:   "```json\n{\"a\": 1}\n```\n\n```json\n{\"b\": 2}\n```",
			expected: 2,
		},
		{
			name:     "plain json object",
			output:   "Result: {\"success\": true}",
			expected: 1,
		},
		{
			name:     "no json",
			output:   "Just plain text",
			expected: 0,
		},
		{
			name:     "code block without json label",
			output:   "```\n{\"key\": \"value\"}\n```",
			expected: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			blocks := extractJSONBlocks(tt.output)
			if len(blocks) != tt.expected {
				t.Errorf("extractJSONBlocks() returned %d blocks, want %d", len(blocks), tt.expected)
			}
		})
	}
}

func TestIsInlineSpell(t *testing.T) {
	tests := []struct {
		name     string
		spell    string
		expected bool
	}{
		{
			name:     "file reference",
			spell:    "implement",
			expected: false,
		},
		{
			name:     "inline spell",
			spell:    "Do this:\n{{.task}}",
			expected: true,
		},
		{
			name:     "multiline inline",
			spell:    "Line 1\nLine 2\nLine 3",
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsInlineSpell(tt.spell); got != tt.expected {
				t.Errorf("IsInlineSpell(%q) = %v, want %v", tt.spell, got, tt.expected)
			}
		})
	}
}

func TestAgentOutput_JSON(t *testing.T) {
	output := &AgentOutput{
		Success: true,
		Summary: "Completed task",
		Outputs: map[string]interface{}{
			"files_changed": []string{"a.go", "b.go"},
		},
	}

	data, err := json.Marshal(output)
	if err != nil {
		t.Fatalf("Marshal error: %v", err)
	}

	var decoded AgentOutput
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal error: %v", err)
	}

	if decoded.Success != output.Success {
		t.Errorf("Success = %v, want %v", decoded.Success, output.Success)
	}
	if decoded.Summary != output.Summary {
		t.Errorf("Summary = %q, want %q", decoded.Summary, output.Summary)
	}
}

func TestAgentExecutor_Execute_NestedInputVariables(t *testing.T) {
	loader, _ := setupTestSpellLoader(t, map[string]string{
		"review": "Review findings: {{.findings}}",
	})

	runner := &MockAgentRunner{
		Output: `{"success": true, "summary": "reviewed"}`,
	}
	executor := NewAgentExecutor(loader, runner)

	step := &grimoire.Step{
		Name:  "review",
		Type:  grimoire.StepTypeAgent,
		Spell: "review",
		Input: map[string]string{
			"findings": "{{.previous.output}}",
		},
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")
	stepCtx.SetVariable("previous", map[string]interface{}{
		"output": "Found 3 issues",
	})

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if !result.Success {
		t.Error("Expected success")
	}

	// Check that nested variable was resolved
	if !strings.Contains(runner.Prompt, "Found 3 issues") {
		t.Errorf("Prompt should contain resolved nested variable, got: %s", runner.Prompt)
	}
}
