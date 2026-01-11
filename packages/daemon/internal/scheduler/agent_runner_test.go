package scheduler

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coven/daemon/internal/agent"
	"github.com/coven/daemon/internal/logging"
	"github.com/coven/daemon/internal/workflow"
)

func newTestProcessManager(t *testing.T) *agent.ProcessManager {
	t.Helper()

	logPath := filepath.Join(t.TempDir(), "test.log")
	logger, err := logging.New(logPath)
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}
	t.Cleanup(func() { logger.Close() })

	return agent.NewProcessManager(logger)
}

func TestNewProcessAgentRunner(t *testing.T) {
	pm := newTestProcessManager(t)
	cmd := "echo"
	args := []string{"-n"}

	runner := NewProcessAgentRunner(pm, cmd, args)

	if runner == nil {
		t.Fatal("NewProcessAgentRunner() returned nil")
	}
	if runner.processManager != pm {
		t.Error("processManager not set correctly")
	}
	if runner.command != cmd {
		t.Errorf("command = %q, want %q", runner.command, cmd)
	}
	if len(runner.args) != len(args) {
		t.Errorf("args length = %d, want %d", len(runner.args), len(args))
	}
}

func TestProcessAgentRunner_SetTaskID(t *testing.T) {
	pm := newTestProcessManager(t)
	runner := NewProcessAgentRunner(pm, "echo", nil)

	// Initially empty
	if runner.currentTaskID != "" {
		t.Errorf("initial currentTaskID = %q, want empty", runner.currentTaskID)
	}
	if runner.stepCounter != 0 {
		t.Errorf("initial stepCounter = %d, want 0", runner.stepCounter)
	}

	// Set task ID
	runner.SetTaskID("task-123")
	if runner.currentTaskID != "task-123" {
		t.Errorf("currentTaskID = %q, want %q", runner.currentTaskID, "task-123")
	}
	if runner.stepCounter != 0 {
		t.Errorf("stepCounter = %d, want 0 (should reset)", runner.stepCounter)
	}

	// Simulate incrementing step counter (manually since we'd need to run)
	runner.stepCounter = 5

	// Set new task ID - should reset counter
	runner.SetTaskID("task-456")
	if runner.currentTaskID != "task-456" {
		t.Errorf("currentTaskID = %q, want %q", runner.currentTaskID, "task-456")
	}
	if runner.stepCounter != 0 {
		t.Errorf("stepCounter = %d, want 0 after SetTaskID", runner.stepCounter)
	}
}

func TestProcessAgentRunner_SetCommand(t *testing.T) {
	pm := newTestProcessManager(t)
	runner := NewProcessAgentRunner(pm, "echo", []string{"-n"})

	// Verify initial values
	if runner.command != "echo" {
		t.Errorf("initial command = %q, want %q", runner.command, "echo")
	}

	// Set new command
	runner.SetCommand("cat", []string{"-A"})
	if runner.command != "cat" {
		t.Errorf("command = %q, want %q", runner.command, "cat")
	}
	if len(runner.args) != 1 || runner.args[0] != "-A" {
		t.Errorf("args = %v, want [%q]", runner.args, "-A")
	}
}

func TestProcessAgentRunner_Run_Success(t *testing.T) {
	pm := newTestProcessManager(t)
	runner := NewProcessAgentRunner(pm, "echo", nil)
	runner.SetTaskID("run-success-test")

	workDir := t.TempDir()
	ctx := context.Background()

	result, err := runner.Run(ctx, workDir, "hello world", nil)

	if err != nil {
		t.Fatalf("Run() error: %v", err)
	}
	if result.ExitCode != 0 {
		t.Errorf("exitCode = %d, want 0", result.ExitCode)
	}
	if !strings.Contains(result.Output, "hello world") {
		t.Errorf("output = %q, should contain %q", result.Output, "hello world")
	}
	if result.StepTaskID == "" {
		t.Error("StepTaskID should not be empty")
	}
}

