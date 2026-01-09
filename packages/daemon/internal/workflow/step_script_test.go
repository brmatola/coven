package workflow

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/coven/daemon/internal/grimoire"
)

// MockCommandRunner is a mock implementation for testing.
type MockCommandRunner struct {
	// Command is the last command that was run.
	Command string
	// WorkDir is the last working directory used.
	WorkDir string
	// Stdout is the stdout to return.
	Stdout string
	// Stderr is the stderr to return.
	Stderr string
	// ExitCode is the exit code to return.
	ExitCode int
	// Err is the error to return.
	Err error
	// Delay is how long to wait before returning.
	Delay time.Duration
}

func (m *MockCommandRunner) Run(ctx context.Context, workDir, command string) (string, string, int, error) {
	m.Command = command
	m.WorkDir = workDir

	if m.Delay > 0 {
		select {
		case <-time.After(m.Delay):
		case <-ctx.Done():
			return m.Stdout, m.Stderr, -1, nil
		}
	}

	return m.Stdout, m.Stderr, m.ExitCode, m.Err
}

func TestNewScriptExecutor(t *testing.T) {
	executor := NewScriptExecutor()
	if executor == nil {
		t.Fatal("NewScriptExecutor() returned nil")
	}
	if executor.runner == nil {
		t.Fatal("executor.runner is nil")
	}
}

func TestScriptExecutor_Execute_Success(t *testing.T) {
	mock := &MockCommandRunner{
		Stdout:   "Hello, World!",
		ExitCode: 0,
	}
	executor := NewScriptExecutorWithRunner(mock)

	step := &grimoire.Step{
		Name:    "test",
		Type:    grimoire.StepTypeScript,
		Command: "echo 'Hello, World!'",
	}
	stepCtx := NewStepContext("/path/to/worktree", "bead-123", "wf-456")

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
	if result.Output != "Hello, World!" {
		t.Errorf("Output = %q, want %q", result.Output, "Hello, World!")
	}
	if result.Action != ActionContinue {
		t.Errorf("Action = %q, want %q", result.Action, ActionContinue)
	}
}

func TestScriptExecutor_Execute_Failure(t *testing.T) {
	mock := &MockCommandRunner{
		Stderr:   "Command failed",
		ExitCode: 1,
	}
	executor := NewScriptExecutorWithRunner(mock)

	step := &grimoire.Step{
		Name:    "test",
		Type:    grimoire.StepTypeScript,
		Command: "exit 1",
	}
	stepCtx := NewStepContext("/path/to/worktree", "bead-123", "wf-456")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if result.Success {
		t.Error("Expected failure")
	}
	if result.ExitCode != 1 {
		t.Errorf("ExitCode = %d, want 1", result.ExitCode)
	}
	// Default on_fail is fail
	if result.Action != ActionFail {
		t.Errorf("Action = %q, want %q", result.Action, ActionFail)
	}
}

