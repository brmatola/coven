package defaults

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInitialize_CreatesDefaults(t *testing.T) {
	tmpDir := t.TempDir()

	result, err := Initialize(tmpDir)
	if err != nil {
		t.Fatalf("Initialize failed: %v", err)
	}

	// Check that spells were copied
	if len(result.SpellsCopied) == 0 {
		t.Error("Expected some spells to be copied")
	}

	// Check that grimoires were copied
	if len(result.GrimoiresCopied) == 0 {
		t.Error("Expected some grimoires to be copied")
	}

	// Verify spell files exist
	spellsDir := filepath.Join(tmpDir, "spells")
	for _, name := range result.SpellsCopied {
		path := filepath.Join(spellsDir, name)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			t.Errorf("Spell file %s should exist", name)
		}
	}

	// Verify grimoire files exist
	grimoiresDir := filepath.Join(tmpDir, "grimoires")
	for _, name := range result.GrimoiresCopied {
		path := filepath.Join(grimoiresDir, name)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			t.Errorf("Grimoire file %s should exist", name)
		}
	}

	t.Logf("Copied %d spells: %v", len(result.SpellsCopied), result.SpellsCopied)
	t.Logf("Copied %d grimoires: %v", len(result.GrimoiresCopied), result.GrimoiresCopied)
}

func TestInitialize_DoesNotOverwrite(t *testing.T) {
	tmpDir := t.TempDir()

	// First, initialize to create defaults
	result1, err := Initialize(tmpDir)
	if err != nil {
		t.Fatalf("First Initialize failed: %v", err)
	}

	if len(result1.SpellsCopied) == 0 {
		t.Skip("No spells to test with")
	}

	// Modify one of the copied spells
	spellPath := filepath.Join(tmpDir, "spells", result1.SpellsCopied[0])
	customContent := "# Custom user content\nThis should NOT be overwritten\n"
	if err := os.WriteFile(spellPath, []byte(customContent), 0644); err != nil {
		t.Fatalf("Failed to write custom content: %v", err)
	}

	// Run initialize again
	result2, err := Initialize(tmpDir)
	if err != nil {
		t.Fatalf("Second Initialize failed: %v", err)
	}

	// All files should be skipped now
	if len(result2.SpellsCopied) != 0 {
		t.Errorf("Expected no spells to be copied on second run, got %d", len(result2.SpellsCopied))
	}
	if len(result2.GrimoiresCopied) != 0 {
		t.Errorf("Expected no grimoires to be copied on second run, got %d", len(result2.GrimoiresCopied))
	}

	// Verify custom content was preserved
	content, err := os.ReadFile(spellPath)
	if err != nil {
		t.Fatalf("Failed to read spell file: %v", err)
	}
	if string(content) != customContent {
		t.Error("Custom content was overwritten")
	}
}

func TestInitialize_SkipsExisting(t *testing.T) {
	tmpDir := t.TempDir()

	// Pre-create one spell with custom content
	spellsDir := filepath.Join(tmpDir, "spells")
	if err := os.MkdirAll(spellsDir, 0755); err != nil {
		t.Fatal(err)
	}

	customSpell := filepath.Join(spellsDir, "implement.md")
	if err := os.WriteFile(customSpell, []byte("# My custom implement"), 0644); err != nil {
		t.Fatal(err)
	}

	result, err := Initialize(tmpDir)
	if err != nil {
		t.Fatalf("Initialize failed: %v", err)
	}

	// implement.md should be skipped
	foundSkipped := false
	for _, name := range result.SpellsSkipped {
		if name == "implement.md" {
			foundSkipped = true
			break
		}
	}

	if !foundSkipped {
		t.Error("Expected implement.md to be in skipped list")
	}

	// Custom content should be preserved
	content, err := os.ReadFile(customSpell)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "# My custom implement" {
		t.Error("Custom content was overwritten")
	}
}

func TestSpellNames(t *testing.T) {
	names, err := SpellNames()
	if err != nil {
		t.Fatalf("SpellNames failed: %v", err)
	}

	if len(names) == 0 {
		t.Error("Expected some spell names")
	}

	t.Logf("Available spells: %v", names)

	// Check for expected spells
	expected := []string{"implement", "fix-tests", "review", "is-actionable", "apply-review-fixes"}
	for _, exp := range expected {
		found := false
		for _, name := range names {
			if name == exp {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Expected spell %q to be in list", exp)
		}
	}
}

func TestGrimoireNames(t *testing.T) {
	names, err := GrimoireNames()
	if err != nil {
		t.Fatalf("GrimoireNames failed: %v", err)
	}

	if len(names) == 0 {
		t.Error("Expected some grimoire names")
	}

	t.Logf("Available grimoires: %v", names)

	// Check for expected grimoires
	expected := []string{"implement-bead", "spec-to-beads", "prepare-pr"}
	for _, exp := range expected {
		found := false
		for _, name := range names {
			if name == exp {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Expected grimoire %q to be in list", exp)
		}
	}
}

func TestInitResult_Totals(t *testing.T) {
	result := &InitResult{
		SpellsCopied:     []string{"a.md", "b.md"},
		SpellsSkipped:    []string{"c.md"},
		GrimoiresCopied:  []string{"d.yaml"},
		GrimoiresSkipped: []string{"e.yaml", "f.yaml"},
	}

	if result.TotalCopied() != 3 {
		t.Errorf("Expected TotalCopied 3, got %d", result.TotalCopied())
	}

	if result.TotalSkipped() != 3 {
		t.Errorf("Expected TotalSkipped 3, got %d", result.TotalSkipped())
	}
}
