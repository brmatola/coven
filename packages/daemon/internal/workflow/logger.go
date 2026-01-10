package workflow

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// LogEventType identifies the type of workflow log event.
type LogEventType string

const (
	LogEventWorkflowStart LogEventType = "workflow.start"
	LogEventWorkflowEnd   LogEventType = "workflow.end"
	LogEventStepStart     LogEventType = "step.start"
	LogEventStepEnd       LogEventType = "step.end"
	LogEventStepInput     LogEventType = "step.input"
	LogEventStepOutput    LogEventType = "step.output"
	LogEventLoopIteration LogEventType = "loop.iteration"
)

// LogEntry represents a single JSONL log entry.
type LogEntry struct {
	Timestamp  time.Time       `json:"timestamp"`
	Event      LogEventType    `json:"event"`
	WorkflowID string          `json:"workflow_id"`
	BeadID     string          `json:"bead_id,omitempty"`
	Data       json.RawMessage `json:"data,omitempty"`
}

// WorkflowStartData is the data for workflow.start events.
type WorkflowStartData struct {
	GrimoireName string `json:"grimoire"`
	WorktreePath string `json:"worktree_path"`
}

// WorkflowEndData is the data for workflow.end events.
type WorkflowEndData struct {
	Status     string `json:"status"`
	DurationMs int64  `json:"duration_ms"`
	Error      string `json:"error,omitempty"`
	StepCount  int    `json:"step_count"`
}

// StepStartData is the data for step.start events.
type StepStartData struct {
	StepName  string `json:"step_name"`
	StepType  string `json:"step_type"`
	StepIndex int    `json:"step_index"`
}

// StepEndData is the data for step.end events.
type StepEndData struct {
	StepName   string `json:"step_name"`
	StepType   string `json:"step_type"`
	StepIndex  int    `json:"step_index"`
	Success    bool   `json:"success"`
	Skipped    bool   `json:"skipped,omitempty"`
	DurationMs int64  `json:"duration_ms"`
	ExitCode   int    `json:"exit_code,omitempty"`
	Error      string `json:"error,omitempty"`
}

// StepInputData is the data for step.input events.
type StepInputData struct {
	StepName  string            `json:"step_name"`
	Variables map[string]string `json:"variables,omitempty"`
	Spell     string            `json:"spell,omitempty"`
	Command   string            `json:"command,omitempty"`
}

// StepOutputData is the data for step.output events.
type StepOutputData struct {
	StepName    string `json:"step_name"`
	Output      string `json:"output,omitempty"`
	OutputVar   string `json:"output_var,omitempty"`
	TokensUsed  int    `json:"tokens_used,omitempty"`
	TokensLimit int    `json:"tokens_limit,omitempty"`
}

// LoopIterationData is the data for loop.iteration events.
type LoopIterationData struct {
	StepName    string `json:"step_name"`
	Iteration   int    `json:"iteration"`
	MaxIter     int    `json:"max_iterations,omitempty"`
	LoopType    string `json:"loop_type"`
	ShouldBreak bool   `json:"should_break,omitempty"`
}

// Logger writes structured JSONL logs for workflow execution.
type Logger struct {
	logDir string
	mu     sync.Mutex
	files  map[string]*os.File // workflowID -> file handle
}

// NewLogger creates a new workflow logger.
func NewLogger(covenDir string) *Logger {
	return &Logger{
		logDir: filepath.Join(covenDir, "logs", "workflows"),
		files:  make(map[string]*os.File),
	}
}

// LogDir returns the directory where workflow logs are stored.
func (l *Logger) LogDir() string {
	return l.logDir
}

// LogPath returns the path to the log file for a workflow.
func (l *Logger) LogPath(workflowID string) string {
	return filepath.Join(l.logDir, workflowID+".jsonl")
}

// Close closes all open log files.
func (l *Logger) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()

	var lastErr error
	for id, f := range l.files {
		if err := f.Close(); err != nil {
			lastErr = err
		}
		delete(l.files, id)
	}
	return lastErr
}

// CloseWorkflow closes the log file for a specific workflow.
func (l *Logger) CloseWorkflow(workflowID string) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	if f, ok := l.files[workflowID]; ok {
		err := f.Close()
		delete(l.files, workflowID)
		return err
	}
	return nil
}

