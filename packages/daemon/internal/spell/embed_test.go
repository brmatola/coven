package spell

import (
	"strings"
	"testing"
)

func TestBuiltinSpells_Implement(t *testing.T) {
	loader := NewLoader(t.TempDir())

	spell, err := loader.Load("implement")
	if err != nil {
		t.Fatalf("Load(implement) error: %v", err)
	}

	if spell.Name != "implement" {
		t.Errorf("Name = %q, want %q", spell.Name, "implement")
	}
	if spell.Source != SourceBuiltIn {
		t.Errorf("Source = %q, want %q", spell.Source, SourceBuiltIn)
	}

	// Check content has expected placeholders
	if !strings.Contains(spell.Content, "{{.bead.title}}") {
		t.Error("implement spell should contain {{.bead.title}}")
	}
	if !strings.Contains(spell.Content, "{{.bead.body}}") {
		t.Error("implement spell should contain {{.bead.body}}")
	}
}

func TestBuiltinSpells_FixTests(t *testing.T) {
	loader := NewLoader(t.TempDir())

	spell, err := loader.Load("fix-tests")
	if err != nil {
		t.Fatalf("Load(fix-tests) error: %v", err)
	}

	if spell.Source != SourceBuiltIn {
		t.Errorf("Source = %q, want %q", spell.Source, SourceBuiltIn)
	}

	if !strings.Contains(spell.Content, "{{.test_output}}") {
		t.Error("fix-tests spell should contain {{.test_output}}")
	}
}

func TestBuiltinSpells_Review(t *testing.T) {
	loader := NewLoader(t.TempDir())

	spell, err := loader.Load("review")
	if err != nil {
		t.Fatalf("Load(review) error: %v", err)
	}

	if spell.Source != SourceBuiltIn {
		t.Errorf("Source = %q, want %q", spell.Source, SourceBuiltIn)
	}

	// Should mention review criteria
	if !strings.Contains(spell.Content, "Correctness") {
		t.Error("review spell should mention Correctness")
	}
	if !strings.Contains(spell.Content, "Tests") {
		t.Error("review spell should mention Tests")
	}
}

func TestBuiltinSpells_IsActionable(t *testing.T) {
	loader := NewLoader(t.TempDir())

	spell, err := loader.Load("is-actionable")
	if err != nil {
		t.Fatalf("Load(is-actionable) error: %v", err)
	}

	if spell.Source != SourceBuiltIn {
		t.Errorf("Source = %q, want %q", spell.Source, SourceBuiltIn)
	}

	if !strings.Contains(spell.Content, "{{.findings") {
		t.Error("is-actionable spell should contain {{.findings}}")
	}
}

func TestBuiltinSpells_ApplyReviewFixes(t *testing.T) {
	loader := NewLoader(t.TempDir())

	spell, err := loader.Load("apply-review-fixes")
	if err != nil {
		t.Fatalf("Load(apply-review-fixes) error: %v", err)
	}

	if spell.Source != SourceBuiltIn {
		t.Errorf("Source = %q, want %q", spell.Source, SourceBuiltIn)
	}

	if !strings.Contains(spell.Content, "{{.issues") {
		t.Error("apply-review-fixes spell should contain {{.issues}}")
	}
}

func TestBuiltinSpells_AnalyzeSpec(t *testing.T) {
	loader := NewLoader(t.TempDir())

	spell, err := loader.Load("analyze-spec")
	if err != nil {
		t.Fatalf("Load(analyze-spec) error: %v", err)
	}

	if spell.Source != SourceBuiltIn {
		t.Errorf("Source = %q, want %q", spell.Source, SourceBuiltIn)
	}

	if !strings.Contains(spell.Content, "{{.spec_path") {
		t.Error("analyze-spec spell should contain {{.spec_path}}")
	}
	if !strings.Contains(spell.Content, "components") {
		t.Error("analyze-spec spell should mention components")
	}
}

func TestBuiltinSpells_CreateBeads(t *testing.T) {
	loader := NewLoader(t.TempDir())

	spell, err := loader.Load("create-beads")
	if err != nil {
		t.Fatalf("Load(create-beads) error: %v", err)
	}

	if spell.Source != SourceBuiltIn {
		t.Errorf("Source = %q, want %q", spell.Source, SourceBuiltIn)
	}

	if !strings.Contains(spell.Content, "{{.analysis") {
		t.Error("create-beads spell should contain {{.analysis}}")
	}
	if !strings.Contains(spell.Content, "bd create") {
		t.Error("create-beads spell should mention bd create")
	}
}

func TestBuiltinSpells_List(t *testing.T) {
	loader := NewLoader(t.TempDir())

	spells, err := loader.List()
	if err != nil {
		t.Fatalf("List() error: %v", err)
	}

	expected := []string{"implement", "fix-tests", "review", "is-actionable", "apply-review-fixes", "analyze-spec", "create-beads"}
	for _, name := range expected {
		found := false
		for _, s := range spells {
			if s == name {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("List() should include %q, got: %v", name, spells)
		}
	}
}

func TestBuiltinSpells_Render(t *testing.T) {
	loader := NewLoader(t.TempDir())
	renderer := NewRenderer()

	spell, err := loader.Load("implement")
	if err != nil {
		t.Fatalf("Load(implement) error: %v", err)
	}

	ctx := RenderContext{
		"bead": map[string]interface{}{
			"title": "Test Bead Title",
			"body":  "Test bead description",
		},
	}

	rendered, err := renderer.Render(spell, ctx)
	if err != nil {
		t.Fatalf("Render() error: %v", err)
	}

	if !strings.Contains(rendered, "Test Bead Title") {
		t.Error("Rendered spell should contain bead title")
	}
	if !strings.Contains(rendered, "Test bead description") {
		t.Error("Rendered spell should contain bead body")
	}
}

func TestBuiltinSpells_RenderFixTests(t *testing.T) {
	loader := NewLoader(t.TempDir())
	renderer := NewRenderer()

	spell, err := loader.Load("fix-tests")
	if err != nil {
		t.Fatalf("Load(fix-tests) error: %v", err)
	}

	ctx := RenderContext{
		"test_output": "FAIL: TestSomething\nExpected 1, got 2",
	}

	rendered, err := renderer.Render(spell, ctx)
	if err != nil {
		t.Fatalf("Render() error: %v", err)
	}

	if !strings.Contains(rendered, "FAIL: TestSomething") {
		t.Error("Rendered spell should contain test output")
	}
}
