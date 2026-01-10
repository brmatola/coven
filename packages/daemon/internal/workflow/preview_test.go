package workflow

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/coven/daemon/internal/grimoire"
)

func TestNewPreviewer(t *testing.T) {
	previewer := NewPreviewer("/path/to/.coven")

	if previewer == nil {
		t.Fatal("NewPreviewer returned nil")
	}
	if previewer.grimoireLoader == nil {
		t.Error("grimoireLoader should not be nil")
	}
	if previewer.spellLoader == nil {
		t.Error("spellLoader should not be nil")
	}
	if previewer.spellRenderer == nil {
		t.Error("spellRenderer should not be nil")
	}
}

func TestDefaultPreviewOptions(t *testing.T) {
	opts := DefaultPreviewOptions()

	if opts.MaxSpellPreviewLength != 500 {
		t.Errorf("MaxSpellPreviewLength = %d, want %d", opts.MaxSpellPreviewLength, 500)
	}
	if opts.IncludeFullSpells {
		t.Error("IncludeFullSpells should be false by default")
	}
	if opts.BeadData != nil {
		t.Error("BeadData should be nil by default")
	}
}

func TestPreviewer_Preview(t *testing.T) {
	tmpDir := t.TempDir()

	// Create grimoire directory
	grimoireDir := filepath.Join(tmpDir, "grimoires")
	if err := os.MkdirAll(grimoireDir, 0755); err != nil {
		t.Fatalf("Failed to create grimoire dir: %v", err)
	}

	// Create a simple grimoire
	grimoireContent := `name: test-workflow
description: Test workflow for preview

steps:
  - name: run-tests
    type: script
    command: npm test
    timeout: 5m
    on_fail: block

  - name: merge
    type: merge
`
	if err := os.WriteFile(filepath.Join(grimoireDir, "test-workflow.yaml"), []byte(grimoireContent), 0644); err != nil {
		t.Fatalf("Failed to write grimoire: %v", err)
	}

	previewer := NewPreviewer(tmpDir)
	result, err := previewer.Preview("test-workflow", nil)

	if err != nil {
		t.Fatalf("Preview() error: %v", err)
	}

	if result.GrimoireName != "test-workflow" {
		t.Errorf("GrimoireName = %q, want %q", result.GrimoireName, "test-workflow")
	}

	if len(result.Steps) != 2 {
		t.Fatalf("Expected 2 steps, got %d", len(result.Steps))
	}

	// Check first step
	step1 := result.Steps[0]
	if step1.Name != "run-tests" {
		t.Errorf("Step 1 name = %q, want %q", step1.Name, "run-tests")
	}
	if step1.Type != "script" {
		t.Errorf("Step 1 type = %q, want %q", step1.Type, "script")
	}
	if step1.Command != "npm test" {
		t.Errorf("Step 1 command = %q, want %q", step1.Command, "npm test")
	}
	if step1.Timeout != "5m" {
		t.Errorf("Step 1 timeout = %q, want %q", step1.Timeout, "5m")
	}

	// Check second step
	step2 := result.Steps[1]
	if step2.Type != "merge" {
		t.Errorf("Step 2 type = %q, want %q", step2.Type, "merge")
	}
	if !step2.RequiresReview {
		t.Error("Step 2 should require review by default")
	}
}

func TestPreviewer_Preview_WithLoopStep(t *testing.T) {
	tmpDir := t.TempDir()

	grimoireDir := filepath.Join(tmpDir, "grimoires")
	if err := os.MkdirAll(grimoireDir, 0755); err != nil {
		t.Fatalf("Failed to create grimoire dir: %v", err)
	}

	grimoireContent := `name: loop-workflow
description: Test workflow with loop
steps:
  - name: quality-loop
    type: loop
    max_iterations: 3
    on_max_iterations: block
    steps:
      - name: test
        type: script
        command: npm test
      - name: fix
        type: script
        command: npm run fix
        when: "{{.previous.failed}}"
`
	if err := os.WriteFile(filepath.Join(grimoireDir, "loop-workflow.yaml"), []byte(grimoireContent), 0644); err != nil {
		t.Fatalf("Failed to write grimoire: %v", err)
	}

	previewer := NewPreviewer(tmpDir)
	result, err := previewer.Preview("loop-workflow", nil)

	if err != nil {
		t.Fatalf("Preview() error: %v", err)
	}

	if len(result.Steps) != 1 {
		t.Fatalf("Expected 1 step, got %d", len(result.Steps))
	}

	loopStep := result.Steps[0]
	if loopStep.Type != "loop" {
		t.Errorf("Step type = %q, want %q", loopStep.Type, "loop")
	}
	if loopStep.MaxIterations != 3 {
		t.Errorf("MaxIterations = %d, want %d", loopStep.MaxIterations, 3)
	}
	if len(loopStep.NestedSteps) != 2 {
		t.Fatalf("Expected 2 nested steps, got %d", len(loopStep.NestedSteps))
	}

	// Check nested step has when condition
	fixStep := loopStep.NestedSteps[1]
	if fixStep.When != "{{.previous.failed}}" {
		t.Errorf("Nested step when = %q, want %q", fixStep.When, "{{.previous.failed}}")
	}
}

