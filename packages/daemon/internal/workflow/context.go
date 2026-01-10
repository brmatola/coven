package workflow

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// StepOutput represents the stored output from a step execution.
type StepOutput struct {
	// Output is the raw output string from the step.
	Output string `json:"output"`

	// Outputs is the parsed structured output (if JSON).
	Outputs map[string]interface{} `json:"outputs,omitempty"`

	// Status is the step execution status.
	Status string `json:"status"`

	// ExitCode is the exit code for script steps.
	ExitCode int `json:"exit_code,omitempty"`
}

// BeadData contains bead information available in workflow context.
type BeadData struct {
	ID       string                 `json:"id"`
	Title    string                 `json:"title"`
	Body     string                 `json:"body"`
	Type     string                 `json:"type"`
	Priority string                 `json:"priority"`
	Labels   []string               `json:"labels,omitempty"`
	Extra    map[string]interface{} `json:"extra,omitempty"`
}

// ContextError represents an error accessing workflow context.
type ContextError struct {
	Path    string
	Message string
}

func (e *ContextError) Error() string {
	return fmt.Sprintf("context error at %q: %s", e.Path, e.Message)
}

// IsContextError checks if an error is a ContextError.
func IsContextError(err error) bool {
	var ce *ContextError
	return errors.As(err, &ce)
}

// StoreStepOutput stores a step's result in the context under the step name.
// If outputName is provided, the output is also stored under that alias.
// This operation is append-only - existing step outputs cannot be overwritten.
func (c *StepContext) StoreStepOutput(stepName string, result *StepResult, outputName string) error {
	if stepName == "" {
		return &ContextError{Path: stepName, Message: "step name cannot be empty"}
	}

	// Check if step output already exists (immutability)
	if _, exists := c.Variables[stepName]; exists {
		return &ContextError{Path: stepName, Message: "step output already exists and cannot be overwritten"}
	}

	// Create step output
	output := &StepOutput{
		Output:   result.Output,
		ExitCode: result.ExitCode,
	}

	if result.Success {
		output.Status = "success"
	} else {
		output.Status = "failed"
	}

	// Try to parse output as JSON for structured access
	if result.Output != "" {
		var parsed map[string]interface{}
		if err := json.Unmarshal([]byte(result.Output), &parsed); err == nil {
			output.Outputs = parsed
		}
	}

	// Store under step name
	c.Variables[stepName] = output

	// Also store under output alias if provided
	if outputName != "" && outputName != stepName {
		if _, exists := c.Variables[outputName]; exists {
			return &ContextError{Path: outputName, Message: "output name already exists and cannot be overwritten"}
		}
		c.Variables[outputName] = output
	}

	return nil
}

// SetBead stores bead data in the context.
func (c *StepContext) SetBead(bead *BeadData) {
	c.Variables["bead"] = bead
}

// GetBead retrieves bead data from the context.
func (c *StepContext) GetBead() *BeadData {
	if bead, ok := c.Variables["bead"].(*BeadData); ok {
		return bead
	}
	return nil
}

// SetLoopVariable sets the loop iteration variable in the context.
// The variable is stored as loop_name.iteration for access via {{.loop_name.iteration}}.
func (c *StepContext) SetLoopVariable(loopName string, iteration int) {
	c.Variables[loopName] = map[string]interface{}{
		"iteration": iteration,
	}
}

// GetPath resolves a dot-notation path to retrieve a value from the context.
// Supports paths like:
//   - "bead" - returns the entire bead object
//   - "bead.title" - returns the bead title
//   - "step_name.output" - returns the step's raw output
//   - "step_name.outputs.field" - returns a specific field from parsed JSON
//   - "previous.success" - returns whether previous step succeeded
//   - "loop_name.iteration" - returns current loop iteration
//
// Returns an error if the path is invalid or the value doesn't exist.
func (c *StepContext) GetPath(path string) (interface{}, error) {
	if path == "" {
		return nil, &ContextError{Path: path, Message: "path cannot be empty"}
	}

	parts := strings.Split(path, ".")
	if len(parts) == 0 {
		return nil, &ContextError{Path: path, Message: "invalid path"}
	}

	// Get the root value
	root, exists := c.Variables[parts[0]]
	if !exists {
		return nil, &ContextError{Path: path, Message: fmt.Sprintf("variable %q not found", parts[0])}
	}

	// If only one part, return the root
	if len(parts) == 1 {
		return root, nil
	}

	// Navigate the path
	return resolvePath(root, parts[1:], path)
}

// MustGetPath is like GetPath but panics on error.
// Use only when you're certain the path exists.
func (c *StepContext) MustGetPath(path string) interface{} {
	val, err := c.GetPath(path)
	if err != nil {
		panic(err)
	}
	return val
}

// GetPathString resolves a path and returns the value as a string.
// Returns an error if the path is invalid or the value cannot be converted to string.
func (c *StepContext) GetPathString(path string) (string, error) {
	val, err := c.GetPath(path)
	if err != nil {
		return "", err
	}
	return valueToString(val, path)
}

