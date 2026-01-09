package grimoire

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// builtinGrimoires holds embedded built-in grimoire files.
// This will be populated by embed directive when built-in grimoires are added.
var builtinGrimoires embed.FS

// SetBuiltinGrimoires sets the embedded filesystem containing built-in grimoires.
// This is called during initialization with the embedded grimoires.
func SetBuiltinGrimoires(fs embed.FS) {
	builtinGrimoires = fs
}

// Loader handles loading grimoire definitions from the filesystem.
type Loader struct {
	// covenDir is the path to the .coven directory.
	covenDir string

	// builtinFS is the embedded filesystem for built-in grimoires.
	builtinFS fs.FS

	// grimoiresSubdir is the subdirectory within the embedded FS where grimoires are stored.
	grimoiresSubdir string
}

// NewLoader creates a new grimoire loader.
// covenDir is the path to the .coven directory (e.g., "/path/to/project/.coven").
func NewLoader(covenDir string) *Loader {
	return &Loader{
		covenDir:        covenDir,
		builtinFS:       builtinGrimoires,
		grimoiresSubdir: "grimoires",
	}
}

// NewLoaderWithBuiltins creates a new grimoire loader with a custom built-in filesystem.
// This is useful for testing.
func NewLoaderWithBuiltins(covenDir string, builtinFS fs.FS, grimoiresSubdir string) *Loader {
	return &Loader{
		covenDir:        covenDir,
		builtinFS:       builtinFS,
		grimoiresSubdir: grimoiresSubdir,
	}
}

// Load loads a grimoire by name.
// It first looks in the user's .coven/grimoires/ directory, then falls back to built-in grimoires.
// Returns an error if the grimoire is not found in either location.
func (l *Loader) Load(name string) (*Grimoire, error) {
	// Validate grimoire name
	if name == "" {
		return nil, fmt.Errorf("grimoire name cannot be empty")
	}
	if strings.ContainsAny(name, "/\\") {
		return nil, fmt.Errorf("grimoire name cannot contain path separators: %q", name)
	}

	// Try user grimoires first
	grimoire, err := l.loadUserGrimoire(name)
	if err == nil {
		return grimoire, nil
	}
	if !os.IsNotExist(err) && !isNotExistError(err) {
		return nil, fmt.Errorf("failed to load user grimoire %q: %w", name, err)
	}

	// Fall back to built-in grimoires
	grimoire, err = l.loadBuiltinGrimoire(name)
	if err == nil {
		return grimoire, nil
	}
	if !isNotExistError(err) {
		return nil, fmt.Errorf("failed to load builtin grimoire %q: %w", name, err)
	}

	return nil, &GrimoireNotFoundError{Name: name}
}

// loadUserGrimoire loads a grimoire from the user's .coven/grimoires/ directory.
func (l *Loader) loadUserGrimoire(name string) (*Grimoire, error) {
	grimoirePath := filepath.Join(l.covenDir, "grimoires", name+".yaml")

	data, err := os.ReadFile(grimoirePath)
	if err != nil {
		return nil, err
	}

	grimoire, err := Parse(data)
	if err != nil {
		return nil, fmt.Errorf("failed to parse grimoire %q: %w", name, err)
	}

	grimoire.Source = SourceUser
	return grimoire, nil
}

// loadBuiltinGrimoire loads a grimoire from the embedded built-in grimoires.
func (l *Loader) loadBuiltinGrimoire(name string) (*Grimoire, error) {
	if l.builtinFS == nil {
		return nil, fs.ErrNotExist
	}

	grimoirePath := filepath.Join(l.grimoiresSubdir, name+".yaml")

	data, err := fs.ReadFile(l.builtinFS, grimoirePath)
	if err != nil {
		return nil, err
	}

	grimoire, err := Parse(data)
	if err != nil {
		return nil, fmt.Errorf("failed to parse builtin grimoire %q: %w", name, err)
	}

	grimoire.Source = SourceBuiltIn
	return grimoire, nil
}

// List returns all available grimoire names.
// User grimoires with the same name as built-in grimoires will only appear once.
func (l *Loader) List() ([]string, error) {
	grimoireSet := make(map[string]bool)

	// Collect built-in grimoires
	if l.builtinFS != nil {
		builtinGrimoires, err := l.listBuiltinGrimoires()
		if err != nil && !isNotExistError(err) {
			return nil, fmt.Errorf("failed to list builtin grimoires: %w", err)
		}
		for _, name := range builtinGrimoires {
			grimoireSet[name] = true
		}
	}

	// Collect user grimoires (may override built-ins)
	userGrimoires, err := l.listUserGrimoires()
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("failed to list user grimoires: %w", err)
	}
	for _, name := range userGrimoires {
		grimoireSet[name] = true
	}

	// Convert to slice
	result := make([]string, 0, len(grimoireSet))
	for name := range grimoireSet {
		result = append(result, name)
	}

	return result, nil
}

