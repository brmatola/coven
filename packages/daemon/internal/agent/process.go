package agent

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/coven/daemon/internal/logging"
	"github.com/coven/daemon/pkg/types"
)

const (
	// DefaultGracePeriod is the default time to wait after SIGTERM before SIGKILL.
	DefaultGracePeriod = 5 * time.Second

	// DefaultTimeout is the default agent execution timeout.
	DefaultTimeout = 30 * time.Minute
)

// ProcessInfo contains information about a running agent process.
type ProcessInfo struct {
	TaskID     string    `json:"task_id"`
	PID        int       `json:"pid"`
	StartedAt  time.Time `json:"started_at"`
	WorkingDir string    `json:"working_dir"`
	Command    string    `json:"command"`
	Args       []string  `json:"args"`
}

// ProcessResult contains the result of an agent execution.
type ProcessResult struct {
	TaskID     string        `json:"task_id"`
	ExitCode   int           `json:"exit_code"`
	Duration   time.Duration `json:"duration"`
	Error      string        `json:"error,omitempty"`
	Killed     bool          `json:"killed"`
	TimedOut   bool          `json:"timed_out"`
	FinishedAt time.Time     `json:"finished_at"`
}

// ProcessManager manages agent processes.
type ProcessManager struct {
	mu          sync.RWMutex
	processes   map[string]*runningProcess
	logger      *logging.Logger
	gracePeriod time.Duration
	timeout     time.Duration
	onComplete  func(result *ProcessResult)
	onOutput    func(taskID string, line OutputLine)
}

type runningProcess struct {
	info     ProcessInfo
	cmd      *exec.Cmd
	output   *RingBuffer
	cancel   context.CancelFunc
	doneCh   chan struct{}
	result   *ProcessResult
	timedOut bool
}

// NewProcessManager creates a new process manager.
func NewProcessManager(logger *logging.Logger) *ProcessManager {
	return &ProcessManager{
		processes:   make(map[string]*runningProcess),
		logger:      logger,
		gracePeriod: DefaultGracePeriod,
		timeout:     DefaultTimeout,
	}
}

// SetGracePeriod sets the grace period before SIGKILL.
func (m *ProcessManager) SetGracePeriod(d time.Duration) {
	m.gracePeriod = d
}

// SetTimeout sets the default execution timeout.
func (m *ProcessManager) SetTimeout(d time.Duration) {
	m.timeout = d
}

// OnComplete sets a callback for when processes complete.
func (m *ProcessManager) OnComplete(fn func(*ProcessResult)) {
	m.onComplete = fn
}

// OnOutput sets a callback for output lines.
func (m *ProcessManager) OnOutput(fn func(taskID string, line OutputLine)) {
	m.onOutput = fn
}

// SpawnConfig contains configuration for spawning an agent.
type SpawnConfig struct {
	TaskID     string
	Command    string
	Args       []string
	WorkingDir string
	Env        []string
	Timeout    time.Duration
}

// Spawn starts a new agent process.
func (m *ProcessManager) Spawn(ctx context.Context, cfg SpawnConfig) (*ProcessInfo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Check if already running
	if _, exists := m.processes[cfg.TaskID]; exists {
		return nil, fmt.Errorf("agent already running for task %s", cfg.TaskID)
	}

	// Use default timeout if not specified
	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = m.timeout
	}

	// Create context with timeout
	procCtx, cancel := context.WithTimeout(ctx, timeout)

	cmd := exec.CommandContext(procCtx, cfg.Command, cfg.Args...)
	cmd.Dir = cfg.WorkingDir
	cmd.Env = append(os.Environ(), cfg.Env...)

	// Set up process group for clean termination
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true,
	}

	// Create pipes for output capture
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	// Start the process
	if err := cmd.Start(); err != nil {
		cancel()
		return nil, fmt.Errorf("failed to start process: %w", err)
	}

	info := ProcessInfo{
		TaskID:     cfg.TaskID,
		PID:        cmd.Process.Pid,
		StartedAt:  time.Now(),
		WorkingDir: cfg.WorkingDir,
		Command:    cfg.Command,
		Args:       cfg.Args,
	}

	proc := &runningProcess{
		info:   info,
		cmd:    cmd,
		output: NewRingBuffer(DefaultMaxBufferSize),
		cancel: cancel,
		doneCh: make(chan struct{}),
	}

	m.processes[cfg.TaskID] = proc

	// Start output capture goroutines
	go m.captureOutput(cfg.TaskID, stdout, "stdout", proc)
	go m.captureOutput(cfg.TaskID, stderr, "stderr", proc)

	// Start process monitor goroutine
	go m.monitorProcess(cfg.TaskID, proc, procCtx)

	m.logger.Info("spawned agent process",
		"task_id", cfg.TaskID,
		"pid", info.PID,
		"command", cfg.Command,
		"working_dir", cfg.WorkingDir,
	)

	return &info, nil
}

