package spell

import (
	"strings"
	"testing"
)

func TestNewRenderer(t *testing.T) {
	r := NewRenderer()
	if r == nil {
		t.Fatal("NewRenderer() returned nil")
	}
	if !r.options.MissingKeyError {
		t.Error("Default MissingKeyError should be true")
	}
}

func TestNewRendererWithOptions(t *testing.T) {
	opts := RenderOptions{MissingKeyError: false}
	r := NewRendererWithOptions(opts)
	if r.options.MissingKeyError {
		t.Error("MissingKeyError should be false")
	}
}

func TestRender_SimpleVariable(t *testing.T) {
	r := NewRenderer()
	spell := &Spell{
		Name:    "test",
		Content: "Hello, {{.name}}!",
	}
	ctx := RenderContext{
		"name": "World",
	}

	result, err := r.Render(spell, ctx)
	if err != nil {
		t.Fatalf("Render() error: %v", err)
	}

	expected := "Hello, World!"
	if result != expected {
		t.Errorf("Render() = %q, want %q", result, expected)
	}
}

func TestRender_MultipleVariables(t *testing.T) {
	r := NewRenderer()
	spell := &Spell{
		Name:    "test",
		Content: "Task: {{.title}}\nPriority: {{.priority}}\nAssigned to: {{.assignee}}",
	}
	ctx := RenderContext{
		"title":    "Fix Bug",
		"priority": 1,
		"assignee": "Alice",
	}

	result, err := r.Render(spell, ctx)
	if err != nil {
		t.Fatalf("Render() error: %v", err)
	}

	if !strings.Contains(result, "Fix Bug") {
		t.Error("Result should contain title")
	}
	if !strings.Contains(result, "Priority: 1") {
		t.Error("Result should contain priority")
	}
	if !strings.Contains(result, "Alice") {
		t.Error("Result should contain assignee")
	}
}

func TestRender_NestedVariables(t *testing.T) {
	r := NewRenderer()
	spell := &Spell{
		Name:    "test",
		Content: "Output: {{.step.outputs.value}}",
	}
	ctx := RenderContext{
		"step": map[string]interface{}{
			"outputs": map[string]interface{}{
				"value": "42",
			},
		},
	}

	result, err := r.Render(spell, ctx)
	if err != nil {
		t.Fatalf("Render() error: %v", err)
	}

	expected := "Output: 42"
	if result != expected {
		t.Errorf("Render() = %q, want %q", result, expected)
	}
}

func TestRender_DeepNesting(t *testing.T) {
	r := NewRenderer()
	spell := &Spell{
		Name:    "test",
		Content: "Deep: {{.findings.outputs.issues}}",
	}
	ctx := RenderContext{
		"findings": map[string]interface{}{
			"outputs": map[string]interface{}{
				"issues": "3 critical issues found",
			},
		},
	}

	result, err := r.Render(spell, ctx)
	if err != nil {
		t.Fatalf("Render() error: %v", err)
	}

	expected := "Deep: 3 critical issues found"
	if result != expected {
		t.Errorf("Render() = %q, want %q", result, expected)
	}
}

func TestRender_MissingVariable_Error(t *testing.T) {
	r := NewRenderer() // MissingKeyError = true by default
	spell := &Spell{
		Name:    "test",
		Content: "Value: {{.missing}}",
	}
	ctx := RenderContext{}

	_, err := r.Render(spell, ctx)
	if err == nil {
		t.Fatal("Render() should return error for missing variable")
	}

	if !IsRenderError(err) {
		t.Errorf("Expected TemplateRenderError, got: %T", err)
	}
}

func TestRender_MissingVariable_NoError(t *testing.T) {
	r := NewRendererWithOptions(RenderOptions{MissingKeyError: false})
	spell := &Spell{
		Name:    "test",
		Content: "Value: [{{.missing}}]",
	}
	ctx := RenderContext{}

	result, err := r.Render(spell, ctx)
	if err != nil {
		t.Fatalf("Render() error: %v", err)
	}

	// With MissingKeyError=false, missing keys render as empty/zero value
	if !strings.Contains(result, "Value: [") {
		t.Errorf("Result = %q, expected to contain 'Value: ['", result)
	}
}

func TestRender_NilSpell(t *testing.T) {
	r := NewRenderer()

	_, err := r.Render(nil, RenderContext{})
	if err == nil {
		t.Fatal("Render() should return error for nil spell")
	}

	expectedErr := "spell cannot be nil"
	if err.Error() != expectedErr {
		t.Errorf("Error = %q, want %q", err.Error(), expectedErr)
	}
}

func TestRender_NilContext(t *testing.T) {
	r := NewRenderer()
	spell := &Spell{
		Name:    "test",
		Content: "Static content",
	}

	result, err := r.Render(spell, nil)
	if err != nil {
		t.Fatalf("Render() error: %v", err)
	}

	if result != "Static content" {
		t.Errorf("Result = %q, want %q", result, "Static content")
	}
}

