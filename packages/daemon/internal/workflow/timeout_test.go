package workflow

import (
	"context"
	"testing"
	"time"
)

func TestTimeoutError_Error(t *testing.T) {
	tests := []struct {
		name     string
		err      *TimeoutError
		expected string
	}{
		{
			name: "step timeout",
			err: &TimeoutError{
				StepName: "run-tests",
				Duration: 5 * time.Minute,
			},
			expected: `step "run-tests" timeout exceeded after 5m0s`,
		},
		{
			name: "workflow timeout",
			err: &TimeoutError{
				Duration:          1 * time.Hour,
				IsWorkflowTimeout: true,
			},
			expected: "workflow timeout exceeded after 1h0m0s",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.err.Error(); got != tt.expected {
				t.Errorf("Error() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestIsTimeoutError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{
			name:     "TimeoutError",
			err:      &TimeoutError{StepName: "test"},
			expected: true,
		},
		{
			name:     "nil",
			err:      nil,
			expected: false,
		},
		{
			name:     "context.DeadlineExceeded",
			err:      context.DeadlineExceeded,
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsTimeoutError(tt.err); got != tt.expected {
				t.Errorf("IsTimeoutError() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestNewTimeoutManager(t *testing.T) {
	ctx := context.Background()
	manager := NewTimeoutManager(ctx, 1*time.Hour)
	defer manager.Cancel()

	if manager.workflowTimeout != 1*time.Hour {
		t.Errorf("workflowTimeout = %v, want %v", manager.workflowTimeout, 1*time.Hour)
	}

	if manager.workflowCtx == nil {
		t.Error("workflowCtx should not be nil")
	}

	if manager.workflowCancel == nil {
		t.Error("workflowCancel should not be nil")
	}
}

func TestTimeoutManager_Cancel(t *testing.T) {
	ctx := context.Background()
	manager := NewTimeoutManager(ctx, 1*time.Hour)

	// Cancel should not panic
	manager.Cancel()

	// Context should be cancelled
	if manager.workflowCtx.Err() == nil {
		t.Error("Expected context to be cancelled after Cancel()")
	}
}

func TestTimeoutManager_WorkflowContext(t *testing.T) {
	ctx := context.Background()
	manager := NewTimeoutManager(ctx, 1*time.Hour)
	defer manager.Cancel()

	workflowCtx := manager.WorkflowContext()
	if workflowCtx == nil {
		t.Fatal("WorkflowContext() returned nil")
	}

	// Should not be cancelled yet
	if workflowCtx.Err() != nil {
		t.Error("WorkflowContext should not be cancelled")
	}
}

func TestTimeoutManager_RemainingWorkflowTime(t *testing.T) {
	ctx := context.Background()
	manager := NewTimeoutManager(ctx, 100*time.Millisecond)
	defer manager.Cancel()

	// Initially should have most of the time remaining
	remaining := manager.RemainingWorkflowTime()
	if remaining < 90*time.Millisecond {
		t.Errorf("RemainingWorkflowTime() = %v, expected close to 100ms", remaining)
	}

	// Wait for some time
	time.Sleep(50 * time.Millisecond)

	// Should have less remaining
	remaining = manager.RemainingWorkflowTime()
	if remaining > 60*time.Millisecond {
		t.Errorf("RemainingWorkflowTime() = %v, expected around 50ms", remaining)
	}
}

func TestTimeoutManager_RemainingWorkflowTime_Expired(t *testing.T) {
	ctx := context.Background()
	manager := NewTimeoutManager(ctx, 10*time.Millisecond)
	defer manager.Cancel()

	// Wait for timeout to expire
	time.Sleep(20 * time.Millisecond)

	remaining := manager.RemainingWorkflowTime()
	if remaining != 0 {
		t.Errorf("RemainingWorkflowTime() = %v, want 0", remaining)
	}
}

func TestTimeoutManager_IsWorkflowTimedOut(t *testing.T) {
	ctx := context.Background()
	manager := NewTimeoutManager(ctx, 10*time.Millisecond)
	defer manager.Cancel()

	// Initially not timed out
	if manager.IsWorkflowTimedOut() {
		t.Error("Should not be timed out initially")
	}

	// Wait for timeout
	time.Sleep(20 * time.Millisecond)

	// Should be timed out
	if !manager.IsWorkflowTimedOut() {
		t.Error("Should be timed out after waiting")
	}
}

func TestTimeoutManager_StepContext(t *testing.T) {
	ctx := context.Background()
	manager := NewTimeoutManager(ctx, 1*time.Hour)
	defer manager.Cancel()

	stepCtx, cancel, err := manager.StepContext("test-step", 5*time.Minute)
	if err != nil {
		t.Fatalf("StepContext() error: %v", err)
	}
	defer cancel()

	if stepCtx == nil {
		t.Fatal("StepContext() returned nil context")
	}

	// Step context should not be cancelled
	if stepCtx.Err() != nil {
		t.Error("Step context should not be cancelled")
	}
}

func TestTimeoutManager_StepContext_WorkflowAlreadyTimedOut(t *testing.T) {
	ctx := context.Background()
	manager := NewTimeoutManager(ctx, 10*time.Millisecond)

	// Wait for workflow to timeout
	time.Sleep(20 * time.Millisecond)

	_, _, err := manager.StepContext("test-step", 5*time.Minute)
	if err == nil {
		t.Fatal("Expected error when workflow already timed out")
	}

	if !IsTimeoutError(err) {
		t.Errorf("Expected TimeoutError, got %T", err)
	}

	te := err.(*TimeoutError)
	if !te.IsWorkflowTimeout {
		t.Error("Expected IsWorkflowTimeout to be true")
	}
}

func TestTimeoutManager_StepContext_UsesRemainingTime(t *testing.T) {
	ctx := context.Background()
	// Only 50ms workflow timeout
	manager := NewTimeoutManager(ctx, 50*time.Millisecond)
	defer manager.Cancel()

	// Request 5 minute step timeout, but only 50ms remaining
	stepCtx, cancel, err := manager.StepContext("test-step", 5*time.Minute)
	if err != nil {
		t.Fatalf("StepContext() error: %v", err)
	}
	defer cancel()

	// Wait for step context to expire (should be around 50ms, not 5 minutes)
	time.Sleep(60 * time.Millisecond)

	if stepCtx.Err() == nil {
		t.Error("Step context should have expired")
	}
}

func TestTimeoutManager_StepContext_StepTimeoutShorter(t *testing.T) {
	ctx := context.Background()
	manager := NewTimeoutManager(ctx, 1*time.Hour)
	defer manager.Cancel()

	// Request 30ms step timeout
	stepCtx, cancel, err := manager.StepContext("test-step", 30*time.Millisecond)
	if err != nil {
		t.Fatalf("StepContext() error: %v", err)
	}
	defer cancel()

	// Wait for step context to expire
	time.Sleep(40 * time.Millisecond)

	if stepCtx.Err() == nil {
		t.Error("Step context should have expired after step timeout")
	}
}

func TestTimeoutManager_CheckStepTimeout_NoError(t *testing.T) {
	ctx := context.Background()
	manager := NewTimeoutManager(ctx, 1*time.Hour)
	defer manager.Cancel()

	stepCtx, cancel, _ := manager.StepContext("test-step", 5*time.Minute)
	defer cancel()

	// No timeout yet
	err := manager.CheckStepTimeout("test-step", 5*time.Minute, stepCtx)
	if err != nil {
		t.Errorf("CheckStepTimeout() = %v, want nil", err)
	}
}

func TestTimeoutManager_CheckStepTimeout_StepTimeout(t *testing.T) {
	ctx := context.Background()
	manager := NewTimeoutManager(ctx, 1*time.Hour)
	defer manager.Cancel()

	stepCtx, cancel, _ := manager.StepContext("test-step", 10*time.Millisecond)

	// Wait for step to timeout
	time.Sleep(20 * time.Millisecond)
	cancel()

	err := manager.CheckStepTimeout("test-step", 10*time.Millisecond, stepCtx)
	if err == nil {
		t.Fatal("Expected error for timed out step")
	}

	if !IsTimeoutError(err) {
		t.Errorf("Expected TimeoutError, got %T", err)
	}

	te := err.(*TimeoutError)
	if te.StepName != "test-step" {
		t.Errorf("StepName = %q, want %q", te.StepName, "test-step")
	}
	if te.IsWorkflowTimeout {
		t.Error("Expected IsWorkflowTimeout to be false")
	}
}

func TestTimeoutManager_CheckStepTimeout_WorkflowTimeout(t *testing.T) {
	ctx := context.Background()
	manager := NewTimeoutManager(ctx, 10*time.Millisecond)

	stepCtx, cancel, _ := manager.StepContext("test-step", 1*time.Hour)
	defer cancel()

	// Wait for workflow to timeout
	time.Sleep(20 * time.Millisecond)

	err := manager.CheckStepTimeout("test-step", 1*time.Hour, stepCtx)
	if err == nil {
		t.Fatal("Expected error for workflow timeout")
	}

	if !IsTimeoutError(err) {
		t.Errorf("Expected TimeoutError, got %T", err)
	}

	te := err.(*TimeoutError)
	if !te.IsWorkflowTimeout {
		t.Error("Expected IsWorkflowTimeout to be true")
	}
}

func TestTimeoutConfig_GetStepTimeout(t *testing.T) {
	config := &TimeoutConfig{
		WorkflowTimeout: 1 * time.Hour,
		StepTimeouts: map[string]time.Duration{
			"slow-step": 30 * time.Minute,
			"fast-step": 1 * time.Minute,
		},
		DefaultStepTimeout: 5 * time.Minute,
	}

	tests := []struct {
		stepName string
		expected time.Duration
	}{
		{"slow-step", 30 * time.Minute},
		{"fast-step", 1 * time.Minute},
		{"unknown-step", 5 * time.Minute},
	}

	for _, tt := range tests {
		t.Run(tt.stepName, func(t *testing.T) {
			got := config.GetStepTimeout(tt.stepName)
			if got != tt.expected {
				t.Errorf("GetStepTimeout(%q) = %v, want %v", tt.stepName, got, tt.expected)
			}
		})
	}
}

func TestParseDuration(t *testing.T) {
	tests := []struct {
		name         string
		input        string
		defaultVal   time.Duration
		expected     time.Duration
		expectErr    bool
	}{
		{
			name:       "empty uses default",
			input:      "",
			defaultVal: 5 * time.Minute,
			expected:   5 * time.Minute,
		},
		{
			name:       "valid duration",
			input:      "10m",
			defaultVal: 5 * time.Minute,
			expected:   10 * time.Minute,
		},
		{
			name:       "complex duration",
			input:      "1h30m",
			defaultVal: 0,
			expected:   90 * time.Minute,
		},
		{
			name:       "invalid duration",
			input:      "invalid",
			defaultVal: 5 * time.Minute,
			expectErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseDuration(tt.input, tt.defaultVal)
			if tt.expectErr {
				if err == nil {
					t.Error("Expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseDuration() error: %v", err)
			}
			if got != tt.expected {
				t.Errorf("ParseDuration() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestFormatDuration(t *testing.T) {
	tests := []struct {
		input    time.Duration
		expected string
	}{
		{1 * time.Hour, "1h"},
		{90 * time.Minute, "1h30m"},
		{5 * time.Minute, "5m"},
		{5*time.Minute + 30*time.Second, "5m30s"},
		{30 * time.Second, "30s"},
		{500 * time.Millisecond, "500ms"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			got := FormatDuration(tt.input)
			if got != tt.expected {
				t.Errorf("FormatDuration(%v) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestDefaultTimeouts(t *testing.T) {
	if DefaultAgentTimeout != 10*time.Minute {
		t.Errorf("DefaultAgentTimeout = %v, want %v", DefaultAgentTimeout, 10*time.Minute)
	}
	if DefaultScriptTimeout != 5*time.Minute {
		t.Errorf("DefaultScriptTimeout = %v, want %v", DefaultScriptTimeout, 5*time.Minute)
	}
	if DefaultWorkflowTimeout != 1*time.Hour {
		t.Errorf("DefaultWorkflowTimeout = %v, want %v", DefaultWorkflowTimeout, 1*time.Hour)
	}
}

func TestTimeoutManager_Cancel_NilCancel(t *testing.T) {
	// Test that Cancel doesn't panic with nil cancel func
	manager := &TimeoutManager{
		workflowCancel: nil,
	}

	// Should not panic
	manager.Cancel()
}

func TestTimeoutManager_StepContext_ZeroRemaining(t *testing.T) {
	ctx := context.Background()
	manager := NewTimeoutManager(ctx, 1*time.Millisecond)

	// Wait for timeout to expire
	time.Sleep(10 * time.Millisecond)

	_, _, err := manager.StepContext("test-step", 5*time.Minute)
	if err == nil {
		t.Fatal("Expected error when no remaining time")
	}

	if !IsTimeoutError(err) {
		t.Errorf("Expected TimeoutError, got %T", err)
	}
}

func TestTimeoutConfig_EmptyStepTimeouts(t *testing.T) {
	config := &TimeoutConfig{
		WorkflowTimeout:    1 * time.Hour,
		StepTimeouts:       nil, // nil map
		DefaultStepTimeout: 5 * time.Minute,
	}

	got := config.GetStepTimeout("any-step")
	if got != 5*time.Minute {
		t.Errorf("GetStepTimeout() = %v, want %v", got, 5*time.Minute)
	}
}
