package spell

import (
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"testing/fstest"
)

func TestNewLoader(t *testing.T) {
	loader := NewLoader("/path/to/.coven")

	if loader.covenDir != "/path/to/.coven" {
		t.Errorf("covenDir = %q, want %q", loader.covenDir, "/path/to/.coven")
	}
	if loader.spellsSubdir != "spells" {
		t.Errorf("spellsSubdir = %q, want %q", loader.spellsSubdir, "spells")
	}
}

func TestLoad_UserSpell(t *testing.T) {
	tmpDir := t.TempDir()
	spellsDir := filepath.Join(tmpDir, "spells")
	if err := os.MkdirAll(spellsDir, 0755); err != nil {
		t.Fatalf("Failed to create spells dir: %v", err)
	}

	// Create a user spell
	spellContent := "# Implement Feature\n\nThis is a test spell."
	spellPath := filepath.Join(spellsDir, "implement.md")
	if err := os.WriteFile(spellPath, []byte(spellContent), 0644); err != nil {
		t.Fatalf("Failed to write spell: %v", err)
	}

	loader := NewLoader(tmpDir)
	spell, err := loader.Load("implement")
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if spell.Name != "implement" {
		t.Errorf("Name = %q, want %q", spell.Name, "implement")
	}
	if spell.Content != spellContent {
		t.Errorf("Content = %q, want %q", spell.Content, spellContent)
	}
	if spell.Source != SourceUser {
		t.Errorf("Source = %q, want %q", spell.Source, SourceUser)
	}
}

func TestLoad_BuiltinSpell(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a mock builtin filesystem
	builtinContent := "# Built-in Spell\n\nDefault implementation."
	builtinFS := fstest.MapFS{
		"spells/debug.md": &fstest.MapFile{
			Data: []byte(builtinContent),
		},
	}

	loader := NewLoaderWithBuiltins(tmpDir, builtinFS, "spells")
	spell, err := loader.Load("debug")
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if spell.Name != "debug" {
		t.Errorf("Name = %q, want %q", spell.Name, "debug")
	}
	if spell.Content != builtinContent {
		t.Errorf("Content = %q, want %q", spell.Content, builtinContent)
	}
	if spell.Source != SourceBuiltIn {
		t.Errorf("Source = %q, want %q", spell.Source, SourceBuiltIn)
	}
}

func TestLoad_UserOverridesBuiltin(t *testing.T) {
	tmpDir := t.TempDir()
	spellsDir := filepath.Join(tmpDir, "spells")
	if err := os.MkdirAll(spellsDir, 0755); err != nil {
		t.Fatalf("Failed to create spells dir: %v", err)
	}

	// Create a user spell that overrides builtin
	userContent := "# User Override\n\nCustom implementation."
	spellPath := filepath.Join(spellsDir, "implement.md")
	if err := os.WriteFile(spellPath, []byte(userContent), 0644); err != nil {
		t.Fatalf("Failed to write spell: %v", err)
	}

	// Create a mock builtin filesystem with the same spell
	builtinContent := "# Built-in Spell\n\nDefault implementation."
	builtinFS := fstest.MapFS{
		"spells/implement.md": &fstest.MapFile{
			Data: []byte(builtinContent),
		},
	}

	loader := NewLoaderWithBuiltins(tmpDir, builtinFS, "spells")
	spell, err := loader.Load("implement")
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	// Should load user spell, not builtin
	if spell.Content != userContent {
		t.Errorf("Content = %q, want %q (user content)", spell.Content, userContent)
	}
	if spell.Source != SourceUser {
		t.Errorf("Source = %q, want %q", spell.Source, SourceUser)
	}
}

func TestLoad_NotFound(t *testing.T) {
	tmpDir := t.TempDir()

	loader := NewLoader(tmpDir)
	_, err := loader.Load("nonexistent")

	if err == nil {
		t.Fatal("Load() should return error for nonexistent spell")
	}

	if !IsNotFound(err) {
		t.Errorf("Expected SpellNotFoundError, got: %v", err)
	}

	// Verify error message is clear
	expectedMsg := `spell not found: "nonexistent"`
	if err.Error() != expectedMsg {
		t.Errorf("Error message = %q, want %q", err.Error(), expectedMsg)
	}
}

func TestLoad_EmptyName(t *testing.T) {
	loader := NewLoader("/tmp")

	_, err := loader.Load("")
	if err == nil {
		t.Fatal("Load() should return error for empty name")
	}

	expectedErr := "spell name cannot be empty"
	if err.Error() != expectedErr {
		t.Errorf("Error = %q, want %q", err.Error(), expectedErr)
	}
}

