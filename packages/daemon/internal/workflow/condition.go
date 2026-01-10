package workflow

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"text/template"
)

// ConditionError represents an error evaluating a condition.
type ConditionError struct {
	Condition string
	Message   string
	Cause     error
}

func (e *ConditionError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("condition %q: %s: %v", e.Condition, e.Message, e.Cause)
	}
	return fmt.Sprintf("condition %q: %s", e.Condition, e.Message)
}

func (e *ConditionError) Unwrap() error {
	return e.Cause
}

// IsConditionError checks if an error is a ConditionError.
func IsConditionError(err error) bool {
	var ce *ConditionError
	return errors.As(err, &ce)
}

// ConditionEvaluator evaluates 'when' clause conditions.
type ConditionEvaluator struct{}

// NewConditionEvaluator creates a new condition evaluator.
func NewConditionEvaluator() *ConditionEvaluator {
	return &ConditionEvaluator{}
}

// templatePattern matches Go template expressions like {{.foo.bar}} or {{not .foo.bar}}
var templatePattern = regexp.MustCompile(`\{\{.*\}\}`)

// Evaluate evaluates a 'when' condition and returns whether it is true.
// The condition can be:
// - A simple template variable: "{{.previous.failed}}"
// - A literal boolean: "true" or "false"
// - An empty string (returns true - unconditional execution)
//
// Returns (should_execute, error).
func (e *ConditionEvaluator) Evaluate(condition string, ctx *StepContext) (bool, error) {
	// Empty condition means unconditional execution
	if condition == "" {
		return true, nil
	}

	// Check for literal boolean strings
	trimmed := strings.TrimSpace(condition)
	if trimmed == "true" {
		return true, nil
	}
	if trimmed == "false" {
		return false, nil
	}

	// Check if it's a template variable
	if templatePattern.MatchString(condition) {
		return e.evaluateTemplate(condition, ctx)
	}

	// Unknown format - fail explicitly
	return false, &ConditionError{
		Condition: condition,
		Message:   "invalid condition format, expected Go template expression like {{.previous.failed}} or {{not .var}} or literal 'true'/'false'",
	}
}

// evaluateTemplate evaluates a template-style condition.
func (e *ConditionEvaluator) evaluateTemplate(condition string, ctx *StepContext) (bool, error) {
	// Parse and execute the template
	tmpl, err := template.New("condition").Parse(condition)
	if err != nil {
		return false, &ConditionError{
			Condition: condition,
			Message:   "failed to parse template",
			Cause:     err,
		}
	}

	var buf strings.Builder
	if err := tmpl.Execute(&buf, ctx.ToMap()); err != nil {
		return false, &ConditionError{
			Condition: condition,
			Message:   "failed to evaluate template",
			Cause:     err,
		}
	}

	result := buf.String()
	return e.coerceToBool(result, condition)
}

// coerceToBool converts a value string to a boolean following the documented rules.
// Rules:
// - "true"/"false" strings → boolean
// - Non-empty string → true
// - Empty string → false
// - Numbers: 0 → false, non-zero → true (parsed from string)
func (e *ConditionEvaluator) coerceToBool(value string, condition string) (bool, error) {
	trimmed := strings.TrimSpace(value)

	// Empty string → false
	if trimmed == "" {
		return false, nil
	}

	// Explicit boolean strings
	lower := strings.ToLower(trimmed)
	if lower == "true" {
		return true, nil
	}
	if lower == "false" {
		return false, nil
	}

	// Try to parse as number
	var num float64
	_, err := fmt.Sscanf(trimmed, "%f", &num)
	if err == nil {
		return num != 0, nil
	}

	// Non-empty string → true
	return true, nil
}

// EvaluatePath evaluates a condition based on a path in the context.
// This is a convenience method for simple conditions like "previous.failed".
func (e *ConditionEvaluator) EvaluatePath(path string, ctx *StepContext) (bool, error) {
	val, err := ctx.GetPath(path)
	if err != nil {
		return false, &ConditionError{
			Condition: path,
			Message:   "failed to resolve path",
			Cause:     err,
		}
	}

	return e.coerceValueToBool(val, path)
}