func (m *ProcessManager) captureOutput(taskID string, r io.Reader, stream string, proc *runningProcess) {
	scanner := bufio.NewScanner(r)
	// Increase buffer size for long lines
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		seq := proc.output.Write(stream, line)

		if m.onOutput != nil {
			m.onOutput(taskID, OutputLine{
				Sequence:  seq,
				Timestamp: time.Now(),
				Stream:    stream,
				Data:      line,
			})
		}
	}
}

func (m *ProcessManager) monitorProcess(taskID string, proc *runningProcess, ctx context.Context) {
	defer close(proc.doneCh)

	// Wait for process to finish
	err := proc.cmd.Wait()

	result := &ProcessResult{
		TaskID:     taskID,
		FinishedAt: time.Now(),
		Duration:   time.Since(proc.info.StartedAt),
	}

	// Check if context was cancelled (timeout)
	if ctx.Err() == context.DeadlineExceeded {
		result.TimedOut = true
		result.Error = "execution timed out"
		proc.timedOut = true
	}

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			result.ExitCode = exitErr.ExitCode()
			// Check if killed by signal
			if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
				if status.Signaled() {
					result.Killed = true
				}
			}
		} else {
			result.Error = err.Error()
			result.ExitCode = -1
		}
	}

	m.mu.Lock()
	proc.result = result
	m.mu.Unlock()

	m.logger.Info("agent process finished",
		"task_id", taskID,
		"exit_code", result.ExitCode,
		"duration", result.Duration,
		"timed_out", result.TimedOut,
		"killed", result.Killed,
	)

	if m.onComplete != nil {
		m.onComplete(result)
	}
}

// Stop gracefully stops an agent process (SIGTERM then SIGKILL).
func (m *ProcessManager) Stop(taskID string) error {
	m.mu.RLock()
	proc, exists := m.processes[taskID]
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("no process found for task %s", taskID)
	}

	// Check if already done
	select {
	case <-proc.doneCh:
		return nil
	default:
	}

	// Send SIGTERM to process group
	if err := syscall.Kill(-proc.cmd.Process.Pid, syscall.SIGTERM); err != nil {
		// Process might already be dead
		if err != syscall.ESRCH {
			m.logger.Warn("failed to send SIGTERM", "task_id", taskID, "error", err)
		}
	}

	// Wait for graceful shutdown or timeout
	select {
	case <-proc.doneCh:
		m.logger.Info("agent stopped gracefully", "task_id", taskID)
		return nil
	case <-time.After(m.gracePeriod):
		// Escalate to SIGKILL
		m.logger.Warn("agent did not stop gracefully, sending SIGKILL", "task_id", taskID)
		if err := syscall.Kill(-proc.cmd.Process.Pid, syscall.SIGKILL); err != nil {
			if err != syscall.ESRCH {
				return fmt.Errorf("failed to kill process: %w", err)
			}
		}
	}

	// Wait for SIGKILL to take effect
	select {
	case <-proc.doneCh:
		return nil
	case <-time.After(time.Second):
		return fmt.Errorf("process did not terminate after SIGKILL")
	}
}