func TestLoad_InvalidName_PathSeparator(t *testing.T) {
	loader := NewLoader("/tmp")

	tests := []string{
		"foo/bar",
		"foo\\bar",
		"../escape",
		"/absolute",
	}

	for _, name := range tests {
		t.Run(name, func(t *testing.T) {
			_, err := loader.Load(name)
			if err == nil {
				t.Fatal("Load() should return error for name with path separator")
			}
		})
	}
}

func TestLoad_NoBuiltins(t *testing.T) {
	tmpDir := t.TempDir()

	// Loader with nil builtin FS
	loader := NewLoaderWithBuiltins(tmpDir, nil, "spells")
	_, err := loader.Load("anyspell")

	if err == nil {
		t.Fatal("Load() should return error when no builtins and no user spell")
	}
	if !IsNotFound(err) {
		t.Errorf("Expected SpellNotFoundError, got: %v", err)
	}
}

func TestList_Empty(t *testing.T) {
	tmpDir := t.TempDir()

	loader := NewLoader(tmpDir)
	spells, err := loader.List()
	if err != nil {
		t.Fatalf("List() error: %v", err)
	}

	if len(spells) != 0 {
		t.Errorf("Expected empty list, got %v", spells)
	}
}

func TestList_UserSpellsOnly(t *testing.T) {
	tmpDir := t.TempDir()
	spellsDir := filepath.Join(tmpDir, "spells")
	if err := os.MkdirAll(spellsDir, 0755); err != nil {
		t.Fatalf("Failed to create spells dir: %v", err)
	}

	// Create some user spells
	spellFiles := []string{"implement.md", "debug.md", "review.md"}
	for _, name := range spellFiles {
		path := filepath.Join(spellsDir, name)
		if err := os.WriteFile(path, []byte("# Spell"), 0644); err != nil {
			t.Fatalf("Failed to write spell: %v", err)
		}
	}

	// Also create a non-md file that should be ignored
	if err := os.WriteFile(filepath.Join(spellsDir, "notes.txt"), []byte("notes"), 0644); err != nil {
		t.Fatalf("Failed to write notes: %v", err)
	}

	loader := NewLoader(tmpDir)
	spells, err := loader.List()
	if err != nil {
		t.Fatalf("List() error: %v", err)
	}

	sort.Strings(spells)
	expected := []string{"debug", "implement", "review"}
	if len(spells) != len(expected) {
		t.Fatalf("List() returned %d spells, want %d", len(spells), len(expected))
	}
	for i, name := range expected {
		if spells[i] != name {
			t.Errorf("spells[%d] = %q, want %q", i, spells[i], name)
		}
	}
}

func TestList_BuiltinSpellsOnly(t *testing.T) {
	tmpDir := t.TempDir()

	builtinFS := fstest.MapFS{
		"spells/builtin1.md": &fstest.MapFile{Data: []byte("# Spell 1")},
		"spells/builtin2.md": &fstest.MapFile{Data: []byte("# Spell 2")},
	}

	loader := NewLoaderWithBuiltins(tmpDir, builtinFS, "spells")
	spells, err := loader.List()
	if err != nil {
		t.Fatalf("List() error: %v", err)
	}

	sort.Strings(spells)
	expected := []string{"builtin1", "builtin2"}
	if len(spells) != len(expected) {
		t.Fatalf("List() returned %d spells, want %d", len(spells), len(expected))
	}
	for i, name := range expected {
		if spells[i] != name {
			t.Errorf("spells[%d] = %q, want %q", i, spells[i], name)
		}
	}
}

