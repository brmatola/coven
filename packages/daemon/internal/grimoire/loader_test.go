package grimoire

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"testing/fstest"
)

func TestNewLoader(t *testing.T) {
	loader := NewLoader("/path/to/.coven")

	if loader.covenDir != "/path/to/.coven" {
		t.Errorf("covenDir = %q, want %q", loader.covenDir, "/path/to/.coven")
	}
	if loader.grimoiresSubdir != "grimoires" {
		t.Errorf("grimoiresSubdir = %q, want %q", loader.grimoiresSubdir, "grimoires")
	}
}

func TestLoad_UserGrimoire(t *testing.T) {
	tmpDir := t.TempDir()
	grimoiresDir := filepath.Join(tmpDir, "grimoires")
	if err := os.MkdirAll(grimoiresDir, 0755); err != nil {
		t.Fatalf("Failed to create grimoires dir: %v", err)
	}

	grimoireYAML := `
name: test-grimoire
description: A test grimoire
steps:
  - name: implement
    type: agent
    spell: implement
`
	grimoirePath := filepath.Join(grimoiresDir, "test-grimoire.yaml")
	if err := os.WriteFile(grimoirePath, []byte(grimoireYAML), 0644); err != nil {
		t.Fatalf("Failed to write grimoire: %v", err)
	}

	loader := NewLoader(tmpDir)
	grimoire, err := loader.Load("test-grimoire")
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if grimoire.Name != "test-grimoire" {
		t.Errorf("Name = %q, want %q", grimoire.Name, "test-grimoire")
	}
	if grimoire.Description != "A test grimoire" {
		t.Errorf("Description = %q, want %q", grimoire.Description, "A test grimoire")
	}
	if grimoire.Source != SourceUser {
		t.Errorf("Source = %q, want %q", grimoire.Source, SourceUser)
	}
	if len(grimoire.Steps) != 1 {
		t.Fatalf("Expected 1 step, got %d", len(grimoire.Steps))
	}
	if grimoire.Steps[0].Name != "implement" {
		t.Errorf("Steps[0].Name = %q, want %q", grimoire.Steps[0].Name, "implement")
	}
}

func TestLoad_BuiltinGrimoire(t *testing.T) {
	tmpDir := t.TempDir()

	builtinYAML := `
name: builtin-grimoire
description: A built-in grimoire
steps:
  - name: test
    type: script
    command: npm test
`
	builtinFS := fstest.MapFS{
		"grimoires/builtin-grimoire.yaml": &fstest.MapFile{
			Data: []byte(builtinYAML),
		},
	}

	loader := NewLoaderWithBuiltins(tmpDir, builtinFS, "grimoires")
	grimoire, err := loader.Load("builtin-grimoire")
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if grimoire.Name != "builtin-grimoire" {
		t.Errorf("Name = %q, want %q", grimoire.Name, "builtin-grimoire")
	}
	if grimoire.Source != SourceBuiltIn {
		t.Errorf("Source = %q, want %q", grimoire.Source, SourceBuiltIn)
	}
}

func TestLoad_UserOverridesBuiltin(t *testing.T) {
	tmpDir := t.TempDir()
	grimoiresDir := filepath.Join(tmpDir, "grimoires")
	if err := os.MkdirAll(grimoiresDir, 0755); err != nil {
		t.Fatalf("Failed to create grimoires dir: %v", err)
	}

	// User grimoire
	userYAML := `
name: shared-grimoire
description: User override
steps:
  - name: custom
    type: agent
    spell: custom
`
	grimoirePath := filepath.Join(grimoiresDir, "shared-grimoire.yaml")
	if err := os.WriteFile(grimoirePath, []byte(userYAML), 0644); err != nil {
		t.Fatalf("Failed to write grimoire: %v", err)
	}

	// Built-in grimoire with same name
	builtinYAML := `
name: shared-grimoire
description: Built-in version
steps:
  - name: default
    type: script
    command: echo default
`
	builtinFS := fstest.MapFS{
		"grimoires/shared-grimoire.yaml": &fstest.MapFile{
			Data: []byte(builtinYAML),
		},
	}

	loader := NewLoaderWithBuiltins(tmpDir, builtinFS, "grimoires")
	grimoire, err := loader.Load("shared-grimoire")
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	// Should load user grimoire, not builtin
	if grimoire.Description != "User override" {
		t.Errorf("Description = %q, want %q (user version)", grimoire.Description, "User override")
	}
	if grimoire.Source != SourceUser {
		t.Errorf("Source = %q, want %q", grimoire.Source, SourceUser)
	}
}

