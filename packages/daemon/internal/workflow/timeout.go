package workflow

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// Default timeouts for different step types.
const (
	DefaultAgentTimeout    = 10 * time.Minute
	DefaultScriptTimeout   = 5 * time.Minute
	DefaultWorkflowTimeout = 1 * time.Hour
)

// TimeoutError represents a timeout error with context about what timed out.
type TimeoutError struct {
	// StepName is the name of the step that timed out (empty for workflow timeout).
	StepName string

	// Duration is how long the timeout was set for.
	Duration time.Duration

	// IsWorkflowTimeout indicates this is a workflow-level timeout, not step-level.
	IsWorkflowTimeout bool
}

func (e *TimeoutError) Error() string {
	if e.IsWorkflowTimeout {
		return fmt.Sprintf("workflow timeout exceeded after %s", e.Duration)
	}
	return fmt.Sprintf("step %q timeout exceeded after %s", e.StepName, e.Duration)
}

// IsTimeoutError checks if an error is a TimeoutError.
func IsTimeoutError(err error) bool {
	var te *TimeoutError
	return errors.As(err, &te)
}

// TimeoutManager manages timeout contexts for workflow and step execution.
type TimeoutManager struct {
	// workflowStart is when the workflow started.
	workflowStart time.Time

	// workflowTimeout is the total timeout for the workflow.
	workflowTimeout time.Duration

	// workflowCtx is the context with workflow timeout.
	workflowCtx context.Context

	// workflowCancel cancels the workflow context.
	workflowCancel context.CancelFunc
}

// NewTimeoutManager creates a new timeout manager for a workflow.
// The workflow timeout is applied immediately to the base context.
func NewTimeoutManager(ctx context.Context, workflowTimeout time.Duration) *TimeoutManager {
	start := time.Now()

	workflowCtx, workflowCancel := context.WithTimeout(ctx, workflowTimeout)

	return &TimeoutManager{
		workflowStart:   start,
		workflowTimeout: workflowTimeout,
		workflowCtx:     workflowCtx,
		workflowCancel:  workflowCancel,
	}
}

// Cancel cancels the workflow context. Should be called when workflow completes.
func (m *TimeoutManager) Cancel() {
	if m.workflowCancel != nil {
		m.workflowCancel()
	}
}

// WorkflowContext returns the context with workflow timeout.
func (m *TimeoutManager) WorkflowContext() context.Context {
	return m.workflowCtx
}

// RemainingWorkflowTime returns how much time is left before workflow timeout.
func (m *TimeoutManager) RemainingWorkflowTime() time.Duration {
	elapsed := time.Since(m.workflowStart)
	remaining := m.workflowTimeout - elapsed
	if remaining < 0 {
		return 0
	}
	return remaining
}

// IsWorkflowTimedOut returns true if the workflow has exceeded its timeout.
func (m *TimeoutManager) IsWorkflowTimedOut() bool {
	return m.workflowCtx.Err() != nil
}

// StepContext creates a context with step-specific timeout.
// The returned context will expire at whichever comes first:
// - The step timeout
// - The remaining workflow timeout
// Returns the context, a cancel function that must be called, and any error.
func (m *TimeoutManager) StepContext(stepName string, stepTimeout time.Duration) (context.Context, context.CancelFunc, error) {
	// Check if workflow already timed out
	if m.workflowCtx.Err() != nil {
		return nil, nil, &TimeoutError{
			Duration:          m.workflowTimeout,
			IsWorkflowTimeout: true,
		}
	}

	remaining := m.RemainingWorkflowTime()
	if remaining <= 0 {
		return nil, nil, &TimeoutError{
			Duration:          m.workflowTimeout,
			IsWorkflowTimeout: true,
		}
	}

	// Use the smaller of step timeout and remaining workflow time
	effectiveTimeout := stepTimeout
	if remaining < stepTimeout {
		effectiveTimeout = remaining
	}

	stepCtx, cancel := context.WithTimeout(m.workflowCtx, effectiveTimeout)
	return stepCtx, cancel, nil
}

// CheckStepTimeout checks if a step exceeded its timeout and returns an appropriate error.
// Call this after step execution if ctx.Err() is non-nil.
func (m *TimeoutManager) CheckStepTimeout(stepName string, stepTimeout time.Duration, ctx context.Context) error {
	if ctx.Err() == nil {
		return nil
	}

	// Check if it was workflow timeout
	if m.workflowCtx.Err() != nil && m.RemainingWorkflowTime() <= 0 {
		return &TimeoutError{
			Duration:          m.workflowTimeout,
			IsWorkflowTimeout: true,
		}
	}

	// It was step timeout
	return &TimeoutError{
		StepName: stepName,
		Duration: stepTimeout,
	}
}

// TimeoutConfig holds timeout configuration parsed from a grimoire.
type TimeoutConfig struct {
	// WorkflowTimeout is the total workflow timeout.
	WorkflowTimeout time.Duration

	// StepTimeouts is a map of step name to step-specific timeout.
	StepTimeouts map[string]time.Duration

	// DefaultStepTimeout is the default timeout for steps without explicit timeout.
	DefaultStepTimeout time.Duration
}

// GetStepTimeout returns the timeout for a specific step.
// Returns the step-specific timeout if configured, otherwise the default.
func (c *TimeoutConfig) GetStepTimeout(stepName string) time.Duration {
	if timeout, ok := c.StepTimeouts[stepName]; ok {
		return timeout
	}
	return c.DefaultStepTimeout
}

// ParseDuration parses a duration string with a fallback default.
// Returns the default if the string is empty.
func ParseDuration(s string, defaultDuration time.Duration) (time.Duration, error) {
	if s == "" {
		return defaultDuration, nil
	}
	return time.ParseDuration(s)
}

// FormatDuration formats a duration for display in error messages.
func FormatDuration(d time.Duration) string {
	if d >= time.Hour {
		hours := d / time.Hour
		minutes := (d % time.Hour) / time.Minute
		if minutes > 0 {
			return fmt.Sprintf("%dh%dm", hours, minutes)
		}
		return fmt.Sprintf("%dh", hours)
	}
	if d >= time.Minute {
		minutes := d / time.Minute
		seconds := (d % time.Minute) / time.Second
		if seconds > 0 {
			return fmt.Sprintf("%dm%ds", minutes, seconds)
		}
		return fmt.Sprintf("%dm", minutes)
	}
	if d >= time.Second {
		return fmt.Sprintf("%ds", d/time.Second)
	}
	return fmt.Sprintf("%dms", d/time.Millisecond)
}