// getFile returns the file handle for a workflow, creating it if needed.
func (l *Logger) getFile(workflowID string) (*os.File, error) {
	l.mu.Lock()
	defer l.mu.Unlock()

	if f, ok := l.files[workflowID]; ok {
		return f, nil
	}

	// Ensure log directory exists
	if err := os.MkdirAll(l.logDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create log dir: %w", err)
	}

	// Open file for append
	logPath := l.LogPath(workflowID)
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to open log file: %w", err)
	}

	l.files[workflowID] = f
	return f, nil
}

// log writes an entry to the log file.
func (l *Logger) log(workflowID, beadID string, event LogEventType, data interface{}) error {
	f, err := l.getFile(workflowID)
	if err != nil {
		return err
	}

	var dataJSON json.RawMessage
	if data != nil {
		dataJSON, err = json.Marshal(data)
		if err != nil {
			return fmt.Errorf("failed to marshal log data: %w", err)
		}
	}

	entry := LogEntry{
		Timestamp:  time.Now(),
		Event:      event,
		WorkflowID: workflowID,
		BeadID:     beadID,
		Data:       dataJSON,
	}

	line, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("failed to marshal log entry: %w", err)
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	if _, err := f.Write(append(line, '\n')); err != nil {
		return fmt.Errorf("failed to write log entry: %w", err)
	}

	return nil
}

// LogWorkflowStart logs a workflow start event.
func (l *Logger) LogWorkflowStart(workflowID, beadID, grimoireName, worktreePath string) error {
	return l.log(workflowID, beadID, LogEventWorkflowStart, WorkflowStartData{
		GrimoireName: grimoireName,
		WorktreePath: worktreePath,
	})
}

// LogWorkflowEnd logs a workflow end event.
func (l *Logger) LogWorkflowEnd(workflowID, beadID string, status WorkflowStatus, duration time.Duration, stepCount int, errMsg string) error {
	err := l.log(workflowID, beadID, LogEventWorkflowEnd, WorkflowEndData{
		Status:     string(status),
		DurationMs: duration.Milliseconds(),
		StepCount:  stepCount,
		Error:      errMsg,
	})
	if err != nil {
		return err
	}

	// Close the log file when workflow ends
	return l.CloseWorkflow(workflowID)
}

// LogStepStart logs a step start event.
func (l *Logger) LogStepStart(workflowID, beadID, stepName, stepType string, stepIndex int) error {
	return l.log(workflowID, beadID, LogEventStepStart, StepStartData{
		StepName:  stepName,
		StepType:  stepType,
		StepIndex: stepIndex,
	})
}

// LogStepEnd logs a step end event.
func (l *Logger) LogStepEnd(workflowID, beadID, stepName, stepType string, stepIndex int, success, skipped bool, duration time.Duration, exitCode int, errMsg string) error {
	return l.log(workflowID, beadID, LogEventStepEnd, StepEndData{
		StepName:   stepName,
		StepType:   stepType,
		StepIndex:  stepIndex,
		Success:    success,
		Skipped:    skipped,
		DurationMs: duration.Milliseconds(),
		ExitCode:   exitCode,
		Error:      errMsg,
	})
}

// LogStepInput logs the resolved input for a step.
func (l *Logger) LogStepInput(workflowID, beadID, stepName string, variables map[string]string, spell, command string) error {
	return l.log(workflowID, beadID, LogEventStepInput, StepInputData{
		StepName:  stepName,
		Variables: variables,
		Spell:     spell,
		Command:   command,
	})
}

// LogStepOutput logs the output from a step.
func (l *Logger) LogStepOutput(workflowID, beadID, stepName, output, outputVar string, tokensUsed, tokensLimit int) error {
	return l.log(workflowID, beadID, LogEventStepOutput, StepOutputData{
		StepName:    stepName,
		Output:      output,
		OutputVar:   outputVar,
		TokensUsed:  tokensUsed,
		TokensLimit: tokensLimit,
	})
}

// LogLoopIteration logs a loop iteration event.
func (l *Logger) LogLoopIteration(workflowID, beadID, stepName string, iteration, maxIter int, loopType string, shouldBreak bool) error {
	return l.log(workflowID, beadID, LogEventLoopIteration, LoopIterationData{
		StepName:    stepName,
		Iteration:   iteration,
		MaxIter:     maxIter,
		LoopType:    loopType,
		ShouldBreak: shouldBreak,
	})
}
