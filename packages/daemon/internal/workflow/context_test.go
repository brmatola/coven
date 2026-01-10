package workflow

import (
	"testing"
)

func TestStoreStepOutput_Basic(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	result := &StepResult{
		Success:  true,
		Output:   "test output",
		ExitCode: 0,
	}

	err := ctx.StoreStepOutput("step1", result, "")
	if err != nil {
		t.Fatalf("StoreStepOutput() error: %v", err)
	}

	// Verify step output is stored
	val := ctx.GetVariable("step1")
	if val == nil {
		t.Fatal("Expected step1 to be stored")
	}

	stepOutput, ok := val.(*StepOutput)
	if !ok {
		t.Fatalf("Expected *StepOutput, got %T", val)
	}

	if stepOutput.Output != "test output" {
		t.Errorf("Output = %q, want %q", stepOutput.Output, "test output")
	}
	if stepOutput.Status != "success" {
		t.Errorf("Status = %q, want %q", stepOutput.Status, "success")
	}
	if stepOutput.ExitCode != 0 {
		t.Errorf("ExitCode = %d, want %d", stepOutput.ExitCode, 0)
	}
}

func TestStoreStepOutput_WithOutputName(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	result := &StepResult{
		Success: true,
		Output:  "findings data",
	}

	err := ctx.StoreStepOutput("review", result, "findings")
	if err != nil {
		t.Fatalf("StoreStepOutput() error: %v", err)
	}

	// Verify stored under both names
	if ctx.GetVariable("review") == nil {
		t.Error("Expected 'review' to be stored")
	}
	if ctx.GetVariable("findings") == nil {
		t.Error("Expected 'findings' to be stored")
	}

	// Verify both point to the same output
	review := ctx.GetVariable("review").(*StepOutput)
	findings := ctx.GetVariable("findings").(*StepOutput)
	if review.Output != findings.Output {
		t.Error("Expected review and findings to have same output")
	}
}

func TestStoreStepOutput_JSONParsing(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	result := &StepResult{
		Success: true,
		Output:  `{"issues": ["issue1", "issue2"], "count": 2}`,
	}

	err := ctx.StoreStepOutput("analyze", result, "")
	if err != nil {
		t.Fatalf("StoreStepOutput() error: %v", err)
	}

	stepOutput := ctx.GetVariable("analyze").(*StepOutput)
	if stepOutput.Outputs == nil {
		t.Fatal("Expected Outputs to be parsed")
	}

	issues, ok := stepOutput.Outputs["issues"].([]interface{})
	if !ok {
		t.Fatalf("Expected issues to be array, got %T", stepOutput.Outputs["issues"])
	}
	if len(issues) != 2 {
		t.Errorf("Expected 2 issues, got %d", len(issues))
	}
}

func TestStoreStepOutput_InvalidJSON(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	result := &StepResult{
		Success: true,
		Output:  "not json at all",
	}

	err := ctx.StoreStepOutput("step1", result, "")
	if err != nil {
		t.Fatalf("StoreStepOutput() error: %v", err)
	}

	stepOutput := ctx.GetVariable("step1").(*StepOutput)
	if stepOutput.Outputs != nil {
		t.Error("Expected Outputs to be nil for non-JSON output")
	}
	if stepOutput.Output != "not json at all" {
		t.Error("Expected raw output to be preserved")
	}
}

func TestStoreStepOutput_FailedStep(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	result := &StepResult{
		Success:  false,
		Output:   "error message",
		ExitCode: 1,
	}

	err := ctx.StoreStepOutput("step1", result, "")
	if err != nil {
		t.Fatalf("StoreStepOutput() error: %v", err)
	}

	stepOutput := ctx.GetVariable("step1").(*StepOutput)
	if stepOutput.Status != "failed" {
		t.Errorf("Status = %q, want %q", stepOutput.Status, "failed")
	}
	if stepOutput.ExitCode != 1 {
		t.Errorf("ExitCode = %d, want %d", stepOutput.ExitCode, 1)
	}
}