// listUserGrimoires returns the names of all user grimoires.
func (l *Loader) listUserGrimoires() ([]string, error) {
	grimoiresDir := filepath.Join(l.covenDir, "grimoires")

	entries, err := os.ReadDir(grimoiresDir)
	if err != nil {
		return nil, err
	}

	var names []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if !strings.HasSuffix(entry.Name(), ".yaml") && !strings.HasSuffix(entry.Name(), ".yml") {
			continue
		}
		name := strings.TrimSuffix(entry.Name(), ".yaml")
		name = strings.TrimSuffix(name, ".yml")
		names = append(names, name)
	}

	return names, nil
}

// listBuiltinGrimoires returns the names of all built-in grimoires.
func (l *Loader) listBuiltinGrimoires() ([]string, error) {
	if l.builtinFS == nil {
		return nil, nil
	}

	entries, err := fs.ReadDir(l.builtinFS, l.grimoiresSubdir)
	if err != nil {
		return nil, err
	}

	var names []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if !strings.HasSuffix(entry.Name(), ".yaml") && !strings.HasSuffix(entry.Name(), ".yml") {
			continue
		}
		name := strings.TrimSuffix(entry.Name(), ".yaml")
		name = strings.TrimSuffix(name, ".yml")
		names = append(names, name)
	}

	return names, nil
}

// Parse parses grimoire YAML data and validates it.
func Parse(data []byte) (*Grimoire, error) {
	var grimoire Grimoire
	if err := yaml.Unmarshal(data, &grimoire); err != nil {
		return nil, &ParseError{Err: err}
	}

	if err := Validate(&grimoire); err != nil {
		return nil, err
	}

	return &grimoire, nil
}

// Validate validates a grimoire's structure and fields.
func Validate(g *Grimoire) error {
	if g.Name == "" {
		return &ValidationError{Field: "name", Message: "grimoire name is required"}
	}

	if g.Description == "" {
		return &ValidationError{Field: "description", Message: "grimoire description is required"}
	}

	if len(g.Steps) == 0 {
		return &ValidationError{Field: "steps", Message: "grimoire must have at least one step"}
	}

	// Validate each step
	for i := range g.Steps {
		if err := g.Steps[i].Validate(); err != nil {
			return fmt.Errorf("step %d: %w", i, err)
		}
	}

	// Check for duplicate step names
	stepNames := make(map[string]bool)
	if err := checkDuplicateStepNames(g.Steps, stepNames, ""); err != nil {
		return err
	}

	return nil
}

// checkDuplicateStepNames recursively checks for duplicate step names.
func checkDuplicateStepNames(steps []Step, seen map[string]bool, prefix string) error {
	for _, step := range steps {
		fullName := step.Name
		if prefix != "" {
			fullName = prefix + "." + step.Name
		}

		if seen[step.Name] {
			return &ValidationError{
				Field:   "steps",
				Message: fmt.Sprintf("duplicate step name %q", step.Name),
			}
		}
		seen[step.Name] = true

		// Check nested steps in loops
		if step.Type == StepTypeLoop && len(step.Steps) > 0 {
			if err := checkDuplicateStepNames(step.Steps, seen, fullName); err != nil {
				return err
			}
		}
	}
	return nil
}

// GrimoireNotFoundError is returned when a grimoire cannot be found.
type GrimoireNotFoundError struct {
	Name string
}

func (e *GrimoireNotFoundError) Error() string {
	return fmt.Sprintf("grimoire not found: %q", e.Name)
}

// IsNotFound returns true if the error is a GrimoireNotFoundError.
func IsNotFound(err error) bool {
	_, ok := err.(*GrimoireNotFoundError)
	return ok
}

// ParseError is returned when grimoire YAML fails to parse.
type ParseError struct {
	Err error
}

func (e *ParseError) Error() string {
	return fmt.Sprintf("failed to parse grimoire YAML: %v", e.Err)
}

func (e *ParseError) Unwrap() error {
	return e.Err
}

// IsParseError returns true if the error is a ParseError.
func IsParseError(err error) bool {
	_, ok := err.(*ParseError)
	return ok
}

// ValidationError is returned when grimoire validation fails.
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("grimoire validation failed: %s: %s", e.Field, e.Message)
}

// IsValidationError returns true if the error is a ValidationError.
func IsValidationError(err error) bool {
	_, ok := err.(*ValidationError)
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