// Kill forcefully kills an agent process (SIGKILL immediately).
func (m *ProcessManager) Kill(taskID string) error {
	m.mu.RLock()
	proc, exists := m.processes[taskID]
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("no process found for task %s", taskID)
	}

	// Check if already done
	select {
	case <-proc.doneCh:
		return nil
	default:
	}

	// Send SIGKILL to process group
	if err := syscall.Kill(-proc.cmd.Process.Pid, syscall.SIGKILL); err != nil {
		if err != syscall.ESRCH {
			return fmt.Errorf("failed to kill process: %w", err)
		}
	}

	// Wait for process to die
	select {
	case <-proc.doneCh:
		return nil
	case <-time.After(time.Second):
		return fmt.Errorf("process did not terminate after SIGKILL")
	}
}

// GetOutput returns the output buffer for a task.
func (m *ProcessManager) GetOutput(taskID string) ([]OutputLine, error) {
	m.mu.RLock()
	proc, exists := m.processes[taskID]
	m.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("no process found for task %s", taskID)
	}

	return proc.output.GetAll(), nil
}

// GetOutputSince returns output lines since the given sequence.
func (m *ProcessManager) GetOutputSince(taskID string, afterSeq uint64) ([]OutputLine, error) {
	m.mu.RLock()
	proc, exists := m.processes[taskID]
	m.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("no process found for task %s", taskID)
	}

	return proc.output.GetSince(afterSeq), nil
}

// GetInfo returns information about a running process.
func (m *ProcessManager) GetInfo(taskID string) (*ProcessInfo, error) {
	m.mu.RLock()
	proc, exists := m.processes[taskID]
	m.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("no process found for task %s", taskID)
	}

	return &proc.info, nil
}

// GetResult returns the result of a completed process.
func (m *ProcessManager) GetResult(taskID string) (*ProcessResult, error) {
	m.mu.RLock()
	proc, exists := m.processes[taskID]
	m.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("no process found for task %s", taskID)
	}

	if proc.result == nil {
		return nil, fmt.Errorf("process for task %s is still running", taskID)
	}

	return proc.result, nil
}

// IsRunning checks if a process is running for the given task.
func (m *ProcessManager) IsRunning(taskID string) bool {
	m.mu.RLock()
	proc, exists := m.processes[taskID]
	m.mu.RUnlock()

	if !exists {
		return false
	}

	select {
	case <-proc.doneCh:
		return false
	default:
		return true
	}
}

// ListRunning returns task IDs of all running processes.
func (m *ProcessManager) ListRunning() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var running []string
	for taskID, proc := range m.processes {
		select {
		case <-proc.doneCh:
			// Not running
		default:
			running = append(running, taskID)
		}
	}
	return running
}

// Cleanup removes completed process records from memory.
func (m *ProcessManager) Cleanup(taskID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	proc, exists := m.processes[taskID]
	if !exists {
		return
	}

	// Only cleanup if process is done
	select {
	case <-proc.doneCh:
		delete(m.processes, taskID)
		m.logger.Debug("cleaned up process record", "task_id", taskID)
	default:
		m.logger.Warn("cannot cleanup running process", "task_id", taskID)
	}
}

// WaitForCompletion waits for a process to complete.
func (m *ProcessManager) WaitForCompletion(taskID string) (*ProcessResult, error) {
	m.mu.RLock()
	proc, exists := m.processes[taskID]
	m.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("no process found for task %s", taskID)
	}

	<-proc.doneCh

	m.mu.RLock()
	result := proc.result
	m.mu.RUnlock()

	return result, nil
}

// ToAgentStatus converts a process result to agent status.
func (r *ProcessResult) ToAgentStatus() types.AgentStatus {
	if r == nil {
		return types.AgentStatusRunning
	}

	if r.TimedOut {
		return types.AgentStatusFailed
	}

	if r.Killed {
		return types.AgentStatusKilled
	}

	if r.ExitCode == 0 {
		return types.AgentStatusCompleted
	}

	return types.AgentStatusFailed
}