func TestLoad_NotFound(t *testing.T) {
	tmpDir := t.TempDir()

	loader := NewLoader(tmpDir)
	_, err := loader.Load("nonexistent")

	if err == nil {
		t.Fatal("Load() should return error for nonexistent grimoire")
	}

	if !IsNotFound(err) {
		t.Errorf("Expected GrimoireNotFoundError, got: %v", err)
	}

	expectedMsg := `grimoire not found: "nonexistent"`
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

	expectedErr := "grimoire name cannot be empty"
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

func TestLoad_InvalidYAML(t *testing.T) {
	tmpDir := t.TempDir()
	grimoiresDir := filepath.Join(tmpDir, "grimoires")
	if err := os.MkdirAll(grimoiresDir, 0755); err != nil {
		t.Fatalf("Failed to create grimoires dir: %v", err)
	}

	// Invalid YAML
	grimoirePath := filepath.Join(grimoiresDir, "invalid.yaml")
	if err := os.WriteFile(grimoirePath, []byte("not: valid: yaml: [["), 0644); err != nil {
		t.Fatalf("Failed to write grimoire: %v", err)
	}

	loader := NewLoader(tmpDir)
	_, err := loader.Load("invalid")

	if err == nil {
		t.Fatal("Load() should return error for invalid YAML")
	}
}

func TestLoad_MissingRequiredFields(t *testing.T) {
	tmpDir := t.TempDir()
	grimoiresDir := filepath.Join(tmpDir, "grimoires")
	if err := os.MkdirAll(grimoiresDir, 0755); err != nil {
		t.Fatalf("Failed to create grimoires dir: %v", err)
	}

	tests := []struct {
		name    string
		yaml    string
		errMsg  string
	}{
		{
			name: "missing name",
			yaml: `
description: test
steps:
  - name: test
    type: agent
    spell: test
`,
			errMsg: "name is required",
		},
		{
			name: "missing description",
			yaml: `
name: test
steps:
  - name: test
    type: agent
    spell: test
`,
			errMsg: "description is required",
		},
		{
			name: "missing steps",
			yaml: `
name: test
description: test
`,
			errMsg: "at least one step",
		},
		{
			name: "empty steps",
			yaml: `
name: test
description: test
steps: []
`,
			errMsg: "at least one step",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			grimoirePath := filepath.Join(grimoiresDir, tt.name+".yaml")
			if err := os.WriteFile(grimoirePath, []byte(tt.yaml), 0644); err != nil {
				t.Fatalf("Failed to write grimoire: %v", err)
			}

			loader := NewLoader(tmpDir)
			_, err := loader.Load(tt.name)

			if err == nil {
				t.Fatal("Load() should return error")
			}
			if !strings.Contains(err.Error(), tt.errMsg) {
				t.Errorf("Error = %q, want to contain %q", err.Error(), tt.errMsg)
			}
		})
	}
}

func TestList_Empty(t *testing.T) {
	tmpDir := t.TempDir()

	loader := NewLoader(tmpDir)
	grimoires, err := loader.List()
	if err != nil {
		t.Fatalf("List() error: %v", err)
	}

	if len(grimoires) != 0 {
		t.Errorf("Expected empty list, got %v", grimoires)
	}
}

func TestList_UserGrimoires(t *testing.T) {
	tmpDir := t.TempDir()
	grimoiresDir := filepath.Join(tmpDir, "grimoires")
	if err := os.MkdirAll(grimoiresDir, 0755); err != nil {
		t.Fatalf("Failed to create grimoires dir: %v", err)
	}

	// Create some grimoires
	for _, name := range []string{"a.yaml", "b.yaml", "c.yml"} {
		path := filepath.Join(grimoiresDir, name)
		if err := os.WriteFile(path, []byte("name: test\ndescription: test\nsteps: []"), 0644); err != nil {
			t.Fatalf("Failed to write grimoire: %v", err)
		}
	}

	// Create non-yaml file that should be ignored
	if err := os.WriteFile(filepath.Join(grimoiresDir, "notes.txt"), []byte("notes"), 0644); err != nil {
		t.Fatalf("Failed to write notes: %v", err)
	}

	loader := NewLoader(tmpDir)
	grimoires, err := loader.List()
	if err != nil {
		t.Fatalf("List() error: %v", err)
	}

	sort.Strings(grimoires)
	expected := []string{"a", "b", "c"}
	if len(grimoires) != len(expected) {
		t.Fatalf("List() returned %d grimoires, want %d", len(grimoires), len(expected))
	}
	for i, name := range expected {
		if grimoires[i] != name {
			t.Errorf("grimoires[%d] = %q, want %q", i, grimoires[i], name)
		}
	}
}