func TestPreviewer_Preview_InvalidGrimoire(t *testing.T) {
	tmpDir := t.TempDir()

	grimoireDir := filepath.Join(tmpDir, "grimoires")
	if err := os.MkdirAll(grimoireDir, 0755); err != nil {
		t.Fatalf("Failed to create grimoire dir: %v", err)
	}

	// Create grimoire with invalid step type - this will fail at load time
	grimoireContent := `name: invalid-workflow
description: Invalid workflow for testing
steps:
  - name: bad-step
    type: invalid
`
	if err := os.WriteFile(filepath.Join(grimoireDir, "invalid-workflow.yaml"), []byte(grimoireContent), 0644); err != nil {
		t.Fatalf("Failed to write grimoire: %v", err)
	}

	previewer := NewPreviewer(tmpDir)
	_, err := previewer.Preview("invalid-workflow", nil)

	// Should fail to load because step type is invalid
	if err == nil {
		t.Fatal("Expected error for grimoire with invalid step type")
	}
	if !strings.Contains(err.Error(), "invalid step type") {
		t.Errorf("Error = %q, expected to contain 'invalid step type'", err.Error())
	}
}

func TestPreviewer_Preview_GrimoireNotFound(t *testing.T) {
	tmpDir := t.TempDir()

	previewer := NewPreviewer(tmpDir)
	_, err := previewer.Preview("nonexistent", nil)

	if err == nil {
		t.Fatal("Expected error for nonexistent grimoire")
	}
}

func TestPreviewer_Preview_WithBeadData(t *testing.T) {
	tmpDir := t.TempDir()

	grimoireDir := filepath.Join(tmpDir, "grimoires")
	spellsDir := filepath.Join(tmpDir, "spells")
	if err := os.MkdirAll(grimoireDir, 0755); err != nil {
		t.Fatalf("Failed to create grimoire dir: %v", err)
	}
	if err := os.MkdirAll(spellsDir, 0755); err != nil {
		t.Fatalf("Failed to create spells dir: %v", err)
	}

	// Create a spell
	spellContent := `# Implement: {{.bead.title}}

{{.bead.body}}
`
	if err := os.WriteFile(filepath.Join(spellsDir, "implement.md"), []byte(spellContent), 0644); err != nil {
		t.Fatalf("Failed to write spell: %v", err)
	}

	// Create grimoire that uses the spell
	grimoireContent := `name: agent-workflow
description: Test workflow with agent step
steps:
  - name: implement
    type: agent
    spell: implement
    output: result
`
	if err := os.WriteFile(filepath.Join(grimoireDir, "agent-workflow.yaml"), []byte(grimoireContent), 0644); err != nil {
		t.Fatalf("Failed to write grimoire: %v", err)
	}

	previewer := NewPreviewer(tmpDir)
	opts := &PreviewOptions{
		BeadData: &BeadData{
			ID:    "coven-test",
			Title: "Test Feature",
			Body:  "Implement the test feature",
		},
		MaxSpellPreviewLength: 200,
	}

	result, err := previewer.Preview("agent-workflow", opts)

	if err != nil {
		t.Fatalf("Preview() error: %v", err)
	}

	if len(result.Steps) != 1 {
		t.Fatalf("Expected 1 step, got %d", len(result.Steps))
	}

	step := result.Steps[0]
	if step.SpellName != "implement" {
		t.Errorf("SpellName = %q, want %q", step.SpellName, "implement")
	}
	if step.SpellSource != "user" {
		t.Errorf("SpellSource = %q, want %q", step.SpellSource, "user")
	}
	if !strings.Contains(step.SpellPreview, "Test Feature") {
		t.Error("SpellPreview should contain bead title")
	}
}

func TestPreviewResult_ToJSON(t *testing.T) {
	result := &PreviewResult{
		GrimoireName:   "test",
		GrimoireSource: "user",
		Steps: []StepPreview{
			{Index: 1, Name: "step1", Type: "script"},
		},
		IsValid: true,
	}

	json, err := result.ToJSON()
	if err != nil {
		t.Fatalf("ToJSON() error: %v", err)
	}

	if !strings.Contains(json, "test") {
		t.Error("JSON should contain grimoire name")
	}
	if !strings.Contains(json, "step1") {
		t.Error("JSON should contain step name")
	}
}

func TestPreviewResult_ToText(t *testing.T) {
	result := &PreviewResult{
		GrimoireName:   "test-workflow",
		GrimoireSource: "user",
		Steps: []StepPreview{
			{
				Index:   1,
				Name:    "run-tests",
				Type:    "script",
				Command: "npm test",
				Timeout: "5m",
			},
			{
				Index:          2,
				Name:           "merge",
				Type:           "merge",
				RequiresReview: true,
			},
		},
		IsValid: true,
	}

	text := result.ToText()

	if !strings.Contains(text, "Grimoire: test-workflow") {
		t.Error("Text should contain grimoire name")
	}
	if !strings.Contains(text, "Step 1: run-tests") {
		t.Error("Text should contain step 1")
	}
	if !strings.Contains(text, "npm test") {
		t.Error("Text should contain command")
	}
	if !strings.Contains(text, "Validation: OK") {
		t.Error("Text should contain validation status")
	}
}