// coerceValueToBool converts an interface{} value to a boolean.
func (e *ConditionEvaluator) coerceValueToBool(val interface{}, condition string) (bool, error) {
	if val == nil {
		return false, nil
	}

	switch v := val.(type) {
	case bool:
		return v, nil
	case string:
		return e.coerceToBool(v, condition)
	case int:
		return v != 0, nil
	case int64:
		return v != 0, nil
	case float64:
		return v != 0, nil
	case []interface{}:
		// Non-empty array → true
		return len(v) > 0, nil
	case map[string]interface{}:
		// Non-empty map → true
		return len(v) > 0, nil
	default:
		return false, &ConditionError{
			Condition: condition,
			Message:   fmt.Sprintf("cannot convert %T to boolean", val),
		}
	}
}

// ConditionResult represents the result of condition evaluation.
type ConditionResult struct {
	// ShouldExecute indicates whether the step should execute.
	ShouldExecute bool

	// Condition is the original condition string.
	Condition string

	// EvaluatedValue is what the condition evaluated to before boolean coercion.
	EvaluatedValue string

	// Skipped is true if the step should be skipped (inverse of ShouldExecute).
	Skipped bool
}

// EvaluateWithResult evaluates a condition and returns detailed result info.
func (e *ConditionEvaluator) EvaluateWithResult(condition string, ctx *StepContext) (*ConditionResult, error) {
	result := &ConditionResult{
		Condition: condition,
	}

	// Empty condition means unconditional execution
	if condition == "" {
		result.ShouldExecute = true
		result.EvaluatedValue = "true"
		return result, nil
	}

	// Check for literal boolean strings
	trimmed := strings.TrimSpace(condition)
	if trimmed == "true" {
		result.ShouldExecute = true
		result.EvaluatedValue = "true"
		return result, nil
	}
	if trimmed == "false" {
		result.ShouldExecute = false
		result.Skipped = true
		result.EvaluatedValue = "false"
		return result, nil
	}

	// Check if it's a template variable
	if templatePattern.MatchString(condition) {
		evalValue, shouldExec, err := e.evaluateTemplateWithValue(condition, ctx)
		if err != nil {
			return nil, err
		}
		result.ShouldExecute = shouldExec
		result.Skipped = !shouldExec
		result.EvaluatedValue = evalValue
		return result, nil
	}

	return nil, &ConditionError{
		Condition: condition,
		Message:   "invalid condition format",
	}
}

// evaluateTemplateWithValue evaluates a template and returns both the evaluated string and boolean result.
func (e *ConditionEvaluator) evaluateTemplateWithValue(condition string, ctx *StepContext) (string, bool, error) {
	tmpl, err := template.New("condition").Parse(condition)
	if err != nil {
		return "", false, &ConditionError{
			Condition: condition,
			Message:   "failed to parse template",
			Cause:     err,
		}
	}

	var buf strings.Builder
	if err := tmpl.Execute(&buf, ctx.ToMap()); err != nil {
		return "", false, &ConditionError{
			Condition: condition,
			Message:   "failed to evaluate template",
			Cause:     err,
		}
	}

	result := buf.String()
	boolResult, err := e.coerceToBool(result, condition)
	if err != nil {
		return result, false, err
	}

	return result, boolResult, nil
}

// ShouldSkipStep determines if a step should be skipped based on its 'when' condition.
// Returns (skip, error) where skip=true means the step should not execute.
func ShouldSkipStep(when string, ctx *StepContext) (bool, error) {
	if when == "" {
		return false, nil // No condition = don't skip
	}

	evaluator := NewConditionEvaluator()
	shouldExecute, err := evaluator.Evaluate(when, ctx)
	if err != nil {
		return false, err
	}

	return !shouldExecute, nil
}