func TestList_BuiltinGrimoires(t *testing.T) {
	tmpDir := t.TempDir()

	builtinFS := fstest.MapFS{
		"grimoires/builtin1.yaml": &fstest.MapFile{Data: []byte("name: b1\ndescription: t\nsteps: []")},
		"grimoires/builtin2.yml":  &fstest.MapFile{Data: []byte("name: b2\ndescription: t\nsteps: []")},
	}

	loader := NewLoaderWithBuiltins(tmpDir, builtinFS, "grimoires")
	grimoires, err := loader.List()
	if err != nil {
		t.Fatalf("List() error: %v", err)
	}

	sort.Strings(grimoires)
	expected := []string{"builtin1", "builtin2"}
	if len(grimoires) != len(expected) {
		t.Fatalf("List() returned %d grimoires, want %d", len(grimoires), len(expected))
	}
	for i, name := range expected {
		if grimoires[i] != name {
			t.Errorf("grimoires[%d] = %q, want %q", i, grimoires[i], name)
		}
	}
}

func TestList_CombinedWithOverrides(t *testing.T) {
	tmpDir := t.TempDir()
	grimoiresDir := filepath.Join(tmpDir, "grimoires")
	if err := os.MkdirAll(grimoiresDir, 0755); err != nil {
		t.Fatalf("Failed to create grimoires dir: %v", err)
	}

	// User grimoires
	for _, name := range []string{"shared.yaml", "user-only.yaml"} {
		path := filepath.Join(grimoiresDir, name)
		if err := os.WriteFile(path, []byte("name: t\ndescription: t\nsteps: []"), 0644); err != nil {
			t.Fatalf("Failed to write grimoire: %v", err)
		}
	}

	// Builtin grimoires (shared overlaps with user)
	builtinFS := fstest.MapFS{
		"grimoires/shared.yaml":       &fstest.MapFile{Data: []byte("name: t\ndescription: t\nsteps: []")},
		"grimoires/builtin-only.yaml": &fstest.MapFile{Data: []byte("name: t\ndescription: t\nsteps: []")},
	}

	loader := NewLoaderWithBuiltins(tmpDir, builtinFS, "grimoires")
	grimoires, err := loader.List()
	if err != nil {
		t.Fatalf("List() error: %v", err)
	}

	sort.Strings(grimoires)
	expected := []string{"builtin-only", "shared", "user-only"}
	if len(grimoires) != len(expected) {
		t.Fatalf("List() returned %d grimoires, want %d: %v", len(grimoires), len(expected), grimoires)
	}
	for i, name := range expected {
		if grimoires[i] != name {
			t.Errorf("grimoires[%d] = %q, want %q", i, grimoires[i], name)
		}
	}
}

func TestParse_ValidGrimoire(t *testing.T) {
	yaml := `
name: implement-bead
description: Implements a feature from a bead specification
steps:
  - name: implement
    type: agent
    spell: implement
    output: implementation

  - name: quality-loop
    type: loop
    max_iterations: 3
    on_max_iterations: block
    steps:
      - name: run-tests
        type: script
        command: npm test
        on_fail: continue

      - name: fix-tests
        type: agent
        spell: fix-tests
        when: "{{.previous.failed}}"

  - name: merge-changes
    type: merge
    require_review: true
`
	grimoire, err := Parse([]byte(yaml))
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}

	if grimoire.Name != "implement-bead" {
		t.Errorf("Name = %q, want %q", grimoire.Name, "implement-bead")
	}
	if len(grimoire.Steps) != 3 {
		t.Fatalf("Expected 3 steps, got %d", len(grimoire.Steps))
	}

	// Check loop step
	loopStep := grimoire.Steps[1]
	if loopStep.Type != StepTypeLoop {
		t.Errorf("Steps[1].Type = %q, want %q", loopStep.Type, StepTypeLoop)
	}
	if loopStep.MaxIterations != 3 {
		t.Errorf("Steps[1].MaxIterations = %d, want 3", loopStep.MaxIterations)
	}
	if len(loopStep.Steps) != 2 {
		t.Errorf("Steps[1] nested steps = %d, want 2", len(loopStep.Steps))
	}
}

