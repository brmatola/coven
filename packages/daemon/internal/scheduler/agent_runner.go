package scheduler

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/coven/daemon/internal/agent"
	"github.com/coven/daemon/internal/workflow"
)

// ProcessAgentRunner adapts agent.ProcessManager to workflow.AgentRunner.
// This allows the workflow engine to spawn agents through the existing process management.
// It is thread-safe and supports concurrent workflows.
type ProcessAgentRunner struct {
	processManager *agent.ProcessManager
	command        string
	args           []string

	// Per-task step counters for concurrent workflow support
	mu           sync.Mutex
	stepCounters map[string]uint64

	// onProcessSpawn is called when a process is spawned with its step task ID and PID.
	onProcessSpawn func(mainTaskID, stepTaskID string, pid int)
}

// NewProcessAgentRunner creates a new ProcessAgentRunner.
func NewProcessAgentRunner(pm *agent.ProcessManager, cmd string, args []string) *ProcessAgentRunner {
	return &ProcessAgentRunner{
		processManager: pm,
		command:        cmd,
		args:           args,
		stepCounters:   make(map[string]uint64),
	}
}

// SetTaskID is a no-op for compatibility.
// Step counting is now done per-task using the workDir parameter in Run().
// Deprecated: This method does nothing and will be removed in a future version.
func (r *ProcessAgentRunner) SetTaskID(taskID string) {
	// No-op - we now use per-task step counting based on workDir
}

// SetCommand updates the agent command configuration.
func (r *ProcessAgentRunner) SetCommand(cmd string, args []string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.command = cmd
	r.args = args
}

// OnProcessSpawn sets a callback that's invoked when a process is spawned.
// The callback receives the main task ID (e.g., "coven-7ub"), the step task ID
// (e.g., "coven-7ub-step-1"), and the process PID.
func (r *ProcessAgentRunner) OnProcessSpawn(fn func(mainTaskID, stepTaskID string, pid int)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.onProcessSpawn = fn
}

// getNextStepID atomically increments and returns the next step number for a task.
func (r *ProcessAgentRunner) getNextStepID(taskID string) uint64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.stepCounters[taskID]++
	return r.stepCounters[taskID]
}

// Run implements workflow.AgentRunner.
// It spawns an agent process with the given prompt and waits for completion.
// If onSpawn is provided, it's called immediately after spawn with the stepTaskID.
func (r *ProcessAgentRunner) Run(ctx context.Context, workDir, prompt string, onSpawn func(stepTaskID string)) (*workflow.AgentRunResult, error) {
	// Build args with prompt
	r.mu.Lock()
	args := append([]string{}, r.args...)
	command := r.command
	onProcessSpawn := r.onProcessSpawn
	r.mu.Unlock()
	args = append(args, prompt)

	// Extract task ID from workDir (worktree path ends with task ID)
	// e.g., /path/to/.coven/worktrees/coven-7ub -> coven-7ub
	taskID := extractTaskIDFromPath(workDir)
	if taskID == "" {
		taskID = fmt.Sprintf("workflow-%d", time.Now().UnixNano())
	}

	// Create a unique task ID for this step using per-task step counter
	stepNum := r.getNextStepID(taskID)
	stepTaskID := fmt.Sprintf("%s-step-%d", taskID, stepNum)

	// Check if we should close stdin (for non-interactive agents like claude -p)
	closeStdin := false
	for _, arg := range args {
		if arg == "-p" || arg == "--print" {
			closeStdin = true
			break
		}
	}

	// Spawn the agent
	processInfo, spawnErr := r.processManager.Spawn(ctx, agent.SpawnConfig{
		TaskID:     stepTaskID,
		Command:    command,
		Args:       args,
		WorkingDir: workDir,
		CloseStdin: closeStdin,
	})
	if spawnErr != nil {
		return nil, spawnErr
	}

	// Notify about process spawn with PID
	if onProcessSpawn != nil {
		onProcessSpawn(taskID, stepTaskID, processInfo.PID)
	}

	// Call onSpawn callback immediately after spawn so caller can save state
	if onSpawn != nil {
		onSpawn(stepTaskID)
	}

	// Wait for completion
	return r.waitForProcess(ctx, stepTaskID)
}

// extractTaskIDFromPath extracts the task ID from a worktree path.
// Worktree paths are expected to end with the task ID (e.g., /path/to/worktrees/task-123).
func extractTaskIDFromPath(path string) string {
	// Find the last path separator
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			return path[i+1:]
		}
	}
	return path
}

// WaitForExisting waits for an existing agent process to complete.
// Used when resuming a workflow where an agent step was already running.
func (r *ProcessAgentRunner) WaitForExisting(ctx context.Context, stepTaskID string) (*workflow.AgentRunResult, error) {
	// Check if the process exists
	if !r.processManager.IsRunning(stepTaskID) {
		return nil, nil // Process doesn't exist or already completed
	}

	return r.waitForProcess(ctx, stepTaskID)
}

// IsRunning checks if a process with the given task ID is currently running.
func (r *ProcessAgentRunner) IsRunning(stepTaskID string) bool {
	return r.processManager.IsRunning(stepTaskID)
}

// waitForProcess waits for a process to complete and returns the result.
func (r *ProcessAgentRunner) waitForProcess(ctx context.Context, stepTaskID string) (*workflow.AgentRunResult, error) {
	// Use a goroutine to handle context cancellation
	resultCh := make(chan *agent.ProcessResult, 1)
	errCh := make(chan error, 1)

	go func() {
		result, waitErr := r.processManager.WaitForCompletion(stepTaskID)
		if waitErr != nil {
			errCh <- waitErr
			return
		}
		resultCh <- result
	}()

	// Wait for either completion or context cancellation
	select {
	case <-ctx.Done():
		// Context cancelled - kill the agent
		r.processManager.Kill(stepTaskID)
		return &workflow.AgentRunResult{StepTaskID: stepTaskID, ExitCode: -1}, ctx.Err()

	case waitErr := <-errCh:
		return &workflow.AgentRunResult{StepTaskID: stepTaskID, ExitCode: -1}, waitErr

	case result := <-resultCh:
		// Get all output
		outputLines, outputErr := r.processManager.GetOutput(stepTaskID)
		var output string
		if outputErr == nil {
			var lines []string
			for _, line := range outputLines {
				lines = append(lines, line.Data)
			}
			output = strings.Join(lines, "\n")
		}

		// Clean up the process record
		r.processManager.Cleanup(stepTaskID)

		return &workflow.AgentRunResult{
			Output:     output,
			ExitCode:   result.ExitCode,
			StepTaskID: stepTaskID,
		}, nil
	}
}

// Verify interface compliance
var _ workflow.AgentRunner = (*ProcessAgentRunner)(nil)