func TestRender_InvalidTemplateSyntax(t *testing.T) {
	r := NewRenderer()
	spell := &Spell{
		Name:    "test",
		Content: "Bad syntax: {{.unclosed",
	}

	_, err := r.Render(spell, RenderContext{})
	if err == nil {
		t.Fatal("Render() should return error for invalid template syntax")
	}

	if !IsParseError(err) {
		t.Errorf("Expected TemplateParseError, got: %T", err)
	}

	// Error should contain spell name
	if !strings.Contains(err.Error(), "test") {
		t.Error("Error should contain spell name")
	}
}

func TestRender_TemplateFunctions_Default(t *testing.T) {
	r := NewRendererWithOptions(RenderOptions{MissingKeyError: false})
	spell := &Spell{
		Name:    "test",
		Content: `Value: {{default "N/A" .value}}`,
	}

	tests := []struct {
		name     string
		ctx      RenderContext
		expected string
	}{
		{
			name:     "with value",
			ctx:      RenderContext{"value": "present"},
			expected: "Value: present",
		},
		{
			name:     "without value",
			ctx:      RenderContext{},
			expected: "Value: N/A",
		},
		{
			name:     "empty string value",
			ctx:      RenderContext{"value": ""},
			expected: "Value: N/A",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := r.Render(spell, tt.ctx)
			if err != nil {
				t.Fatalf("Render() error: %v", err)
			}
			if result != tt.expected {
				t.Errorf("Result = %q, want %q", result, tt.expected)
			}
		})
	}
}

func TestRender_TemplateFunctions_Join(t *testing.T) {
	r := NewRenderer()
	spell := &Spell{
		Name:    "test",
		Content: `Items: {{join ", " .items}}`,
	}

	tests := []struct {
		name     string
		items    interface{}
		expected string
	}{
		{
			name:     "string slice",
			items:    []string{"a", "b", "c"},
			expected: "Items: a, b, c",
		},
		{
			name:     "interface slice",
			items:    []interface{}{"x", 1, "y"},
			expected: "Items: x, 1, y",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := RenderContext{"items": tt.items}
			result, err := r.Render(spell, ctx)
			if err != nil {
				t.Fatalf("Render() error: %v", err)
			}
			if result != tt.expected {
				t.Errorf("Result = %q, want %q", result, tt.expected)
			}
		})
	}
}

func TestRender_TemplateFunctions_StringOps(t *testing.T) {
	r := NewRenderer()

	tests := []struct {
		name     string
		template string
		ctx      RenderContext
		expected string
	}{
		{
			name:     "upper",
			template: `{{upper .text}}`,
			ctx:      RenderContext{"text": "hello"},
			expected: "HELLO",
		},
		{
			name:     "lower",
			template: `{{lower .text}}`,
			ctx:      RenderContext{"text": "WORLD"},
			expected: "world",
		},
		{
			name:     "trim",
			template: `[{{trim .text}}]`,
			ctx:      RenderContext{"text": "  spaced  "},
			expected: "[spaced]",
		},
		{
			name:     "quote",
			template: `{{quote .text}}`,
			ctx:      RenderContext{"text": "hello"},
			expected: `"hello"`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spell := &Spell{Name: "test", Content: tt.template}
			result, err := r.Render(spell, tt.ctx)
			if err != nil {
				t.Fatalf("Render() error: %v", err)
			}
			if result != tt.expected {
				t.Errorf("Result = %q, want %q", result, tt.expected)
			}
		})
	}
}

func TestRender_TemplateFunctions_Indent(t *testing.T) {
	r := NewRenderer()
	spell := &Spell{
		Name:    "test",
		Content: `{{indent 4 .code}}`,
	}
	ctx := RenderContext{
		"code": "line1\nline2\nline3",
	}

	result, err := r.Render(spell, ctx)
	if err != nil {
		t.Fatalf("Render() error: %v", err)
	}

	expected := "    line1\n    line2\n    line3"
	if result != expected {
		t.Errorf("Result = %q, want %q", result, expected)
	}
}

func TestRender_TemplateControlFlow(t *testing.T) {
	r := NewRenderer()

	tests := []struct {
		name     string
		template string
		ctx      RenderContext
		expected string
	}{
		{
			name:     "if true",
			template: `{{if .show}}visible{{end}}`,
			ctx:      RenderContext{"show": true},
			expected: "visible",
		},
		{
			name:     "if false",
			template: `{{if .show}}visible{{end}}`,
			ctx:      RenderContext{"show": false},
			expected: "",
		},
		{
			name:     "if else",
			template: `{{if .show}}yes{{else}}no{{end}}`,
			ctx:      RenderContext{"show": false},
			expected: "no",
		},
		{
			name:     "range",
			template: `{{range .items}}[{{.}}]{{end}}`,
			ctx:      RenderContext{"items": []string{"a", "b", "c"}},
			expected: "[a][b][c]",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spell := &Spell{Name: "test", Content: tt.template}
			result, err := r.Render(spell, tt.ctx)
			if err != nil {
				t.Fatalf("Render() error: %v", err)
			}
			if result != tt.expected {
				t.Errorf("Result = %q, want %q", result, tt.expected)
			}
		})
	}
}