func TestStoreStepOutput_Immutability(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	result1 := &StepResult{Success: true, Output: "first"}
	result2 := &StepResult{Success: true, Output: "second"}

	err := ctx.StoreStepOutput("step1", result1, "")
	if err != nil {
		t.Fatalf("First StoreStepOutput() error: %v", err)
	}

	// Attempt to overwrite
	err = ctx.StoreStepOutput("step1", result2, "")
	if err == nil {
		t.Fatal("Expected error when overwriting existing step output")
	}

	if !IsContextError(err) {
		t.Errorf("Expected ContextError, got %T", err)
	}

	// Verify original value preserved
	stepOutput := ctx.GetVariable("step1").(*StepOutput)
	if stepOutput.Output != "first" {
		t.Errorf("Output = %q, want %q (original)", stepOutput.Output, "first")
	}
}

func TestStoreStepOutput_EmptyName(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	result := &StepResult{Success: true, Output: "test"}
	err := ctx.StoreStepOutput("", result, "")

	if err == nil {
		t.Fatal("Expected error for empty step name")
	}
	if !IsContextError(err) {
		t.Errorf("Expected ContextError, got %T", err)
	}
}

func TestStoreStepOutput_OutputNameConflict(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	result1 := &StepResult{Success: true, Output: "first"}
	result2 := &StepResult{Success: true, Output: "second"}

	// Store first step
	err := ctx.StoreStepOutput("step1", result1, "output")
	if err != nil {
		t.Fatalf("First StoreStepOutput() error: %v", err)
	}

	// Try to use same output name
	err = ctx.StoreStepOutput("step2", result2, "output")
	if err == nil {
		t.Fatal("Expected error when output name already exists")
	}
}

func TestSetBead(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	bead := &BeadData{
		ID:       "coven-abc",
		Title:    "Test Bead",
		Body:     "Description here",
		Type:     "task",
		Priority: "P1",
		Labels:   []string{"bug", "urgent"},
	}

	ctx.SetBead(bead)

	retrieved := ctx.GetBead()
	if retrieved == nil {
		t.Fatal("Expected bead to be stored")
	}
	if retrieved.ID != "coven-abc" {
		t.Errorf("ID = %q, want %q", retrieved.ID, "coven-abc")
	}
	if retrieved.Title != "Test Bead" {
		t.Errorf("Title = %q, want %q", retrieved.Title, "Test Bead")
	}
}

func TestGetBead_NoBead(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	bead := ctx.GetBead()
	if bead != nil {
		t.Error("Expected nil when no bead set")
	}
}

func TestSetLoopVariable(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	ctx.SetLoopVariable("retry_loop", 3)

	loopVar := ctx.GetVariable("retry_loop")
	if loopVar == nil {
		t.Fatal("Expected loop variable to be stored")
	}

	loopMap, ok := loopVar.(map[string]interface{})
	if !ok {
		t.Fatalf("Expected map, got %T", loopVar)
	}

	if loopMap["iteration"] != 3 {
		t.Errorf("iteration = %v, want %v", loopMap["iteration"], 3)
	}
}

func TestGetPath_Simple(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	ctx.SetBead(&BeadData{
		ID:    "coven-xyz",
		Title: "My Title",
	})

	// Get entire bead
	val, err := ctx.GetPath("bead")
	if err != nil {
		t.Fatalf("GetPath(bead) error: %v", err)
	}
	if val == nil {
		t.Fatal("Expected bead value")
	}
}

func TestGetPath_BeadFields(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	ctx.SetBead(&BeadData{
		ID:       "coven-xyz",
		Title:    "My Title",
		Body:     "Description",
		Type:     "feature",
		Priority: "P2",
		Labels:   []string{"label1"},
	})

	tests := []struct {
		path     string
		expected interface{}
	}{
		{"bead.id", "coven-xyz"},
		{"bead.title", "My Title"},
		{"bead.body", "Description"},
		{"bead.type", "feature"},
		{"bead.priority", "P2"},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			val, err := ctx.GetPath(tt.path)
			if err != nil {
				t.Fatalf("GetPath(%q) error: %v", tt.path, err)
			}
			if val != tt.expected {
				t.Errorf("GetPath(%q) = %v, want %v", tt.path, val, tt.expected)
			}
		})
	}
}

