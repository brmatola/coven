package spell

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPartialRenderer_Include(t *testing.T) {
	// Set up temp directory with spells
	tmpDir := t.TempDir()
	spellsDir := filepath.Join(tmpDir, "spells")
	if err := os.MkdirAll(spellsDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a partial
	if err := os.WriteFile(filepath.Join(spellsDir, "greeting.md"), []byte("Hello, {{.name}}!"), 0644); err != nil {
		t.Fatal(err)
	}

	loader := NewLoader(tmpDir)
	renderer := NewPartialRenderer(loader)

	// Test basic include
	spell := &Spell{
		Name:    "test",
		Content: `Start: {{include "greeting" "name" "World"}} End`,
	}

	result, err := renderer.Render(spell, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := "Start: Hello, World! End"
	if result != expected {
		t.Errorf("expected %q, got %q", expected, result)
	}
}

func TestPartialRenderer_IncludeWithContextVar(t *testing.T) {
	tmpDir := t.TempDir()
	spellsDir := filepath.Join(tmpDir, "spells")
	if err := os.MkdirAll(spellsDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a partial that uses a variable
	if err := os.WriteFile(filepath.Join(spellsDir, "task-info.md"), []byte("Task: {{.title}} ({{.priority}})"), 0644); err != nil {
		t.Fatal(err)
	}

	loader := NewLoader(tmpDir)
	renderer := NewPartialRenderer(loader)

	// Test include with context variable
	spell := &Spell{
		Name:    "test",
		Content: `{{include "task-info" "title" .bead.title "priority" .bead.priority}}`,
	}

	ctx := RenderContext{
		"bead": map[string]interface{}{
			"title":    "Fix the bug",
			"priority": "high",
		},
	}

	result, err := renderer.Render(spell, ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := "Task: Fix the bug (high)"
	if result != expected {
		t.Errorf("expected %q, got %q", expected, result)
	}
}

func TestPartialRenderer_IncludeInheritsContext(t *testing.T) {
	tmpDir := t.TempDir()
	spellsDir := filepath.Join(tmpDir, "spells")
	if err := os.MkdirAll(spellsDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a partial that uses parent context
	if err := os.WriteFile(filepath.Join(spellsDir, "helper.md"), []byte("User: {{.user}}, Value: {{.value}}"), 0644); err != nil {
		t.Fatal(err)
	}

	loader := NewLoader(tmpDir)
	renderer := NewPartialRenderer(loader)

	// Parent context should be available in partial
	spell := &Spell{
		Name:    "test",
		Content: `{{include "helper" "value" "42"}}`,
	}

	ctx := RenderContext{
		"user": "alice",
	}

	result, err := renderer.Render(spell, ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := "User: alice, Value: 42"
	if result != expected {
		t.Errorf("expected %q, got %q", expected, result)
	}
}

func TestPartialRenderer_NestedIncludes(t *testing.T) {
	tmpDir := t.TempDir()
	spellsDir := filepath.Join(tmpDir, "spells")
	if err := os.MkdirAll(spellsDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create nested partials
	if err := os.WriteFile(filepath.Join(spellsDir, "inner.md"), []byte("[{{.msg}}]"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(spellsDir, "outer.md"), []byte("Outer: {{include \"inner\" \"msg\" .text}}"), 0644); err != nil {
		t.Fatal(err)
	}

	loader := NewLoader(tmpDir)
	renderer := NewPartialRenderer(loader)

	spell := &Spell{
		Name:    "test",
		Content: `{{include "outer" "text" "hello"}}`,
	}

	result, err := renderer.Render(spell, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := "Outer: [hello]"
	if result != expected {
		t.Errorf("expected %q, got %q", expected, result)
	}
}

func TestPartialRenderer_CircularIncludeError(t *testing.T) {
	tmpDir := t.TempDir()
	spellsDir := filepath.Join(tmpDir, "spells")
	if err := os.MkdirAll(spellsDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create circular partials: a includes b, b includes a
	if err := os.WriteFile(filepath.Join(spellsDir, "a.md"), []byte(`A: {{include "b"}}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(spellsDir, "b.md"), []byte(`B: {{include "a"}}`), 0644); err != nil {
		t.Fatal(err)
	}

	loader := NewLoader(tmpDir)
	renderer := NewPartialRenderer(loader)

	spell := &Spell{
		Name:    "test",
		Content: `{{include "a"}}`,
	}

	_, err := renderer.Render(spell, nil)
	if err == nil {
		t.Fatal("expected circular include error")
	}

	if !strings.Contains(err.Error(), "circular include") {
		t.Errorf("expected circular include error, got: %v", err)
	}
}

func TestPartialRenderer_SelfIncludeError(t *testing.T) {
	tmpDir := t.TempDir()
	spellsDir := filepath.Join(tmpDir, "spells")
	if err := os.MkdirAll(spellsDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a partial that includes itself
	if err := os.WriteFile(filepath.Join(spellsDir, "self.md"), []byte(`Self: {{include "self"}}`), 0644); err != nil {
		t.Fatal(err)
	}

	loader := NewLoader(tmpDir)
	renderer := NewPartialRenderer(loader)

	spell := &Spell{
		Name:    "test",
		Content: `{{include "self"}}`,
	}

	_, err := renderer.Render(spell, nil)
	if err == nil {
		t.Fatal("expected circular include error")
	}

	if !strings.Contains(err.Error(), "circular include") {
		t.Errorf("expected circular include error, got: %v", err)
	}
}

func TestPartialRenderer_MaxDepthError(t *testing.T) {
	tmpDir := t.TempDir()
	spellsDir := filepath.Join(tmpDir, "spells")
	if err := os.MkdirAll(spellsDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a chain of includes that exceeds max depth
	// level0 -> level1 -> level2 -> level3 -> level4 -> level5 (exceeds depth 5)
	for i := 0; i < 6; i++ {
		content := ""
		if i < 5 {
			content = "Level" + string('0'+byte(i)) + ": {{include \"level" + string('0'+byte(i+1)) + "\"}}"
		} else {
			content = "Level5: end"
		}
		if err := os.WriteFile(filepath.Join(spellsDir, "level"+string('0'+byte(i))+".md"), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}

	loader := NewLoader(tmpDir)
	renderer := NewPartialRenderer(loader)

	spell := &Spell{
		Name:    "test",
		Content: `{{include "level0"}}`,
	}

	_, err := renderer.Render(spell, nil)
	if err == nil {
		t.Fatal("expected max depth error")
	}

	if !strings.Contains(err.Error(), "depth exceeded") {
		t.Errorf("expected max depth error, got: %v", err)
	}
}

func TestPartialRenderer_MissingPartialError(t *testing.T) {
	tmpDir := t.TempDir()
	spellsDir := filepath.Join(tmpDir, "spells")
	if err := os.MkdirAll(spellsDir, 0755); err != nil {
		t.Fatal(err)
	}

	loader := NewLoader(tmpDir)
	renderer := NewPartialRenderer(loader)

	spell := &Spell{
		Name:    "test",
		Content: `{{include "nonexistent"}}`,
	}

	_, err := renderer.Render(spell, nil)
	if err == nil {
		t.Fatal("expected error for missing partial")
	}

	if !strings.Contains(err.Error(), "spell not found") {
		t.Errorf("expected 'spell not found' error, got: %v", err)
	}
}

func TestPartialRenderer_IncludeNoArgs(t *testing.T) {
	tmpDir := t.TempDir()
	spellsDir := filepath.Join(tmpDir, "spells")
	if err := os.MkdirAll(spellsDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a partial with no required variables
	if err := os.WriteFile(filepath.Join(spellsDir, "static.md"), []byte("Static content"), 0644); err != nil {
		t.Fatal(err)
	}

	loader := NewLoader(tmpDir)
	renderer := NewPartialRenderer(loader)

	spell := &Spell{
		Name:    "test",
		Content: `{{include "static"}}`,
	}

	result, err := renderer.Render(spell, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := "Static content"
	if result != expected {
		t.Errorf("expected %q, got %q", expected, result)
	}
}

func TestPartialRenderer_IncludeOverridesParentVar(t *testing.T) {
	tmpDir := t.TempDir()
	spellsDir := filepath.Join(tmpDir, "spells")
	if err := os.MkdirAll(spellsDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a partial that uses 'name'
	if err := os.WriteFile(filepath.Join(spellsDir, "greeting.md"), []byte("Hello, {{.name}}!"), 0644); err != nil {
		t.Fatal(err)
	}

	loader := NewLoader(tmpDir)
	renderer := NewPartialRenderer(loader)

	spell := &Spell{
		Name:    "test",
		Content: `Before: {{.name}} | {{include "greeting" "name" "Override"}} | After: {{.name}}`,
	}

	ctx := RenderContext{
		"name": "Original",
	}

	result, err := renderer.Render(spell, ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// The override should only affect the partial, not the parent
	expected := "Before: Original | Hello, Override! | After: Original"
	if result != expected {
		t.Errorf("expected %q, got %q", expected, result)
	}
}

func TestPartialRenderer_WithoutLoader(t *testing.T) {
	// Test that regular rendering still works without partials
	renderer := NewPartialRenderer(nil)

	spell := &Spell{
		Name:    "test",
		Content: "Hello, {{.name}}!",
	}

	ctx := RenderContext{
		"name": "World",
	}

	result, err := renderer.Render(spell, ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := "Hello, World!"
	if result != expected {
		t.Errorf("expected %q, got %q", expected, result)
	}
}
