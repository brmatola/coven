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
func (r *ProcessAgentRunner) Run(ctx context.Context, workDir, prompt string) (output string, exitCode int, err error) {
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
		return "", -1, spawnErr
	}

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
		return "", -1, ctx.Err()

	case waitErr := <-errCh:
		return "", -1, waitErr

	case result := <-resultCh:
		// Get all output
		outputLines, outputErr := r.processManager.GetOutput(stepTaskID)
		if outputErr != nil {
			// Process completed but we can't get output - still return the exit code
			return "", result.ExitCode, nil
		}

		var lines []string
		for _, line := range outputLines {
			lines = append(lines, line.Data)
		}
		output = strings.Join(lines, "\n")

		// Clean up the process record
		r.processManager.Cleanup(stepTaskID)

		return output, result.ExitCode, nil
	}
}

// Verify interface compliance
var _ workflow.AgentRunner = (*ProcessAgentRunner)(nil)