// GetPathInt resolves a path and returns the value as an int.
// Returns an error if the path is invalid or the value cannot be converted to int.
func (c *StepContext) GetPathInt(path string) (int, error) {
	val, err := c.GetPath(path)
	if err != nil {
		return 0, err
	}

	switch v := val.(type) {
	case int:
		return v, nil
	case int64:
		return int(v), nil
	case float64:
		return int(v), nil
	default:
		return 0, &ContextError{Path: path, Message: fmt.Sprintf("cannot convert %T to int", val)}
	}
}

// GetPathBool resolves a path and returns the value as a bool.
// Returns an error if the path is invalid or the value cannot be converted to bool.
func (c *StepContext) GetPathBool(path string) (bool, error) {
	val, err := c.GetPath(path)
	if err != nil {
		return false, err
	}

	if b, ok := val.(bool); ok {
		return b, nil
	}
	return false, &ContextError{Path: path, Message: fmt.Sprintf("cannot convert %T to bool", val)}
}

// HasPath checks if a path exists in the context.
func (c *StepContext) HasPath(path string) bool {
	_, err := c.GetPath(path)
	return err == nil
}

// ToMap returns a copy of all context variables as a map.
// This is useful for template rendering. Struct types are converted to maps
// so templates can access nested fields.
func (c *StepContext) ToMap() map[string]interface{} {
	result := make(map[string]interface{})
	for k, v := range c.Variables {
		result[k] = toTemplateValue(v)
	}
	return result
}

// toTemplateValue converts a value to a form usable by templates.
// Struct types are converted to maps so nested field access works.
func toTemplateValue(v interface{}) interface{} {
	switch val := v.(type) {
	case *StepOutput:
		m := map[string]interface{}{
			"output":    val.Output,
			"status":    val.Status,
			"exit_code": val.ExitCode,
		}
		if val.Outputs != nil {
			m["outputs"] = val.Outputs
		}
		return m
	case *BeadData:
		m := map[string]interface{}{
			"id":       val.ID,
			"title":    val.Title,
			"body":     val.Body,
			"type":     val.Type,
			"priority": val.Priority,
			"labels":   val.Labels,
		}
		if val.Extra != nil {
			for k, ev := range val.Extra {
				m[k] = ev
			}
		}
		return m
	default:
		return v
	}
}

// resolvePath navigates through a value following the path parts.
func resolvePath(current interface{}, parts []string, fullPath string) (interface{}, error) {
	for i, part := range parts {
		if current == nil {
			return nil, &ContextError{
				Path:    fullPath,
				Message: fmt.Sprintf("nil value at %q", strings.Join(parts[:i], ".")),
			}
		}

		switch v := current.(type) {
		case *StepOutput:
			// Handle StepOutput fields
			switch part {
			case "output":
				current = v.Output
			case "outputs":
				if v.Outputs == nil {
					return nil, &ContextError{
						Path:    fullPath,
						Message: "step output was not valid JSON",
					}
				}
				current = v.Outputs
			case "status":
				current = v.Status
			case "exit_code":
				current = v.ExitCode
			default:
				return nil, &ContextError{
					Path:    fullPath,
					Message: fmt.Sprintf("unknown field %q on step output", part),
				}
			}

		case *BeadData:
			// Handle BeadData fields
			switch part {
			case "id":
				current = v.ID
			case "title":
				current = v.Title
			case "body":
				current = v.Body
			case "type":
				current = v.Type
			case "priority":
				current = v.Priority
			case "labels":
				current = v.Labels
			default:
				// Check Extra for unknown fields
				if v.Extra != nil {
					if val, ok := v.Extra[part]; ok {
						current = val
						continue
					}
				}
				return nil, &ContextError{
					Path:    fullPath,
					Message: fmt.Sprintf("unknown field %q on bead", part),
				}
			}

		case map[string]interface{}:
			val, ok := v[part]
			if !ok {
				return nil, &ContextError{
					Path:    fullPath,
					Message: fmt.Sprintf("field %q not found", part),
				}
			}
			current = val

		case []interface{}:
			return nil, &ContextError{
				Path:    fullPath,
				Message: "cannot access field on array (use index syntax)",
			}

		default:
			return nil, &ContextError{
				Path:    fullPath,
				Message: fmt.Sprintf("cannot access field %q on %T", part, current),
			}
		}
	}

	return current, nil
}

// valueToString converts a value to its string representation.
func valueToString(val interface{}, path string) (string, error) {
	switch v := val.(type) {
	case string:
		return v, nil
	case bool:
		if v {
			return "true", nil
		}
		return "false", nil
	case int:
		return fmt.Sprintf("%d", v), nil
	case int64:
		return fmt.Sprintf("%d", v), nil
	case float64:
		return fmt.Sprintf("%v", v), nil
	case []byte:
		return string(v), nil
	case nil:
		return "", nil
	default:
		// Try JSON marshaling for complex types
		bytes, err := json.Marshal(v)
		if err != nil {
			return "", &ContextError{Path: path, Message: fmt.Sprintf("cannot convert %T to string", val)}
		}
		return string(bytes), nil
	}
}