func TestPreviewResult_ToText_WithErrors(t *testing.T) {
	result := &PreviewResult{
		GrimoireName: "invalid",
		IsValid:      false,
		Errors: []PreviewError{
			{StepName: "step1", Field: "spell", Message: "spell not found"},
		},
	}

	text := result.ToText()

	if !strings.Contains(text, "FAILED") {
		t.Error("Text should contain FAILED for invalid")
	}
	if !strings.Contains(text, "spell not found") {
		t.Error("Text should contain error message")
	}
}

func TestValidateGrimoire(t *testing.T) {
	g := &grimoire.Grimoire{
		Name: "test",
		Steps: []grimoire.Step{
			{Name: "step1", Type: grimoire.StepTypeScript, Command: "echo test"},
		},
	}

	errors := ValidateGrimoire(g)
	if len(errors) != 0 {
		t.Errorf("Expected no errors, got %d", len(errors))
	}
}

func TestValidateGrimoire_Invalid(t *testing.T) {
	g := &grimoire.Grimoire{
		Name: "", // Invalid - empty name
		Steps: []grimoire.Step{
			{Name: "step1", Type: grimoire.StepTypeScript, Command: "echo"},
		},
	}

	errors := ValidateGrimoire(g)
	if len(errors) == 0 {
		t.Error("Expected validation errors for invalid grimoire")
	}
}

func TestValidateGrimoire_InvalidTimeout(t *testing.T) {
	g := &grimoire.Grimoire{
		Name: "test",
		Steps: []grimoire.Step{
			{Name: "step1", Type: grimoire.StepTypeScript, Command: "echo", Timeout: "invalid"},
		},
	}

	errors := ValidateGrimoire(g)
	if len(errors) == 0 {
		t.Error("Expected validation errors for invalid timeout")
	}

	hasTimeoutError := false
	for _, err := range errors {
		if err.Field == "timeout" {
			hasTimeoutError = true
			break
		}
	}
	if !hasTimeoutError {
		t.Error("Expected timeout field error")
	}
}

func TestStepPreview_Fields(t *testing.T) {
	preview := StepPreview{
		Index:           1,
		Name:            "test-step",
		Type:            "agent",
		Timeout:         "10m",
		When:            "{{.previous.success}}",
		SpellName:       "implement",
		SpellSource:     "builtin",
		SpellPreview:    "Test preview...",
		Output:          "result",
		MaxIterations:   3,
		OnMaxIterations: "block",
		RequiresReview:  true,
	}

	if preview.Index != 1 {
		t.Errorf("Index = %d, want %d", preview.Index, 1)
	}
	if preview.Name != "test-step" {
		t.Errorf("Name = %q, want %q", preview.Name, "test-step")
	}
	if preview.SpellName != "implement" {
		t.Errorf("SpellName = %q, want %q", preview.SpellName, "implement")
	}
}

func TestPreviewError_Fields(t *testing.T) {
	err := PreviewError{
		StepName: "step1",
		Field:    "spell",
		Message:  "not found",
		Line:     42,
	}

	if err.StepName != "step1" {
		t.Errorf("StepName = %q, want %q", err.StepName, "step1")
	}
	if err.Field != "spell" {
		t.Errorf("Field = %q, want %q", err.Field, "spell")
	}
	if err.Message != "not found" {
		t.Errorf("Message = %q, want %q", err.Message, "not found")
	}
	if err.Line != 42 {
		t.Errorf("Line = %d, want %d", err.Line, 42)
	}
}

func TestWriteStepText_Loop(t *testing.T) {
	var sb strings.Builder

	step := StepPreview{
		Index:         1,
		Name:          "quality-loop",
		Type:          "loop",
		MaxIterations: 3,
		NestedSteps: []StepPreview{
			{Index: 1, Name: "test", Type: "script", Command: "npm test"},
		},
	}

	writeStepText(&sb, step, 0)
	text := sb.String()

	if !strings.Contains(text, "quality-loop (loop)") {
		t.Error("Should contain loop step header")
	}
	if !strings.Contains(text, "Max Iterations: 3") {
		t.Error("Should contain max iterations")
	}
	if !strings.Contains(text, "test (script)") {
		t.Error("Should contain nested step")
	}
}

func TestWriteStepText_Agent(t *testing.T) {
	var sb strings.Builder

	step := StepPreview{
		Index:        1,
		Name:         "implement",
		Type:         "agent",
		SpellName:    "implement",
		SpellSource:  "builtin",
		SpellPreview: "# Implement feature\nThis is the spell",
		Output:       "result",
	}

	writeStepText(&sb, step, 0)
	text := sb.String()

	if !strings.Contains(text, "Spell: implement") {
		t.Error("Should contain spell name")
	}
	if !strings.Contains(text, "Output: result") {
		t.Error("Should contain output name")
	}
}
