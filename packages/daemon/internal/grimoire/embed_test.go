package grimoire

import (
	"testing"
)

func TestBuiltinImplementBeadGrimoire(t *testing.T) {
	// Test that the implement-bead grimoire is properly embedded
	loader := NewLoader(t.TempDir())
	grimoire, err := loader.Load("implement-bead")
	if err != nil {
		t.Fatalf("Failed to load implement-bead grimoire: %v", err)
	}

	// Verify basic structure
	if grimoire.Name != "implement-bead" {
		t.Errorf("Name = %q, want %q", grimoire.Name, "implement-bead")
	}
	if grimoire.Source != SourceBuiltIn {
		t.Errorf("Source = %q, want %q", grimoire.Source, SourceBuiltIn)
	}
	if grimoire.Description == "" {
		t.Error("Description should not be empty")
	}
	if grimoire.Timeout == "" {
		t.Error("Timeout should be set")
	}

	// Verify we have the expected steps
	if len(grimoire.Steps) != 3 {
		t.Fatalf("Expected 3 steps, got %d", len(grimoire.Steps))
	}

	// Step 1: implement
	step1 := grimoire.Steps[0]
	if step1.Name != "implement" {
		t.Errorf("Step 1 name = %q, want %q", step1.Name, "implement")
	}
	if step1.Type != StepTypeAgent {
		t.Errorf("Step 1 type = %q, want %q", step1.Type, StepTypeAgent)
	}
	if step1.Spell != "implement" {
		t.Errorf("Step 1 spell = %q, want %q", step1.Spell, "implement")
	}
	if step1.Output != "implementation" {
		t.Errorf("Step 1 output = %q, want %q", step1.Output, "implementation")
	}

	// Step 2: quality-loop
	step2 := grimoire.Steps[1]
	if step2.Name != "quality-loop" {
		t.Errorf("Step 2 name = %q, want %q", step2.Name, "quality-loop")
	}
	if step2.Type != StepTypeLoop {
		t.Errorf("Step 2 type = %q, want %q", step2.Type, StepTypeLoop)
	}
	if step2.MaxIterations != 3 {
		t.Errorf("Step 2 max_iterations = %d, want %d", step2.MaxIterations, 3)
	}
	if step2.OnMaxIterations != "block" {
		t.Errorf("Step 2 on_max_iterations = %q, want %q", step2.OnMaxIterations, "block")
	}
	if len(step2.Steps) != 6 {
		t.Fatalf("Expected 6 nested steps in quality-loop, got %d", len(step2.Steps))
	}

	// Check nested steps
	nestedSteps := step2.Steps

	// run-tests
	if nestedSteps[0].Name != "run-tests" {
		t.Errorf("Nested step 1 name = %q, want %q", nestedSteps[0].Name, "run-tests")
	}
	if nestedSteps[0].Type != StepTypeScript {
		t.Errorf("Nested step 1 type = %q, want %q", nestedSteps[0].Type, StepTypeScript)
	}
	if nestedSteps[0].OnFail != "continue" {
		t.Errorf("Nested step 1 on_fail = %q, want %q", nestedSteps[0].OnFail, "continue")
	}

	// fix-tests
	if nestedSteps[1].Name != "fix-tests" {
		t.Errorf("Nested step 2 name = %q, want %q", nestedSteps[1].Name, "fix-tests")
	}
	if nestedSteps[1].When == "" {
		t.Error("Nested step 2 should have a when condition")
	}
	if nestedSteps[1].Input["test_output"] == "" {
		t.Error("Nested step 2 should have test_output input")
	}

	// review
	if nestedSteps[2].Name != "review" {
		t.Errorf("Nested step 3 name = %q, want %q", nestedSteps[2].Name, "review")
	}
	if nestedSteps[2].Output != "findings" {
		t.Errorf("Nested step 3 output = %q, want %q", nestedSteps[2].Output, "findings")
	}

	// check-actionable
	if nestedSteps[3].Name != "check-actionable" {
		t.Errorf("Nested step 4 name = %q, want %q", nestedSteps[3].Name, "check-actionable")
	}
	if nestedSteps[3].Spell != "is-actionable" {
		t.Errorf("Nested step 4 spell = %q, want %q", nestedSteps[3].Spell, "is-actionable")
	}

	// apply-fixes
	if nestedSteps[4].Name != "apply-fixes" {
		t.Errorf("Nested step 5 name = %q, want %q", nestedSteps[4].Name, "apply-fixes")
	}
	if nestedSteps[4].When == "" {
		t.Error("Nested step 5 should have a when condition")
	}

	// final-test
	if nestedSteps[5].Name != "final-test" {
		t.Errorf("Nested step 6 name = %q, want %q", nestedSteps[5].Name, "final-test")
	}
	if nestedSteps[5].OnSuccess != "exit_loop" {
		t.Errorf("Nested step 6 on_success = %q, want %q", nestedSteps[5].OnSuccess, "exit_loop")
	}

	// Step 3: merge-changes
	step3 := grimoire.Steps[2]
	if step3.Name != "merge-changes" {
		t.Errorf("Step 3 name = %q, want %q", step3.Name, "merge-changes")
	}
	if step3.Type != StepTypeMerge {
		t.Errorf("Step 3 type = %q, want %q", step3.Type, StepTypeMerge)
	}
	if !step3.RequiresReview() {
		t.Error("Step 3 should require review")
	}
}