func TestGetPath_StepOutput(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	result := &StepResult{
		Success:  true,
		Output:   `{"issues": ["a", "b"]}`,
		ExitCode: 0,
	}
	_ = ctx.StoreStepOutput("review", result, "")

	tests := []struct {
		path     string
		expected interface{}
	}{
		{"review.output", `{"issues": ["a", "b"]}`},
		{"review.status", "success"},
		{"review.exit_code", 0},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			val, err := ctx.GetPath(tt.path)
			if err != nil {
				t.Fatalf("GetPath(%q) error: %v", tt.path, err)
			}
			if val != tt.expected {
				t.Errorf("GetPath(%q) = %v, want %v", tt.path, val, tt.expected)
			}
		})
	}
}

func TestGetPath_DeepAccess(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	result := &StepResult{
		Success: true,
		Output:  `{"findings": {"critical": 2, "warnings": 5}, "passed": true}`,
	}
	_ = ctx.StoreStepOutput("analyze", result, "")

	// Access nested fields
	val, err := ctx.GetPath("analyze.outputs.findings")
	if err != nil {
		t.Fatalf("GetPath() error: %v", err)
	}

	findings, ok := val.(map[string]interface{})
	if !ok {
		t.Fatalf("Expected map, got %T", val)
	}
	if findings["critical"] != float64(2) {
		t.Errorf("critical = %v, want %v", findings["critical"], 2)
	}
}

func TestGetPath_LoopVariable(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	ctx.SetLoopVariable("retry_loop", 5)

	val, err := ctx.GetPath("retry_loop.iteration")
	if err != nil {
		t.Fatalf("GetPath() error: %v", err)
	}
	if val != 5 {
		t.Errorf("iteration = %v, want %v", val, 5)
	}
}

func TestGetPath_Previous(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	ctx.SetPrevious(&StepResult{
		Success: true,
		Output:  "previous output",
	})

	tests := []struct {
		path     string
		expected interface{}
	}{
		{"previous.success", true},
		{"previous.failed", false},
		{"previous.output", "previous output"},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			val, err := ctx.GetPath(tt.path)
			if err != nil {
				t.Fatalf("GetPath(%q) error: %v", tt.path, err)
			}
			if val != tt.expected {
				t.Errorf("GetPath(%q) = %v, want %v", tt.path, val, tt.expected)
			}
		})
	}
}

func TestGetPath_NotFound(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	_, err := ctx.GetPath("nonexistent")
	if err == nil {
		t.Fatal("Expected error for nonexistent path")
	}
	if !IsContextError(err) {
		t.Errorf("Expected ContextError, got %T", err)
	}
}

func TestGetPath_EmptyPath(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	_, err := ctx.GetPath("")
	if err == nil {
		t.Fatal("Expected error for empty path")
	}
	if !IsContextError(err) {
		t.Errorf("Expected ContextError, got %T", err)
	}
}

func TestGetPath_InvalidField(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	ctx.SetBead(&BeadData{ID: "test"})

	_, err := ctx.GetPath("bead.nonexistent")
	if err == nil {
		t.Fatal("Expected error for invalid field")
	}
	if !IsContextError(err) {
		t.Errorf("Expected ContextError, got %T", err)
	}
}

func TestGetPath_OutputsNotJSON(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	result := &StepResult{
		Success: true,
		Output:  "plain text, not json",
	}
	_ = ctx.StoreStepOutput("step1", result, "")

	_, err := ctx.GetPath("step1.outputs.field")
	if err == nil {
		t.Fatal("Expected error when accessing outputs on non-JSON output")
	}
	if !IsContextError(err) {
		t.Errorf("Expected ContextError, got %T", err)
	}
}

func TestMustGetPath_Success(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	ctx.SetBead(&BeadData{Title: "Test"})

	val := ctx.MustGetPath("bead.title")
	if val != "Test" {
		t.Errorf("MustGetPath() = %v, want %v", val, "Test")
	}
}

