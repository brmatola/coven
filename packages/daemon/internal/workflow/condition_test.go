package workflow

import (
	"testing"
)

func TestConditionError_Error(t *testing.T) {
	tests := []struct {
		name     string
		err      *ConditionError
		expected string
	}{
		{
			name: "without cause",
			err: &ConditionError{
				Condition: "{{.test}}",
				Message:   "test error",
			},
			expected: `condition "{{.test}}": test error`,
		},
		{
			name: "with cause",
			err: &ConditionError{
				Condition: "{{.test}}",
				Message:   "failed",
				Cause:     &ContextError{Path: "test", Message: "not found"},
			},
			expected: `condition "{{.test}}": failed: context error at "test": not found`,
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

func TestConditionError_Unwrap(t *testing.T) {
	cause := &ContextError{Path: "test", Message: "error"}
	err := &ConditionError{
		Condition: "test",
		Message:   "failed",
		Cause:     cause,
	}

	if err.Unwrap() != cause {
		t.Error("Unwrap() should return cause")
	}
}

func TestIsConditionError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{
			name:     "ConditionError",
			err:      &ConditionError{Condition: "test"},
			expected: true,
		},
		{
			name:     "nil",
			err:      nil,
			expected: false,
		},
		{
			name:     "other error",
			err:      &ContextError{},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsConditionError(tt.err); got != tt.expected {
				t.Errorf("IsConditionError() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestConditionEvaluator_Evaluate_EmptyCondition(t *testing.T) {
	evaluator := NewConditionEvaluator()
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	result, err := evaluator.Evaluate("", ctx)
	if err != nil {
		t.Fatalf("Evaluate() error: %v", err)
	}
	if !result {
		t.Error("Empty condition should return true")
	}
}

func TestConditionEvaluator_Evaluate_LiteralBoolean(t *testing.T) {
	evaluator := NewConditionEvaluator()
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	tests := []struct {
		condition string
		expected  bool
	}{
		{"true", true},
		{"false", false},
		{" true ", true},
		{" false ", false},
	}

	for _, tt := range tests {
		t.Run(tt.condition, func(t *testing.T) {
			result, err := evaluator.Evaluate(tt.condition, ctx)
			if err != nil {
				t.Fatalf("Evaluate() error: %v", err)
			}
			if result != tt.expected {
				t.Errorf("Evaluate(%q) = %v, want %v", tt.condition, result, tt.expected)
			}
		})
	}
}

func TestConditionEvaluator_Evaluate_PreviousFailed(t *testing.T) {
	evaluator := NewConditionEvaluator()
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	// Previous step failed
	ctx.SetPrevious(&StepResult{Success: false})

	result, err := evaluator.Evaluate("{{.previous.failed}}", ctx)
	if err != nil {
		t.Fatalf("Evaluate() error: %v", err)
	}
	if !result {
		t.Error("{{.previous.failed}} should be true when previous failed")
	}

	// Previous step succeeded
	ctx.SetPrevious(&StepResult{Success: true})

	result, err = evaluator.Evaluate("{{.previous.failed}}", ctx)
	if err != nil {
		t.Fatalf("Evaluate() error: %v", err)
	}
	if result {
		t.Error("{{.previous.failed}} should be false when previous succeeded")
	}
}

func TestConditionEvaluator_Evaluate_PreviousSuccess(t *testing.T) {
	evaluator := NewConditionEvaluator()
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	// Previous step succeeded
	ctx.SetPrevious(&StepResult{Success: true})

	result, err := evaluator.Evaluate("{{.previous.success}}", ctx)
	if err != nil {
		t.Fatalf("Evaluate() error: %v", err)
	}
	if !result {
		t.Error("{{.previous.success}} should be true when previous succeeded")
	}

	// Previous step failed
	ctx.SetPrevious(&StepResult{Success: false})

	result, err = evaluator.Evaluate("{{.previous.success}}", ctx)
	if err != nil {
		t.Fatalf("Evaluate() error: %v", err)
	}
	if result {
		t.Error("{{.previous.success}} should be false when previous failed")
	}
}

func TestConditionEvaluator_Evaluate_StepOutput(t *testing.T) {
	evaluator := NewConditionEvaluator()
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	// Store step output with JSON
	result := &StepResult{
		Success: true,
		Output:  `{"needs_fixes": true, "count": 5}`,
	}
	_ = ctx.StoreStepOutput("review", result, "findings")

	// Access step output field
	evalResult, err := evaluator.Evaluate("{{.findings.outputs.needs_fixes}}", ctx)
	if err != nil {
		t.Fatalf("Evaluate() error: %v", err)
	}
	if !evalResult {
		t.Error("Expected true for needs_fixes=true")
	}
}

func TestConditionEvaluator_Evaluate_NumericOutput(t *testing.T) {
	evaluator := NewConditionEvaluator()
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	// Store step with numeric output
	result := &StepResult{
		Success: true,
		Output:  `{"count": 0, "other": 5}`,
	}
	_ = ctx.StoreStepOutput("check", result, "")

	// Zero should be false
	evalResult, err := evaluator.Evaluate("{{.check.outputs.count}}", ctx)
	if err != nil {
		t.Fatalf("Evaluate() error: %v", err)
	}
	if evalResult {
		t.Error("Expected false for count=0")
	}

	// Non-zero should be true
	evalResult, err = evaluator.Evaluate("{{.check.outputs.other}}", ctx)
	if err != nil {
		t.Fatalf("Evaluate() error: %v", err)
	}
	if !evalResult {
		t.Error("Expected true for other=5")
	}
}

func TestConditionEvaluator_Evaluate_InvalidFormat(t *testing.T) {
	evaluator := NewConditionEvaluator()
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	_, err := evaluator.Evaluate("some random text", ctx)
	if err == nil {
		t.Fatal("Expected error for invalid format")
	}
	if !IsConditionError(err) {
		t.Errorf("Expected ConditionError, got %T", err)
	}
}

func TestConditionEvaluator_Evaluate_InvalidTemplate(t *testing.T) {
	evaluator := NewConditionEvaluator()
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	_, err := evaluator.Evaluate("{{.invalid}", ctx)
	if err == nil {
		t.Fatal("Expected error for invalid template")
	}
	if !IsConditionError(err) {
		t.Errorf("Expected ConditionError, got %T", err)
	}
}

func TestConditionEvaluator_coerceToBool(t *testing.T) {
	evaluator := NewConditionEvaluator()

	tests := []struct {
		value    string
		expected bool
	}{
		{"true", true},
		{"false", false},
		{"TRUE", true},
		{"FALSE", false},
		{"True", true},
		{"False", false},
		{"", false},
		{"  ", false},
		{"0", false},
		{"1", true},
		{"42", true},
		{"-1", true},
		{"3.14", true},
		{"0.0", false},
		{"hello", true},
		{"yes", true}, // non-empty string
	}

	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			result, err := evaluator.coerceToBool(tt.value, "test")
			if err != nil {
				t.Fatalf("coerceToBool() error: %v", err)
			}
			if result != tt.expected {
				t.Errorf("coerceToBool(%q) = %v, want %v", tt.value, result, tt.expected)
			}
		})
	}
}

func TestConditionEvaluator_EvaluatePath(t *testing.T) {
	evaluator := NewConditionEvaluator()
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	ctx.SetPrevious(&StepResult{Success: false})

	result, err := evaluator.EvaluatePath("previous.failed", ctx)
	if err != nil {
		t.Fatalf("EvaluatePath() error: %v", err)
	}
	if !result {
		t.Error("Expected true for previous.failed")
	}
}

func TestConditionEvaluator_EvaluatePath_NotFound(t *testing.T) {
	evaluator := NewConditionEvaluator()
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	_, err := evaluator.EvaluatePath("nonexistent.path", ctx)
	if err == nil {
		t.Fatal("Expected error for nonexistent path")
	}
	if !IsConditionError(err) {
		t.Errorf("Expected ConditionError, got %T", err)
	}
}

func TestConditionEvaluator_coerceValueToBool(t *testing.T) {
	evaluator := NewConditionEvaluator()

	tests := []struct {
		name     string
		value    interface{}
		expected bool
	}{
		{"nil", nil, false},
		{"bool true", true, false}, // Note: this is the raw bool, not string
		{"bool false", false, false},
		{"string true", "true", true},
		{"string false", "false", false},
		{"empty string", "", false},
		{"non-empty string", "hello", true},
		{"int zero", 0, false},
		{"int non-zero", 42, true},
		{"int64 zero", int64(0), false},
		{"int64 non-zero", int64(100), true},
		{"float64 zero", float64(0), false},
		{"float64 non-zero", float64(3.14), true},
		{"empty array", []interface{}{}, false},
		{"non-empty array", []interface{}{"a"}, true},
		{"empty map", map[string]interface{}{}, false},
		{"non-empty map", map[string]interface{}{"key": "val"}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := evaluator.coerceValueToBool(tt.value, "test")

			// Special case: raw bool values
			if b, ok := tt.value.(bool); ok {
				if err != nil {
					t.Fatalf("coerceValueToBool() error: %v", err)
				}
				if result != b {
					t.Errorf("coerceValueToBool(%v) = %v, want %v", tt.value, result, b)
				}
				return
			}

			if err != nil {
				t.Fatalf("coerceValueToBool() error: %v", err)
			}
			if result != tt.expected {
				t.Errorf("coerceValueToBool(%v) = %v, want %v", tt.value, result, tt.expected)
			}
		})
	}
}

func TestConditionEvaluator_coerceValueToBool_UnsupportedType(t *testing.T) {
	evaluator := NewConditionEvaluator()

	type CustomType struct{}
	_, err := evaluator.coerceValueToBool(CustomType{}, "test")
	if err == nil {
		t.Fatal("Expected error for unsupported type")
	}
	if !IsConditionError(err) {
		t.Errorf("Expected ConditionError, got %T", err)
	}
}

func TestConditionEvaluator_EvaluateWithResult(t *testing.T) {
	evaluator := NewConditionEvaluator()
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")
	ctx.SetPrevious(&StepResult{Success: false})

	result, err := evaluator.EvaluateWithResult("{{.previous.failed}}", ctx)
	if err != nil {
		t.Fatalf("EvaluateWithResult() error: %v", err)
	}

	if !result.ShouldExecute {
		t.Error("ShouldExecute should be true")
	}
	if result.Skipped {
		t.Error("Skipped should be false")
	}
	if result.Condition != "{{.previous.failed}}" {
		t.Errorf("Condition = %q, want %q", result.Condition, "{{.previous.failed}}")
	}
}

func TestConditionEvaluator_EvaluateWithResult_Empty(t *testing.T) {
	evaluator := NewConditionEvaluator()
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	result, err := evaluator.EvaluateWithResult("", ctx)
	if err != nil {
		t.Fatalf("EvaluateWithResult() error: %v", err)
	}

	if !result.ShouldExecute {
		t.Error("ShouldExecute should be true for empty condition")
	}
	if result.EvaluatedValue != "true" {
		t.Errorf("EvaluatedValue = %q, want %q", result.EvaluatedValue, "true")
	}
}

func TestConditionEvaluator_EvaluateWithResult_LiteralTrue(t *testing.T) {
	evaluator := NewConditionEvaluator()
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	result, err := evaluator.EvaluateWithResult("true", ctx)
	if err != nil {
		t.Fatalf("EvaluateWithResult() error: %v", err)
	}

	if !result.ShouldExecute {
		t.Error("ShouldExecute should be true")
	}
	if result.EvaluatedValue != "true" {
		t.Errorf("EvaluatedValue = %q, want %q", result.EvaluatedValue, "true")
	}
}

func TestConditionEvaluator_EvaluateWithResult_LiteralFalse(t *testing.T) {
	evaluator := NewConditionEvaluator()
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	result, err := evaluator.EvaluateWithResult("false", ctx)
	if err != nil {
		t.Fatalf("EvaluateWithResult() error: %v", err)
	}

	if result.ShouldExecute {
		t.Error("ShouldExecute should be false")
	}
	if !result.Skipped {
		t.Error("Skipped should be true")
	}
	if result.EvaluatedValue != "false" {
		t.Errorf("EvaluatedValue = %q, want %q", result.EvaluatedValue, "false")
	}
}

func TestConditionEvaluator_EvaluateWithResult_InvalidFormat(t *testing.T) {
	evaluator := NewConditionEvaluator()
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	_, err := evaluator.EvaluateWithResult("invalid format", ctx)
	if err == nil {
		t.Fatal("Expected error for invalid format")
	}
}

func TestShouldSkipStep(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")
	ctx.SetPrevious(&StepResult{Success: false})

	tests := []struct {
		name     string
		when     string
		expected bool // true = skip
	}{
		{"empty condition", "", false},
		{"true condition", "true", false},
		{"false condition", "false", true},
		{"previous failed (true)", "{{.previous.failed}}", false}, // don't skip
		{"previous success (false)", "{{.previous.success}}", true}, // skip
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			skip, err := ShouldSkipStep(tt.when, ctx)
			if err != nil {
				t.Fatalf("ShouldSkipStep() error: %v", err)
			}
			if skip != tt.expected {
				t.Errorf("ShouldSkipStep(%q) = %v, want %v", tt.when, skip, tt.expected)
			}
		})
	}
}