func TestBuiltinGrimoiresList(t *testing.T) {
	// Test that implement-bead is listed in available grimoires
	loader := NewLoader(t.TempDir())
	grimoires, err := loader.List()
	if err != nil {
		t.Fatalf("List() error: %v", err)
	}

	found := false
	for _, name := range grimoires {
		if name == "implement-bead" {
			found = true
			break
		}
	}

	if !found {
		t.Error("implement-bead should be in the list of available grimoires")
	}
}

func TestBuiltinImplementBeadValidation(t *testing.T) {
	// Test that the implement-bead grimoire validates correctly
	loader := NewLoader(t.TempDir())
	grimoire, err := loader.Load("implement-bead")
	if err != nil {
		t.Fatalf("Failed to load implement-bead grimoire: %v", err)
	}

	// Validate should pass
	if err := grimoire.Validate(); err != nil {
		t.Errorf("Grimoire validation failed: %v", err)
	}

	// Check timeout is valid
	timeout, err := grimoire.GetTimeout()
	if err != nil {
		t.Errorf("GetTimeout() error: %v", err)
	}
	if timeout <= 0 {
		t.Error("Timeout should be positive")
	}
}

func TestBuiltinImplementBeadSpellReferences(t *testing.T) {
	// Test that all spell references are valid names
	loader := NewLoader(t.TempDir())
	grimoire, err := loader.Load("implement-bead")
	if err != nil {
		t.Fatalf("Failed to load implement-bead grimoire: %v", err)
	}

	// Collect all spell references
	expectedSpells := map[string]bool{
		"implement":          true,
		"fix-tests":          true,
		"review":             true,
		"is-actionable":      true,
		"apply-review-fixes": true,
	}

	var checkSpells func([]Step)
	checkSpells = func(steps []Step) {
		for _, step := range steps {
			if step.Type == StepTypeAgent && step.Spell != "" {
				if !expectedSpells[step.Spell] {
					t.Errorf("Unexpected spell reference: %q", step.Spell)
				}
				delete(expectedSpells, step.Spell)
			}
			if len(step.Steps) > 0 {
				checkSpells(step.Steps)
			}
		}
	}

	checkSpells(grimoire.Steps)

	// All expected spells should have been found
	for spell := range expectedSpells {
		t.Errorf("Expected spell %q not found in grimoire", spell)
	}
}