func TestProcessAgentRunner_Run_WithArgs(t *testing.T) {
	pm := newTestProcessManager(t)
	// Use -n flag to suppress newline
	runner := NewProcessAgentRunner(pm, "echo", []string{"-n"})
	runner.SetTaskID("run-args-test")

	workDir := t.TempDir()
	ctx := context.Background()

	result, err := runner.Run(ctx, workDir, "test", nil)

	if err != nil {
		t.Fatalf("Run() error: %v", err)
	}
	if result.ExitCode != 0 {
		t.Errorf("exitCode = %d, want 0", result.ExitCode)
	}
	// With -n, output should be "test" without newline
	if result.Output != "test" {
		t.Errorf("output = %q, want %q", result.Output, "test")
	}
}

func TestProcessAgentRunner_Run_ContextCancellation(t *testing.T) {
	pm := newTestProcessManager(t)
	// Use sleep to create a long-running process
	runner := NewProcessAgentRunner(pm, "sleep", nil)
	runner.SetTaskID("cancel-test")

	workDir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	_, err := runner.Run(ctx, workDir, "10", nil) // sleep 10 seconds

	if err == nil {
		t.Error("Expected error from cancelled context")
	}
	if err != context.DeadlineExceeded {
		t.Errorf("error = %v, want context.DeadlineExceeded", err)
	}
}

func TestProcessAgentRunner_Run_CommandFailure(t *testing.T) {
	pm := newTestProcessManager(t)
	// Use false command which always exits with code 1
	runner := NewProcessAgentRunner(pm, "false", nil)
	runner.SetTaskID("fail-test")

	workDir := t.TempDir()
	ctx := context.Background()

	result, err := runner.Run(ctx, workDir, "", nil)

	if err != nil {
		t.Fatalf("Run() error: %v (expected nil error with non-zero exit)", err)
	}
	if result.ExitCode == 0 {
		t.Error("Expected non-zero exit code from 'false' command")
	}
}

func TestProcessAgentRunner_Run_IncrementingStepCounter(t *testing.T) {
	pm := newTestProcessManager(t)
	runner := NewProcessAgentRunner(pm, "echo", nil)
	runner.SetTaskID("step-counter-test")

	workDir := t.TempDir()
	ctx := context.Background()

	// Run multiple times and verify step counter increments
	for i := 1; i <= 3; i++ {
		_, err := runner.Run(ctx, workDir, "step", nil)
		if err != nil {
			t.Fatalf("Run() iteration %d error: %v", i, err)
		}

		if runner.stepCounter != uint64(i) {
			t.Errorf("After %d runs, stepCounter = %d, want %d", i, runner.stepCounter, i)
		}
	}
}

func TestProcessAgentRunner_Run_NoTaskID(t *testing.T) {
	pm := newTestProcessManager(t)
	runner := NewProcessAgentRunner(pm, "echo", nil)
	// Don't set task ID - should generate one

	workDir := t.TempDir()
	ctx := context.Background()

	result, err := runner.Run(ctx, workDir, "no-task-id", nil)

	if err != nil {
		t.Fatalf("Run() error: %v", err)
	}
	if result.ExitCode != 0 {
		t.Errorf("exitCode = %d, want 0", result.ExitCode)
	}
	if !strings.Contains(result.Output, "no-task-id") {
		t.Errorf("output = %q, should contain %q", result.Output, "no-task-id")
	}
}

func TestProcessAgentRunner_Run_NonexistentCommand(t *testing.T) {
	pm := newTestProcessManager(t)
	runner := NewProcessAgentRunner(pm, "this-command-does-not-exist-12345", nil)
	runner.SetTaskID("nonexistent-test")

	workDir := t.TempDir()
	ctx := context.Background()

	_, err := runner.Run(ctx, workDir, "test", nil)

	if err == nil {
		t.Error("Expected error for nonexistent command")
	}
}

func TestProcessAgentRunner_InterfaceCompliance(t *testing.T) {
	// This test verifies the runner implements workflow.AgentRunner
	// The var _ check in the source file already verifies this,
	// but we include this test for documentation.
	pm := newTestProcessManager(t)
	var runner any = NewProcessAgentRunner(pm, "echo", nil)

	if _, ok := runner.(workflow.AgentRunner); !ok {
		t.Error("ProcessAgentRunner does not implement workflow.AgentRunner")
	}
}