func TestShouldSkipStep_Error(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	_, err := ShouldSkipStep("invalid format", ctx)
	if err == nil {
		t.Fatal("Expected error for invalid format")
	}
}

func TestConditionEvaluator_Evaluate_ComplexTemplates(t *testing.T) {
	evaluator := NewConditionEvaluator()
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	// Store step outputs
	_ = ctx.StoreStepOutput("check", &StepResult{
		Success: true,
		Output:  `{"enabled": true, "disabled": false, "count": 3}`,
	}, "")

	tests := []struct {
		condition string
		expected  bool
	}{
		{"{{.check.outputs.enabled}}", true},
		{"{{.check.outputs.disabled}}", false},
		{"{{.check.outputs.count}}", true}, // 3 != 0
	}

	for _, tt := range tests {
		t.Run(tt.condition, func(t *testing.T) {
			result, err := evaluator.Evaluate(tt.condition, ctx)
			if err != nil {
				t.Fatalf("Evaluate() error: %v", err)
			}
			if result != tt.expected {
				t.Errorf("Evaluate(%q) = %v, want %v", tt.condition, result, tt.expected)
			}
		})
	}
}

func TestConditionEvaluator_Evaluate_MissingVariable(t *testing.T) {
	evaluator := NewConditionEvaluator()
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	// Template with missing variable - Go templates return <no value> for missing
	result, err := evaluator.Evaluate("{{.missing}}", ctx)
	if err != nil {
		t.Fatalf("Evaluate() error: %v", err)
	}
	// <no value> is a non-empty string, so it's true
	if !result {
		t.Error("Missing variable should evaluate to true (non-empty placeholder)")
	}
}

func TestConditionEvaluator_EvaluateWithResult_Template(t *testing.T) {
	evaluator := NewConditionEvaluator()
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	_ = ctx.StoreStepOutput("step1", &StepResult{
		Success: true,
		Output:  `{"value": 42}`,
	}, "")

	result, err := evaluator.EvaluateWithResult("{{.step1.outputs.value}}", ctx)
	if err != nil {
		t.Fatalf("EvaluateWithResult() error: %v", err)
	}

	if !result.ShouldExecute {
		t.Error("ShouldExecute should be true for non-zero value")
	}
	if result.EvaluatedValue != "42" {
		t.Errorf("EvaluatedValue = %q, want %q", result.EvaluatedValue, "42")
	}
}