func TestBuiltinSpecToBeadsGrimoire(t *testing.T) {
	// Test that the spec-to-beads grimoire is properly embedded
	loader := NewLoader(t.TempDir())
	grimoire, err := loader.Load("spec-to-beads")
	if err != nil {
		t.Fatalf("Failed to load spec-to-beads grimoire: %v", err)
	}

	// Verify basic structure
	if grimoire.Name != "spec-to-beads" {
		t.Errorf("Name = %q, want %q", grimoire.Name, "spec-to-beads")
	}
	if grimoire.Source != SourceBuiltIn {
		t.Errorf("Source = %q, want %q", grimoire.Source, SourceBuiltIn)
	}
	if grimoire.Description == "" {
		t.Error("Description should not be empty")
	}
	if grimoire.Timeout == "" {
		t.Error("Timeout should be set")
	}

	// Verify we have the expected steps
	if len(grimoire.Steps) != 3 {
		t.Fatalf("Expected 3 steps, got %d", len(grimoire.Steps))
	}

	// Step 1: analyze-spec
	step1 := grimoire.Steps[0]
	if step1.Name != "analyze-spec" {
		t.Errorf("Step 1 name = %q, want %q", step1.Name, "analyze-spec")
	}
	if step1.Type != StepTypeAgent {
		t.Errorf("Step 1 type = %q, want %q", step1.Type, StepTypeAgent)
	}
	if step1.Spell != "analyze-spec" {
		t.Errorf("Step 1 spell = %q, want %q", step1.Spell, "analyze-spec")
	}
	if step1.Output != "analysis" {
		t.Errorf("Step 1 output = %q, want %q", step1.Output, "analysis")
	}
	if step1.Input["spec_path"] == "" {
		t.Error("Step 1 should have spec_path input")
	}

	// Step 2: create-beads
	step2 := grimoire.Steps[1]
	if step2.Name != "create-beads" {
		t.Errorf("Step 2 name = %q, want %q", step2.Name, "create-beads")
	}
	if step2.Type != StepTypeAgent {
		t.Errorf("Step 2 type = %q, want %q", step2.Type, StepTypeAgent)
	}
	if step2.Spell != "create-beads" {
		t.Errorf("Step 2 spell = %q, want %q", step2.Spell, "create-beads")
	}
	if step2.Output != "beads" {
		t.Errorf("Step 2 output = %q, want %q", step2.Output, "beads")
	}
	if step2.Input["analysis"] == "" {
		t.Error("Step 2 should have analysis input")
	}
	if step2.Input["spec_path"] == "" {
		t.Error("Step 2 should have spec_path input")
	}

	// Step 3: validate-beads
	step3 := grimoire.Steps[2]
	if step3.Name != "validate-beads" {
		t.Errorf("Step 3 name = %q, want %q", step3.Name, "validate-beads")
	}
	if step3.Type != StepTypeScript {
		t.Errorf("Step 3 type = %q, want %q", step3.Type, StepTypeScript)
	}
	if step3.Command == "" {
		t.Error("Step 3 should have a command")
	}
	if step3.OnFail != "block" {
		t.Errorf("Step 3 on_fail = %q, want %q", step3.OnFail, "block")
	}
}

func TestBuiltinSpecToBeadsValidation(t *testing.T) {
	// Test that the spec-to-beads grimoire validates correctly
	loader := NewLoader(t.TempDir())
	grimoire, err := loader.Load("spec-to-beads")
	if err != nil {
		t.Fatalf("Failed to load spec-to-beads grimoire: %v", err)
	}

	// Validate should pass
	if err := grimoire.Validate(); err != nil {
		t.Errorf("Grimoire validation failed: %v", err)
	}

	// Check timeout is valid
	timeout, err := grimoire.GetTimeout()
	if err != nil {
		t.Errorf("GetTimeout() error: %v", err)
	}
	if timeout <= 0 {
		t.Error("Timeout should be positive")
	}
}

func TestBuiltinSpecToBeadsSpellReferences(t *testing.T) {
	// Test that all spell references are valid names
	loader := NewLoader(t.TempDir())
	grimoire, err := loader.Load("spec-to-beads")
	if err != nil {
		t.Fatalf("Failed to load spec-to-beads grimoire: %v", err)
	}

	// Collect all spell references
	expectedSpells := map[string]bool{
		"analyze-spec": true,
		"create-beads": true,
	}

	for _, step := range grimoire.Steps {
		if step.Type == StepTypeAgent && step.Spell != "" {
			if !expectedSpells[step.Spell] {
				t.Errorf("Unexpected spell reference: %q", step.Spell)
			}
			delete(expectedSpells, step.Spell)
		}
	}

	// All expected spells should have been found
	for spell := range expectedSpells {
		t.Errorf("Expected spell %q not found in grimoire", spell)
	}
}

func TestBuiltinGrimoiresListAll(t *testing.T) {
	// Test that both grimoires are listed
	loader := NewLoader(t.TempDir())
	grimoires, err := loader.List()
	if err != nil {
		t.Fatalf("List() error: %v", err)
	}

	expected := map[string]bool{
		"implement-bead": false,
		"spec-to-beads":  false,
	}

	for _, name := range grimoires {
		if _, ok := expected[name]; ok {
			expected[name] = true
		}
	}

	for name, found := range expected {
		if !found {
			t.Errorf("%q should be in the list of available grimoires", name)
		}
	}
}