func TestList_CombinedWithOverrides(t *testing.T) {
	tmpDir := t.TempDir()
	spellsDir := filepath.Join(tmpDir, "spells")
	if err := os.MkdirAll(spellsDir, 0755); err != nil {
		t.Fatalf("Failed to create spells dir: %v", err)
	}

	// User spells
	userSpells := []string{"implement.md", "custom.md"}
	for _, name := range userSpells {
		path := filepath.Join(spellsDir, name)
		if err := os.WriteFile(path, []byte("# User Spell"), 0644); err != nil {
			t.Fatalf("Failed to write spell: %v", err)
		}
	}

	// Builtin spells (implement.md overlaps with user)
	builtinFS := fstest.MapFS{
		"spells/implement.md": &fstest.MapFile{Data: []byte("# Builtin")},
		"spells/debug.md":     &fstest.MapFile{Data: []byte("# Builtin")},
	}

	loader := NewLoaderWithBuiltins(tmpDir, builtinFS, "spells")
	spells, err := loader.List()
	if err != nil {
		t.Fatalf("List() error: %v", err)
	}

	sort.Strings(spells)
	// Should have unique set: custom, debug, implement
	expected := []string{"custom", "debug", "implement"}
	if len(spells) != len(expected) {
		t.Fatalf("List() returned %d spells, want %d: %v", len(spells), len(expected), spells)
	}
	for i, name := range expected {
		if spells[i] != name {
			t.Errorf("spells[%d] = %q, want %q", i, spells[i], name)
		}
	}
}

func TestList_IgnoresDirectories(t *testing.T) {
	tmpDir := t.TempDir()
	spellsDir := filepath.Join(tmpDir, "spells")
	if err := os.MkdirAll(spellsDir, 0755); err != nil {
		t.Fatalf("Failed to create spells dir: %v", err)
	}

	// Create a spell
	if err := os.WriteFile(filepath.Join(spellsDir, "spell.md"), []byte("# Spell"), 0644); err != nil {
		t.Fatalf("Failed to write spell: %v", err)
	}

	// Create a subdirectory that should be ignored
	if err := os.MkdirAll(filepath.Join(spellsDir, "subdir"), 0755); err != nil {
		t.Fatalf("Failed to create subdir: %v", err)
	}

	loader := NewLoader(tmpDir)
	spells, err := loader.List()
	if err != nil {
		t.Fatalf("List() error: %v", err)
	}

	if len(spells) != 1 || spells[0] != "spell" {
		t.Errorf("List() = %v, want [spell]", spells)
	}
}

func TestIsNotFound(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{
			name:     "SpellNotFoundError",
			err:      &SpellNotFoundError{Name: "test"},
			expected: true,
		},
		{
			name:     "regular error",
			err:      os.ErrPermission,
			expected: false,
		},
		{
			name:     "nil error",
			err:      nil,
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsNotFound(tt.err); got != tt.expected {
				t.Errorf("IsNotFound(%v) = %v, want %v", tt.err, got, tt.expected)
			}
		})
	}
}

func TestSpellNotFoundError_Error(t *testing.T) {
	err := &SpellNotFoundError{Name: "missing-spell"}
	expected := `spell not found: "missing-spell"`

	if err.Error() != expected {
		t.Errorf("Error() = %q, want %q", err.Error(), expected)
	}
}

func TestIsNotExistError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{
			name:     "os.ErrNotExist",
			err:      os.ErrNotExist,
			expected: true,
		},
		{
			name:     "fs.ErrNotExist",
			err:      fs.ErrNotExist,
			expected: true,
		},
		{
			name:     "PathError with ErrNotExist",
			err:      &fs.PathError{Op: "open", Path: "/file", Err: os.ErrNotExist},
			expected: true,
		},
		{
			name:     "permission error",
			err:      os.ErrPermission,
			expected: false,
		},
		{
			name:     "nil error",
			err:      nil,
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isNotExistError(tt.err); got != tt.expected {
				t.Errorf("isNotExistError(%v) = %v, want %v", tt.err, got, tt.expected)
			}
		})
	}
}

func TestLoad_FallbackToBuiltinWhenUserDirMissing(t *testing.T) {
	tmpDir := t.TempDir()
	// Don't create spells directory - it doesn't exist

	builtinContent := "# Builtin Spell"
	builtinFS := fstest.MapFS{
		"spells/fallback.md": &fstest.MapFile{Data: []byte(builtinContent)},
	}

	loader := NewLoaderWithBuiltins(tmpDir, builtinFS, "spells")
	spell, err := loader.Load("fallback")
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if spell.Source != SourceBuiltIn {
		t.Errorf("Source = %q, want %q", spell.Source, SourceBuiltIn)
	}
	if spell.Content != builtinContent {
		t.Errorf("Content = %q, want %q", spell.Content, builtinContent)
	}
}

func TestSpellSource_Constants(t *testing.T) {
	// Verify constant values are as expected
	if SourceBuiltIn != "builtin" {
		t.Errorf("SourceBuiltIn = %q, want %q", SourceBuiltIn, "builtin")
	}
	if SourceUser != "user" {
		t.Errorf("SourceUser = %q, want %q", SourceUser, "user")
	}
}