func TestMustGetPath_Panic(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	defer func() {
		if r := recover(); r == nil {
			t.Error("Expected panic for invalid path")
		}
	}()

	_ = ctx.MustGetPath("nonexistent")
}

func TestGetPathString(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	ctx.SetBead(&BeadData{Title: "My Title"})
	ctx.SetVariable("count", 42)
	ctx.SetVariable("flag", true)

	tests := []struct {
		path     string
		expected string
	}{
		{"bead.title", "My Title"},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			val, err := ctx.GetPathString(tt.path)
			if err != nil {
				t.Fatalf("GetPathString(%q) error: %v", tt.path, err)
			}
			if val != tt.expected {
				t.Errorf("GetPathString(%q) = %q, want %q", tt.path, val, tt.expected)
			}
		})
	}
}

func TestGetPathInt(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	ctx.SetVariable("count", 42)
	ctx.SetVariable("float_count", 3.14)

	val, err := ctx.GetPathInt("count")
	if err != nil {
		t.Fatalf("GetPathInt() error: %v", err)
	}
	if val != 42 {
		t.Errorf("GetPathInt() = %d, want %d", val, 42)
	}
}

func TestGetPathInt_Invalid(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	ctx.SetVariable("text", "not a number")

	_, err := ctx.GetPathInt("text")
	if err == nil {
		t.Fatal("Expected error for non-int value")
	}
}

func TestGetPathBool(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	ctx.SetVariable("enabled", true)

	val, err := ctx.GetPathBool("enabled")
	if err != nil {
		t.Fatalf("GetPathBool() error: %v", err)
	}
	if val != true {
		t.Errorf("GetPathBool() = %v, want %v", val, true)
	}
}

func TestGetPathBool_Invalid(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	ctx.SetVariable("text", "not a bool")

	_, err := ctx.GetPathBool("text")
	if err == nil {
		t.Fatal("Expected error for non-bool value")
	}
}

func TestHasPath(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	ctx.SetBead(&BeadData{Title: "Test"})

	if !ctx.HasPath("bead") {
		t.Error("Expected HasPath(bead) to be true")
	}
	if !ctx.HasPath("bead.title") {
		t.Error("Expected HasPath(bead.title) to be true")
	}
	if ctx.HasPath("nonexistent") {
		t.Error("Expected HasPath(nonexistent) to be false")
	}
}

func TestToMap(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	ctx.SetBead(&BeadData{ID: "test"})
	ctx.SetVariable("custom", "value")

	m := ctx.ToMap()

	if m["bead"] == nil {
		t.Error("Expected bead in map")
	}
	if m["custom"] != "value" {
		t.Errorf("custom = %v, want %v", m["custom"], "value")
	}

	// Verify it's a copy
	m["custom"] = "modified"
	if ctx.GetVariable("custom") != "value" {
		t.Error("ToMap should return a copy, not modify original")
	}
}

func TestContextError_Error(t *testing.T) {
	err := &ContextError{Path: "bead.title", Message: "not found"}
	expected := `context error at "bead.title": not found`

	if err.Error() != expected {
		t.Errorf("Error() = %q, want %q", err.Error(), expected)
	}
}

func TestIsContextError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{
			name:     "ContextError",
			err:      &ContextError{Path: "test", Message: "error"},
			expected: true,
		},
		{
			name:     "nil",
			err:      nil,
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsContextError(tt.err); got != tt.expected {
				t.Errorf("IsContextError() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestValueToString_Types(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	ctx.SetVariable("str", "hello")
	ctx.SetVariable("int", 42)
	ctx.SetVariable("int64", int64(100))
	ctx.SetVariable("float", 3.14)
	ctx.SetVariable("bool_true", true)
	ctx.SetVariable("bool_false", false)
	ctx.SetVariable("bytes", []byte("bytes"))
	ctx.SetVariable("nil_val", nil)

	tests := []struct {
		path     string
		expected string
	}{
		{"str", "hello"},
		{"int", "42"},
		{"int64", "100"},
		{"float", "3.14"},
		{"bool_true", "true"},
		{"bool_false", "false"},
		{"bytes", "bytes"},
		{"nil_val", ""},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			val, err := ctx.GetPathString(tt.path)
			if err != nil {
				t.Fatalf("GetPathString(%q) error: %v", tt.path, err)
			}
			if val != tt.expected {
				t.Errorf("GetPathString(%q) = %q, want %q", tt.path, val, tt.expected)
			}
		})
	}
}