func TestScriptExecutor_Execute_OnFail_Continue(t *testing.T) {
	mock := &MockCommandRunner{
		ExitCode: 1,
	}
	executor := NewScriptExecutorWithRunner(mock)

	step := &grimoire.Step{
		Name:    "test",
		Type:    grimoire.StepTypeScript,
		Command: "exit 1",
		OnFail:  "continue",
	}
	stepCtx := NewStepContext("/path", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if result.Success {
		t.Error("Expected failure")
	}
	if result.Action != ActionContinue {
		t.Errorf("Action = %q, want %q", result.Action, ActionContinue)
	}
}

func TestScriptExecutor_Execute_OnFail_Block(t *testing.T) {
	mock := &MockCommandRunner{
		ExitCode: 1,
	}
	executor := NewScriptExecutorWithRunner(mock)

	step := &grimoire.Step{
		Name:    "test",
		Type:    grimoire.StepTypeScript,
		Command: "exit 1",
		OnFail:  "block",
	}
	stepCtx := NewStepContext("/path", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if result.Action != ActionBlock {
		t.Errorf("Action = %q, want %q", result.Action, ActionBlock)
	}
}

func TestScriptExecutor_Execute_OnFail_Exit(t *testing.T) {
	mock := &MockCommandRunner{
		ExitCode: 1,
	}
	executor := NewScriptExecutorWithRunner(mock)

	step := &grimoire.Step{
		Name:    "test",
		Type:    grimoire.StepTypeScript,
		Command: "exit 1",
		OnFail:  "exit",
	}
	stepCtx := NewStepContext("/path", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if result.Action != ActionFail {
		t.Errorf("Action = %q, want %q", result.Action, ActionFail)
	}
}

func TestScriptExecutor_Execute_OnSuccess_ExitLoop(t *testing.T) {
	mock := &MockCommandRunner{
		ExitCode: 0,
	}
	executor := NewScriptExecutorWithRunner(mock)

	step := &grimoire.Step{
		Name:      "test",
		Type:      grimoire.StepTypeScript,
		Command:   "echo ok",
		OnSuccess: "exit_loop",
	}
	stepCtx := NewStepContext("/path", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if !result.Success {
		t.Error("Expected success")
	}
	if result.Action != ActionExitLoop {
		t.Errorf("Action = %q, want %q", result.Action, ActionExitLoop)
	}
}

func TestScriptExecutor_Execute_Timeout(t *testing.T) {
	mock := &MockCommandRunner{
		Delay: 5 * time.Second, // Will timeout
	}
	executor := NewScriptExecutorWithRunner(mock)

	step := &grimoire.Step{
		Name:    "test",
		Type:    grimoire.StepTypeScript,
		Command: "sleep 10",
		Timeout: "100ms",
	}
	stepCtx := NewStepContext("/path", "bead", "wf")

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
	if result.Action != ActionFail {
		t.Errorf("Action = %q, want %q", result.Action, ActionFail)
	}
}

func TestScriptExecutor_Execute_WrongStepType(t *testing.T) {
	executor := NewScriptExecutor()

	step := &grimoire.Step{
		Name: "test",
		Type: grimoire.StepTypeAgent,
	}
	stepCtx := NewStepContext("/path", "bead", "wf")

	_, err := executor.Execute(context.Background(), step, stepCtx)
	if err == nil {
		t.Fatal("Execute() should return error for wrong step type")
	}
}

func TestScriptExecutor_Execute_NoCommand(t *testing.T) {
	executor := NewScriptExecutor()

	step := &grimoire.Step{
		Name: "test",
		Type: grimoire.StepTypeScript,
	}
	stepCtx := NewStepContext("/path", "bead", "wf")

	_, err := executor.Execute(context.Background(), step, stepCtx)
	if err == nil {
		t.Fatal("Execute() should return error for no command")
	}
}

func TestScriptExecutor_Execute_WorkDir(t *testing.T) {
	mock := &MockCommandRunner{}
	executor := NewScriptExecutorWithRunner(mock)

	step := &grimoire.Step{
		Name:    "test",
		Type:    grimoire.StepTypeScript,
		Command: "pwd",
	}
	stepCtx := NewStepContext("/expected/worktree/path", "bead", "wf")

	_, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if mock.WorkDir != "/expected/worktree/path" {
		t.Errorf("WorkDir = %q, want %q", mock.WorkDir, "/expected/worktree/path")
	}
}

func TestScriptExecutor_Execute_CombinesOutput(t *testing.T) {
	mock := &MockCommandRunner{
		Stdout: "stdout content",
		Stderr: "stderr content",
	}
	executor := NewScriptExecutorWithRunner(mock)

	step := &grimoire.Step{
		Name:    "test",
		Type:    grimoire.StepTypeScript,
		Command: "echo test",
	}
	stepCtx := NewStepContext("/path", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if !strings.Contains(result.Output, "stdout content") {
		t.Error("Output should contain stdout")
	}
	if !strings.Contains(result.Output, "stderr content") {
		t.Error("Output should contain stderr")
	}
}

func TestShellEscape(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "simple alphanumeric",
			input:    "hello",
			expected: "hello",
		},
		{
			name:     "with hyphen and underscore",
			input:    "hello-world_test",
			expected: "hello-world_test",
		},
		{
			name:     "with path",
			input:    "/path/to/file.txt",
			expected: "/path/to/file.txt",
		},
		{
			name:     "with spaces",
			input:    "hello world",
			expected: "'hello world'",
		},
		{
			name:     "with single quote",
			input:    "it's",
			expected: "'it'\\''s'",
		},
		{
			name:     "with semicolon (injection attempt)",
			input:    "foo; rm -rf /",
			expected: "'foo; rm -rf /'",
		},
		{
			name:     "with backticks (injection attempt)",
			input:    "$(whoami)",
			expected: "'$(whoami)'",
		},
		{
			name:     "empty string",
			input:    "",
			expected: "''",
		},
		{
			name:     "with newline",
			input:    "line1\nline2",
			expected: "'line1\nline2'",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ShellEscape(tt.input)
			if result != tt.expected {
				t.Errorf("ShellEscape(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestRenderCommand(t *testing.T) {
	tests := []struct {
		name      string
		command   string
		variables map[string]interface{}
		expected  string
		wantErr   bool
	}{
		{
			name:      "no variables",
			command:   "echo hello",
			variables: nil,
			expected:  "echo hello",
		},
		{
			name:    "simple variable",
			command: "bd close {{.bead_id}}",
			variables: map[string]interface{}{
				"bead_id": "coven-123",
			},
			expected: "bd close coven-123",
		},
		{
			name:    "nested variable",
			command: "echo {{.bead.title}}",
			variables: map[string]interface{}{
				"bead": map[string]interface{}{
					"title": "Fix bug",
				},
			},
			expected: "echo 'Fix bug'",
		},
		{
			name:    "variable with spaces (escaped)",
			command: "echo {{.message}}",
			variables: map[string]interface{}{
				"message": "hello world",
			},
			expected: "echo 'hello world'",
		},
		{
			name:    "injection attempt (escaped)",
			command: "bd close {{.id}}",
			variables: map[string]interface{}{
				"id": "foo; rm -rf /",
			},
			expected: "bd close 'foo; rm -rf /'",
		},
		{
			name:    "missing variable",
			command: "echo {{.missing}}",
			variables: map[string]interface{}{
				"other": "value",
			},
			expected: "echo ''",
		},
		{
			name:     "unclosed template",
			command:  "echo {{.broken",
			wantErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := RenderCommand(tt.command, tt.variables)
			if tt.wantErr {
				if err == nil {
					t.Error("Expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("RenderCommand() error: %v", err)
			}
			if result != tt.expected {
				t.Errorf("RenderCommand() = %q, want %q", result, tt.expected)
			}
		})
	}
}

func TestCombineOutput(t *testing.T) {
	tests := []struct {
		name     string
		stdout   string
		stderr   string
		expected string
	}{
		{
			name:     "stdout only",
			stdout:   "output",
			stderr:   "",
			expected: "output",
		},
		{
			name:     "stderr only",
			stdout:   "",
			stderr:   "error",
			expected: "error",
		},
		{
			name:     "both",
			stdout:   "output",
			stderr:   "error",
			expected: "output\nerror",
		},
		{
			name:     "both empty",
			stdout:   "",
			stderr:   "",
			expected: "",
		},
		{
			name:     "with whitespace",
			stdout:   "  output  ",
			stderr:   "  error  ",
			expected: "output\nerror",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := combineOutput(tt.stdout, tt.stderr)
			if result != tt.expected {
				t.Errorf("combineOutput(%q, %q) = %q, want %q", tt.stdout, tt.stderr, result, tt.expected)
			}
		})
	}
}

func TestDefaultCommandRunner_Run(t *testing.T) {
	runner := &DefaultCommandRunner{}

	t.Run("successful command", func(t *testing.T) {
		stdout, stderr, exitCode, err := runner.Run(context.Background(), t.TempDir(), "echo hello")
		if err != nil {
			t.Fatalf("Run() error: %v", err)
		}
		if exitCode != 0 {
			t.Errorf("exitCode = %d, want 0", exitCode)
		}
		if !strings.Contains(stdout, "hello") {
			t.Errorf("stdout = %q, want to contain 'hello'", stdout)
		}
		if stderr != "" {
			t.Errorf("stderr = %q, want empty", stderr)
		}
	})

	t.Run("failing command", func(t *testing.T) {
		_, _, exitCode, err := runner.Run(context.Background(), t.TempDir(), "exit 42")
		if err != nil {
			t.Fatalf("Run() error: %v", err)
		}
		if exitCode != 42 {
			t.Errorf("exitCode = %d, want 42", exitCode)
		}
	})

	t.Run("stderr output", func(t *testing.T) {
		_, stderr, _, err := runner.Run(context.Background(), t.TempDir(), "echo error >&2")
		if err != nil {
			t.Fatalf("Run() error: %v", err)
		}
		if !strings.Contains(stderr, "error") {
			t.Errorf("stderr = %q, want to contain 'error'", stderr)
		}
	})

	t.Run("working directory", func(t *testing.T) {
		tmpDir := t.TempDir()
		stdout, _, _, err := runner.Run(context.Background(), tmpDir, "pwd")
		if err != nil {
			t.Fatalf("Run() error: %v", err)
		}
		if !strings.Contains(stdout, tmpDir) {
			t.Errorf("stdout = %q, want to contain %q", stdout, tmpDir)
		}
	})
}

func TestScriptExecutor_Execute_InvalidTimeout(t *testing.T) {
	mock := &MockCommandRunner{}
	executor := NewScriptExecutorWithRunner(mock)

	step := &grimoire.Step{
		Name:    "test",
		Type:    grimoire.StepTypeScript,
		Command: "echo test",
		Timeout: "invalid",
	}
	stepCtx := NewStepContext("/path", "bead", "wf")

	_, err := executor.Execute(context.Background(), step, stepCtx)
	if err == nil {
		t.Fatal("Execute() should return error for invalid timeout")
	}
}

func TestIsShellSafeChar(t *testing.T) {
	tests := []struct {
		char rune
		safe bool
	}{
		{'a', true},
		{'z', true},
		{'A', true},
		{'Z', true},
		{'0', true},
		{'9', true},
		{'-', true},
		{'_', true},
		{'.', true},
		{'/', true},
		{' ', false},
		{';', false},
		{'|', false},
		{'&', false},
		{'$', false},
		{'`', false},
	}

	for _, tt := range tests {
		t.Run(string(tt.char), func(t *testing.T) {
			if got := isShellSafeChar(tt.char); got != tt.safe {
				t.Errorf("isShellSafeChar(%q) = %v, want %v", tt.char, got, tt.safe)
			}
		})
	}
}

func TestResolveVariable(t *testing.T) {
	variables := map[string]interface{}{
		"simple": "value",
		"nested": map[string]interface{}{
			"deep": map[string]interface{}{
				"value": "found",
			},
		},
		"string_map": map[string]string{
			"key": "string_value",
		},
	}

	tests := []struct {
		name     string
		path     string
		expected interface{}
	}{
		{
			name:     "simple",
			path:     "simple",
			expected: "value",
		},
		{
			name:     "nested",
			path:     "nested.deep.value",
			expected: "found",
		},
		{
			name:     "string map",
			path:     "string_map.key",
			expected: "string_value",
		},
		{
			name:     "missing",
			path:     "missing",
			expected: "",
		},
		{
			name:     "missing nested",
			path:     "nested.missing.value",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := resolveVariable(tt.path, variables)
			if err != nil {
				t.Fatalf("resolveVariable() error: %v", err)
			}
			if result != tt.expected {
				t.Errorf("resolveVariable(%q) = %v, want %v", tt.path, result, tt.expected)
			}
		})
	}
}
