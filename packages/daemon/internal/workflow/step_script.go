package workflow

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/coven/daemon/internal/grimoire"
)

// CommandRunner executes shell commands.
// This interface allows for mocking in tests.
type CommandRunner interface {
	Run(ctx context.Context, workDir, command string) (stdout, stderr string, exitCode int, err error)
}

// DefaultCommandRunner is the default implementation using exec.Command.
type DefaultCommandRunner struct{}

// Run executes a shell command and returns its output.
func (r *DefaultCommandRunner) Run(ctx context.Context, workDir, command string) (stdout, stderr string, exitCode int, err error) {
	cmd := exec.CommandContext(ctx, "sh", "-c", command)
	cmd.Dir = workDir

	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	err = cmd.Run()

	stdout = stdoutBuf.String()
	stderr = stderrBuf.String()

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
			err = nil // Non-zero exit is not an error, just a failure
		} else {
			exitCode = -1
		}
	} else {
		exitCode = 0
	}

	return stdout, stderr, exitCode, err
}

// ScriptExecutor executes script steps.
type ScriptExecutor struct {
	runner CommandRunner
}

// NewScriptExecutor creates a new script executor.
func NewScriptExecutor() *ScriptExecutor {
	return &ScriptExecutor{
		runner: &DefaultCommandRunner{},
	}
}

// NewScriptExecutorWithRunner creates a script executor with a custom command runner.
// This is useful for testing.
func NewScriptExecutorWithRunner(runner CommandRunner) *ScriptExecutor {
	return &ScriptExecutor{
		runner: runner,
	}
}

// Execute runs a script step and returns the result.
func (e *ScriptExecutor) Execute(ctx context.Context, step *grimoire.Step, stepCtx *StepContext) (*StepResult, error) {
	if step.Type != grimoire.StepTypeScript {
		return nil, fmt.Errorf("expected script step, got %s", step.Type)
	}

	if step.Command == "" {
		return nil, fmt.Errorf("script step %q has no command", step.Name)
	}

	// Get timeout
	timeout, err := step.GetTimeout()
	if err != nil {
		return nil, fmt.Errorf("invalid timeout: %w", err)
	}

	// Create context with timeout
	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// Render command with variable substitution and escaping
	command, err := RenderCommand(step.Command, stepCtx.Variables)
	if err != nil {
		return nil, fmt.Errorf("failed to render command: %w", err)
	}

	// Execute the command
	start := time.Now()
	stdout, stderr, exitCode, err := e.runner.Run(execCtx, stepCtx.WorktreePath, command)
	duration := time.Since(start)

	// Check for timeout
	if execCtx.Err() == context.DeadlineExceeded {
		return &StepResult{
			Success:  false,
			Output:   combineOutput(stdout, stderr),
			ExitCode: -1,
			Error:    fmt.Sprintf("step timed out after %s", timeout),
			Duration: duration,
			Action:   ActionFail,
		}, nil
	}

	// Check for execution error (not exit code error)
	if err != nil {
		return &StepResult{
			Success:  false,
			Output:   combineOutput(stdout, stderr),
			ExitCode: exitCode,
			Error:    fmt.Sprintf("failed to execute command: %v", err),
			Duration: duration,
			Action:   ActionFail,
		}, nil
	}

	// Determine success based on exit code
	success := exitCode == 0

	// Determine action based on success and handlers
	action := e.determineAction(success, step)

	return &StepResult{
		Success:  success,
		Output:   combineOutput(stdout, stderr),
		ExitCode: exitCode,
		Duration: duration,
		Action:   action,
	}, nil
}

// determineAction determines the workflow action based on step outcome and handlers.
func (e *ScriptExecutor) determineAction(success bool, step *grimoire.Step) StepAction {
	if success {
		// Handle on_success
		switch step.OnSuccess {
		case "exit_loop":
			return ActionExitLoop
		default:
			return ActionContinue
		}
	}

	// Handle on_fail
	switch step.OnFail {
	case "continue":
		return ActionContinue
	case "block":
		return ActionBlock
	case "exit", "fail":
		return ActionFail
	default:
		// Default behavior: fail on error
		return ActionFail
	}
}

// combineOutput combines stdout and stderr into a single string.
func combineOutput(stdout, stderr string) string {
	stdout = strings.TrimSpace(stdout)
	stderr = strings.TrimSpace(stderr)

	if stderr == "" {
		return stdout
	}
	if stdout == "" {
		return stderr
	}
	return stdout + "\n" + stderr
}

// RenderCommand renders a command template with variable substitution.
// Variables are shell-escaped to prevent command injection.
func RenderCommand(command string, variables map[string]interface{}) (string, error) {
	result := command

	// Find all {{.variable}} patterns and replace them
	for {
		start := strings.Index(result, "{{")
		if start == -1 {
			break
		}

		end := strings.Index(result[start:], "}}")
		if end == -1 {
			return "", fmt.Errorf("unclosed template tag at position %d", start)
		}
		end += start + 2

		// Extract the variable path
		varPath := strings.TrimSpace(result[start+2 : end-2])
		if !strings.HasPrefix(varPath, ".") {
			// Not a variable reference, skip
			result = result[:start] + result[end:]
			continue
		}

		// Remove leading dot
		varPath = varPath[1:]

		// Resolve the variable
		value, err := resolveVariable(varPath, variables)
		if err != nil {
			return "", fmt.Errorf("failed to resolve variable %q: %w", varPath, err)
		}

		// Convert to string and shell-escape
		strValue := fmt.Sprint(value)
		escaped := ShellEscape(strValue)

		// Replace in result
		result = result[:start] + escaped + result[end:]
	}

	return result, nil
}

// resolveVariable resolves a dot-separated variable path.
func resolveVariable(path string, variables map[string]interface{}) (interface{}, error) {
	parts := strings.Split(path, ".")
	var current interface{} = variables

	for _, part := range parts {
		switch v := current.(type) {
		case map[string]interface{}:
			var ok bool
			current, ok = v[part]
			if !ok {
				return "", nil // Missing variables become empty string
			}
		case map[string]string:
			val, ok := v[part]
			if !ok {
				return "", nil
			}
			current = val
		default:
			return "", nil
		}
	}

	return current, nil
}

// ShellEscape escapes a string for safe use in shell commands.
// Uses single-quote wrapping with proper escaping of internal single quotes.
func ShellEscape(s string) string {
	// If the string is empty, return empty quotes
	if s == "" {
		return "''"
	}

	// If string contains no special characters, it's safe to use as-is
	if isShellSafe(s) {
		return s
	}

	// Use single-quote escaping
	// Replace ' with '\'' (end quote, escaped quote, start quote)
	escaped := strings.ReplaceAll(s, "'", "'\\''")
	return "'" + escaped + "'"
}

// isShellSafe checks if a string is safe to use in a shell command without escaping.
func isShellSafe(s string) bool {
	for _, c := range s {
		if !isShellSafeChar(c) {
			return false
		}
	}
	return true
}

// isShellSafeChar checks if a character is safe in shell context.
func isShellSafeChar(c rune) bool {
	// Alphanumeric characters are safe
	if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
		return true
	}
	// Some punctuation is safe
	switch c {
	case '-', '_', '.', '/':
		return true
	}
	return false
}