func TestRenderString(t *testing.T) {
	r := NewRenderer()

	result, err := r.RenderString("inline", "Hello, {{.name}}!", RenderContext{"name": "Test"})
	if err != nil {
		t.Fatalf("RenderString() error: %v", err)
	}

	expected := "Hello, Test!"
	if result != expected {
		t.Errorf("RenderString() = %q, want %q", result, expected)
	}
}

func TestTemplateParseError(t *testing.T) {
	err := &TemplateParseError{
		Name:    "myspell",
		Content: "{{bad",
		Err:     nil,
	}

	msg := err.Error()
	if !strings.Contains(msg, "myspell") {
		t.Error("Error message should contain spell name")
	}
	if !strings.Contains(msg, "failed to parse") {
		t.Error("Error message should indicate parse failure")
	}
}

func TestTemplateRenderError(t *testing.T) {
	err := &TemplateRenderError{
		Name: "myspell",
		Err:  nil,
	}

	msg := err.Error()
	if !strings.Contains(msg, "myspell") {
		t.Error("Error message should contain spell name")
	}
	if !strings.Contains(msg, "failed to render") {
		t.Error("Error message should indicate render failure")
	}
}

func TestIsParseError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{
			name:     "TemplateParseError",
			err:      &TemplateParseError{Name: "test"},
			expected: true,
		},
		{
			name:     "TemplateRenderError",
			err:      &TemplateRenderError{Name: "test"},
			expected: false,
		},
		{
			name:     "nil",
			err:      nil,
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsParseError(tt.err); got != tt.expected {
				t.Errorf("IsParseError() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestIsRenderError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{
			name:     "TemplateRenderError",
			err:      &TemplateRenderError{Name: "test"},
			expected: true,
		},
		{
			name:     "TemplateParseError",
			err:      &TemplateParseError{Name: "test"},
			expected: false,
		},
		{
			name:     "nil",
			err:      nil,
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsRenderError(tt.err); got != tt.expected {
				t.Errorf("IsRenderError() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestDefaultRenderOptions(t *testing.T) {
	opts := DefaultRenderOptions()
	if !opts.MissingKeyError {
		t.Error("DefaultRenderOptions should have MissingKeyError=true")
	}
}

func TestRender_CompleteSpell(t *testing.T) {
	r := NewRenderer()
	spell := &Spell{
		Name: "implement",
		Content: `# Implementation Task

## Task: {{.task.title}}

### Priority: {{.task.priority}}

### Description
{{.task.description}}

### Previous Findings
{{if .findings}}
{{range .findings}}
- {{.name}}: {{.summary}}
{{end}}
{{else}}
No previous findings.
{{end}}

### Instructions
1. Review the codebase
2. Implement the changes
3. Write tests
`,
	}

	ctx := RenderContext{
		"task": map[string]interface{}{
			"title":       "Add user authentication",
			"priority":    1,
			"description": "Implement OAuth2 login flow",
		},
		"findings": []map[string]interface{}{
			{"name": "security-review", "summary": "No critical issues"},
			{"name": "code-analysis", "summary": "Good structure"},
		},
	}

	result, err := r.Render(spell, ctx)
	if err != nil {
		t.Fatalf("Render() error: %v", err)
	}

	// Verify all parts are rendered
	checks := []string{
		"Add user authentication",
		"Priority: 1",
		"Implement OAuth2 login flow",
		"security-review: No critical issues",
		"code-analysis: Good structure",
		"Review the codebase",
	}

	for _, check := range checks {
		if !strings.Contains(result, check) {
			t.Errorf("Result should contain %q", check)
		}
	}
}

func TestRender_EmptySliceRange(t *testing.T) {
	r := NewRenderer()
	spell := &Spell{
		Name:    "test",
		Content: `Items:{{range .items}}[{{.}}]{{else}}none{{end}}`,
	}

	result, err := r.Render(spell, RenderContext{"items": []string{}})
	if err != nil {
		t.Fatalf("Render() error: %v", err)
	}

	if result != "Items:none" {
		t.Errorf("Result = %q, want %q", result, "Items:none")
	}
}

func TestRender_JoinNonSlice(t *testing.T) {
	r := NewRenderer()
	spell := &Spell{
		Name:    "test",
		Content: `Value: {{join ", " .value}}`,
	}

	result, err := r.Render(spell, RenderContext{"value": 42})
	if err != nil {
		t.Fatalf("Render() error: %v", err)
	}

	// Non-slice values should be stringified
	if result != "Value: 42" {
		t.Errorf("Result = %q, want %q", result, "Value: 42")
	}
}

func TestRender_IndentEmptyLines(t *testing.T) {
	r := NewRenderer()
	spell := &Spell{
		Name:    "test",
		Content: `{{indent 2 .text}}`,
	}

	// Empty lines should not get indented
	result, err := r.Render(spell, RenderContext{"text": "line1\n\nline3"})
	if err != nil {
		t.Fatalf("Render() error: %v", err)
	}

	expected := "  line1\n\n  line3"
	if result != expected {
		t.Errorf("Result = %q, want %q", result, expected)
	}
}