func TestParse_InvalidYAML(t *testing.T) {
	_, err := Parse([]byte("not: valid: yaml: [["))
	if err == nil {
		t.Fatal("Parse() should return error for invalid YAML")
	}
	if !IsParseError(err) {
		t.Errorf("Expected ParseError, got: %T", err)
	}
}

func TestValidate_DuplicateStepNames(t *testing.T) {
	grimoire := &Grimoire{
		Name:        "test",
		Description: "test",
		Steps: []Step{
			{Name: "step1", Type: StepTypeScript, Command: "echo 1"},
			{Name: "step1", Type: StepTypeScript, Command: "echo 2"},
		},
	}

	err := Validate(grimoire)
	if err == nil {
		t.Fatal("Validate() should return error for duplicate step names")
	}
	if !strings.Contains(err.Error(), "duplicate step name") {
		t.Errorf("Error = %q, want to contain 'duplicate step name'", err.Error())
	}
}

func TestValidate_DuplicateNestedStepNames(t *testing.T) {
	grimoire := &Grimoire{
		Name:        "test",
		Description: "test",
		Steps: []Step{
			{
				Name: "loop",
				Type: StepTypeLoop,
				Steps: []Step{
					{Name: "dup", Type: StepTypeScript, Command: "echo 1"},
					{Name: "dup", Type: StepTypeScript, Command: "echo 2"},
				},
			},
		},
	}

	err := Validate(grimoire)
	if err == nil {
		t.Fatal("Validate() should return error for duplicate nested step names")
	}
}

func TestIsNotFound(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{
			name:     "GrimoireNotFoundError",
			err:      &GrimoireNotFoundError{Name: "test"},
			expected: true,
		},
		{
			name:     "other error",
			err:      &ValidationError{Field: "test"},
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
			if got := IsNotFound(tt.err); got != tt.expected {
				t.Errorf("IsNotFound() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestIsParseError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{
			name:     "ParseError",
			err:      &ParseError{},
			expected: true,
		},
		{
			name:     "other error",
			err:      &ValidationError{Field: "test"},
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

func TestIsValidationError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{
			name:     "ValidationError",
			err:      &ValidationError{Field: "test"},
			expected: true,
		},
		{
			name:     "other error",
			err:      &ParseError{},
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
			if got := IsValidationError(tt.err); got != tt.expected {
				t.Errorf("IsValidationError() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestParseError_Unwrap(t *testing.T) {
	inner := &os.PathError{Op: "open", Path: "/test", Err: os.ErrNotExist}
	err := &ParseError{Err: inner}

	if err.Unwrap() != inner {
		t.Error("Unwrap() should return inner error")
	}
}

func TestValidationError_Error(t *testing.T) {
	err := &ValidationError{Field: "name", Message: "is required"}
	msg := err.Error()

	if !strings.Contains(msg, "name") {
		t.Error("Error should contain field name")
	}
	if !strings.Contains(msg, "is required") {
		t.Error("Error should contain message")
	}
}

func TestLoad_FallbackToBuiltinWhenUserDirMissing(t *testing.T) {
	tmpDir := t.TempDir()
	// Don't create grimoires directory

	builtinYAML := `
name: fallback
description: Fallback grimoire
steps:
  - name: test
    type: script
    command: echo test
`
	builtinFS := fstest.MapFS{
		"grimoires/fallback.yaml": &fstest.MapFile{Data: []byte(builtinYAML)},
	}

	loader := NewLoaderWithBuiltins(tmpDir, builtinFS, "grimoires")
	grimoire, err := loader.Load("fallback")
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if grimoire.Source != SourceBuiltIn {
		t.Errorf("Source = %q, want %q", grimoire.Source, SourceBuiltIn)
	}
}

func TestLoad_NoBuiltins(t *testing.T) {
	tmpDir := t.TempDir()

	loader := NewLoaderWithBuiltins(tmpDir, nil, "grimoires")
	_, err := loader.Load("anyname")

	if err == nil {
		t.Fatal("Load() should return error when no builtins and no user grimoire")
	}
	if !IsNotFound(err) {
		t.Errorf("Expected GrimoireNotFoundError, got: %v", err)
	}
}
