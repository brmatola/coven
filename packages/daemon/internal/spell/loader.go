package spell

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// Spell represents a loaded spell template.
type Spell struct {
	// Name is the spell identifier (e.g., "implement").
	Name string

	// Content is the raw template content.
	Content string

	// Source indicates where the spell was loaded from.
	Source SpellSource
}

// SpellSource indicates the origin of a spell.
type SpellSource string

const (
	// SourceBuiltIn indicates the spell is built-in.
	SourceBuiltIn SpellSource = "builtin"

	// SourceUser indicates the spell was loaded from user's .coven/spells/.
	SourceUser SpellSource = "user"
)

// builtinSpells holds embedded built-in spell templates.
// This will be populated by embed directive when built-in spells are added.
var builtinSpells embed.FS

// SetBuiltinSpells sets the embedded filesystem containing built-in spells.
// This is called during initialization with the embedded spells.
func SetBuiltinSpells(fs embed.FS) {
	builtinSpells = fs
}

// Loader handles loading spell templates from the filesystem.
type Loader struct {
	// covenDir is the path to the .coven directory.
	covenDir string

	// builtinFS is the embedded filesystem for built-in spells.
	builtinFS fs.FS

	// spellsSubdir is the subdirectory within the embedded FS where spells are stored.
	spellsSubdir string
}

// NewLoader creates a new spell loader.
// covenDir is the path to the .coven directory (e.g., "/path/to/project/.coven").
func NewLoader(covenDir string) *Loader {
	return &Loader{
		covenDir:     covenDir,
		builtinFS:    builtinSpells,
		spellsSubdir: "spells",
	}
}

// NewLoaderWithBuiltins creates a new spell loader with a custom built-in filesystem.
// This is useful for testing.
func NewLoaderWithBuiltins(covenDir string, builtinFS fs.FS, spellsSubdir string) *Loader {
	return &Loader{
		covenDir:     covenDir,
		builtinFS:    builtinFS,
		spellsSubdir: spellsSubdir,
	}
}

// Load loads a spell by name.
// It first looks in the user's .coven/spells/ directory, then falls back to built-in spells.
// Returns an error if the spell is not found in either location.
func (l *Loader) Load(name string) (*Spell, error) {
	// Validate spell name
	if name == "" {
		return nil, fmt.Errorf("spell name cannot be empty")
	}
	if strings.ContainsAny(name, "/\\") {
		return nil, fmt.Errorf("spell name cannot contain path separators: %q", name)
	}

	// Try user spells first
	spell, err := l.loadUserSpell(name)
	if err == nil {
		return spell, nil
	}
	if !os.IsNotExist(err) && !isNotExistError(err) {
		return nil, fmt.Errorf("failed to load user spell %q: %w", name, err)
	}

	// Fall back to built-in spells
	spell, err = l.loadBuiltinSpell(name)
	if err == nil {
		return spell, nil
	}
	if !isNotExistError(err) {
		return nil, fmt.Errorf("failed to load builtin spell %q: %w", name, err)
	}

	return nil, &SpellNotFoundError{Name: name}
}

// loadUserSpell loads a spell from the user's .coven/spells/ directory.
func (l *Loader) loadUserSpell(name string) (*Spell, error) {
	spellPath := filepath.Join(l.covenDir, "spells", name+".md")

	content, err := os.ReadFile(spellPath)
	if err != nil {
		return nil, err
	}

	return &Spell{
		Name:    name,
		Content: string(content),
		Source:  SourceUser,
	}, nil
}

// loadBuiltinSpell loads a spell from the embedded built-in spells.
func (l *Loader) loadBuiltinSpell(name string) (*Spell, error) {
	if l.builtinFS == nil {
		return nil, fs.ErrNotExist
	}

	spellPath := filepath.Join(l.spellsSubdir, name+".md")

	content, err := fs.ReadFile(l.builtinFS, spellPath)
	if err != nil {
		return nil, err
	}

	return &Spell{
		Name:    name,
		Content: string(content),
		Source:  SourceBuiltIn,
	}, nil
}

// List returns all available spell names.
// User spells with the same name as built-in spells will only appear once.
func (l *Loader) List() ([]string, error) {
	spellSet := make(map[string]bool)

	// Collect built-in spells
	if l.builtinFS != nil {
		builtinSpells, err := l.listBuiltinSpells()
		if err != nil && !isNotExistError(err) {
			return nil, fmt.Errorf("failed to list builtin spells: %w", err)
		}
		for _, name := range builtinSpells {
			spellSet[name] = true
		}
	}

	// Collect user spells (may override built-ins)
	userSpells, err := l.listUserSpells()
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("failed to list user spells: %w", err)
	}
	for _, name := range userSpells {
		spellSet[name] = true
	}

	// Convert to slice
	result := make([]string, 0, len(spellSet))
	for name := range spellSet {
		result = append(result, name)
	}

	return result, nil
}

// listUserSpells returns the names of all user spells.
func (l *Loader) listUserSpells() ([]string, error) {
	spellsDir := filepath.Join(l.covenDir, "spells")

	entries, err := os.ReadDir(spellsDir)
	if err != nil {
		return nil, err
	}

	var names []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		name := strings.TrimSuffix(entry.Name(), ".md")
		names = append(names, name)
	}

	return names, nil
}

// listBuiltinSpells returns the names of all built-in spells.
func (l *Loader) listBuiltinSpells() ([]string, error) {
	if l.builtinFS == nil {
		return nil, nil
	}

	entries, err := fs.ReadDir(l.builtinFS, l.spellsSubdir)
	if err != nil {
		return nil, err
	}

	var names []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		name := strings.TrimSuffix(entry.Name(), ".md")
		names = append(names, name)
	}

	return names, nil
}

// SpellNotFoundError is returned when a spell cannot be found.
type SpellNotFoundError struct {
	Name string
}

func (e *SpellNotFoundError) Error() string {
	return fmt.Sprintf("spell not found: %q", e.Name)
}

// IsNotFound returns true if the error is a SpellNotFoundError.
func IsNotFound(err error) bool {
	_, ok := err.(*SpellNotFoundError)
	return ok
}

// isNotExistError checks if an error indicates a file/directory doesn't exist.
func isNotExistError(err error) bool {
	if os.IsNotExist(err) {
		return true
	}
	if err == fs.ErrNotExist {
		return true
	}
	// Check wrapped errors
	if pathErr, ok := err.(*fs.PathError); ok {
		return os.IsNotExist(pathErr.Err)
	}
	return false
}
