package scheduler

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"time"

	"github.com/coven/daemon/internal/agent"
	"github.com/coven/daemon/internal/workflow"
)

// ProcessAgentRunner adapts agent.ProcessManager to workflow.AgentRunner.
// This allows the workflow engine to spawn agents through the existing process management.
type ProcessAgentRunner struct {
	processManager *agent.ProcessManager
	command        string
	args           []string
	currentTaskID  string
	stepCounter    uint64
}

// NewProcessAgentRunner creates a new ProcessAgentRunner.
func NewProcessAgentRunner(pm *agent.ProcessManager, cmd string, args []string) *ProcessAgentRunner {
	return &ProcessAgentRunner{
		processManager: pm,
		command:        cmd,
		args:           args,
	}
}

// SetTaskID sets the task ID for the current workflow execution.
// This is used to correlate agent runs with tasks.
func (r *ProcessAgentRunner) SetTaskID(taskID string) {
	r.currentTaskID = taskID
	r.stepCounter = 0
}

// SetCommand updates the agent command configuration.
func (r *ProcessAgentRunner) SetCommand(cmd string, args []string) {
	r.command = cmd
	r.args = args
}

// Run implements workflow.AgentRunner.
// It spawns an agent process with the given prompt and waits for completion.
// If onSpawn is provided, it's called immediately after spawn with the stepTaskID.
func (r *ProcessAgentRunner) Run(ctx context.Context, workDir, prompt string, onSpawn func(stepTaskID string)) (*workflow.AgentRunResult, error) {
	// Build args with prompt
	args := append([]string{}, r.args...)
	args = append(args, prompt)

	// Create a unique task ID for this step
	// Using task ID + step counter to avoid conflicts when a workflow has multiple agent steps
	stepNum := atomic.AddUint64(&r.stepCounter, 1)
	taskID := r.currentTaskID
	if taskID == "" {
		taskID = fmt.Sprintf("workflow-%d", time.Now().UnixNano())
	}
	stepTaskID := fmt.Sprintf("%s-step-%d", taskID, stepNum)

	// Spawn the agent
	_, spawnErr := r.processManager.Spawn(ctx, agent.SpawnConfig{
		TaskID:     stepTaskID,
		Command:    r.command,
		Args:       args,
		WorkingDir: workDir,
	})
	if spawnErr != nil {
		return nil, spawnErr
	}

	// Call onSpawn callback immediately after spawn so caller can save state
	if onSpawn != nil {
		onSpawn(stepTaskID)
	}

	// Wait for completion
	return r.waitForProcess(ctx, stepTaskID)
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