func TestGetPath_BeadExtra(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	ctx.SetBead(&BeadData{
		ID:    "test",
		Extra: map[string]interface{}{"custom_field": "custom_value"},
	})

	val, err := ctx.GetPath("bead.custom_field")
	if err != nil {
		t.Fatalf("GetPath() error: %v", err)
	}
	if val != "custom_value" {
		t.Errorf("GetPath() = %v, want %v", val, "custom_value")
	}
}

func TestGetPath_BeadLabels(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	ctx.SetBead(&BeadData{
		ID:     "test",
		Labels: []string{"bug", "urgent"},
	})

	val, err := ctx.GetPath("bead.labels")
	if err != nil {
		t.Fatalf("GetPath() error: %v", err)
	}

	labels, ok := val.([]string)
	if !ok {
		t.Fatalf("Expected []string, got %T", val)
	}
	if len(labels) != 2 {
		t.Errorf("Expected 2 labels, got %d", len(labels))
	}
}

func TestGetPath_ArrayField(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	result := &StepResult{
		Success: true,
		Output:  `{"items": ["a", "b", "c"]}`,
	}
	_ = ctx.StoreStepOutput("step1", result, "")

	// Accessing array element by field should error
	_, err := ctx.GetPath("step1.outputs.items.0")
	if err == nil {
		t.Fatal("Expected error when accessing field on array")
	}
}

func TestGetPath_DeepNestedJSON(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	result := &StepResult{
		Success: true,
		Output:  `{"level1": {"level2": {"level3": "deep value"}}}`,
	}
	_ = ctx.StoreStepOutput("nested", result, "")

	val, err := ctx.GetPath("nested.outputs.level1.level2.level3")
	if err != nil {
		t.Fatalf("GetPath() error: %v", err)
	}
	if val != "deep value" {
		t.Errorf("GetPath() = %v, want %v", val, "deep value")
	}
}

func TestGetPath_StepOutputUnknownField(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	result := &StepResult{Success: true, Output: "test"}
	_ = ctx.StoreStepOutput("step1", result, "")

	_, err := ctx.GetPath("step1.unknown_field")
	if err == nil {
		t.Fatal("Expected error for unknown step output field")
	}
}

func TestGetPathInt_Float64(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	// JSON numbers are parsed as float64
	result := &StepResult{
		Success: true,
		Output:  `{"count": 42}`,
	}
	_ = ctx.StoreStepOutput("step1", result, "")

	val, err := ctx.GetPath("step1.outputs.count")
	if err != nil {
		t.Fatalf("GetPath() error: %v", err)
	}

	// JSON numbers come as float64
	if val != float64(42) {
		t.Errorf("GetPath() = %v (%T), want float64(42)", val, val)
	}
}

func TestGetPathString_ComplexType(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	result := &StepResult{
		Success: true,
		Output:  `{"data": {"key": "value"}}`,
	}
	_ = ctx.StoreStepOutput("step1", result, "")

	// Complex type should be JSON marshaled
	val, err := ctx.GetPathString("step1.outputs.data")
	if err != nil {
		t.Fatalf("GetPathString() error: %v", err)
	}

	if val != `{"key":"value"}` {
		t.Errorf("GetPathString() = %q, want %q", val, `{"key":"value"}`)
	}
}

func TestGetPathInt_Int64(t *testing.T) {
	ctx := NewStepContext("/worktree", "bead-123", "workflow-456")

	ctx.SetVariable("big", int64(9999999999))

	val, err := ctx.GetPathInt("big")
	if err != nil {
		t.Fatalf("GetPathInt() error: %v", err)
	}
	if val != 9999999999 {
		t.Errorf("GetPathInt() = %d, want %d", val, 9999999999)
	}
}
