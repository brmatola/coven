package workflow

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/coven/daemon/internal/grimoire"
)

func TestNewGrimoireMapper(t *testing.T) {
	mapper := NewGrimoireMapper("/tmp/.coven", nil)
	if mapper == nil {
		t.Fatal("NewGrimoireMapper() returned nil")
	}
	if mapper.covenDir != "/tmp/.coven" {
		t.Errorf("covenDir = %q, want %q", mapper.covenDir, "/tmp/.coven")
	}
}

func TestGrimoireMapper_ExtractGrimoireLabel(t *testing.T) {
	mapper := NewGrimoireMapper("/tmp", nil)

	tests := []struct {
		name     string
		labels   []string
		expected string
	}{
		{
			name:     "grimoire label present",
			labels:   []string{"priority:high", "grimoire:implement-bead", "type:feature"},
			expected: "implement-bead",
		},
		{
			name:     "no grimoire label",
			labels:   []string{"priority:high", "type:feature"},
			expected: "",
		},
		{
			name:     "empty labels",
			labels:   []string{},
			expected: "",
		},
		{
			name:     "grimoire label first",
			labels:   []string{"grimoire:custom-workflow"},
			expected: "custom-workflow",
		},
		{
			name:     "grimoire label with dashes",
			labels:   []string{"grimoire:strict-implement-bead"},
			expected: "strict-implement-bead",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := mapper.extractGrimoireLabel(tt.labels)
			if result != tt.expected {
				t.Errorf("extractGrimoireLabel() = %q, want %q", result, tt.expected)
			}
		})
	}
}

func TestGrimoireMapper_Resolve_ExplicitLabel(t *testing.T) {
	tmpDir := t.TempDir()
	setupTestGrimoire(t, tmpDir, "custom-workflow")

	loader := grimoire.NewLoader(tmpDir)
	mapper := NewGrimoireMapper(tmpDir, loader)

	bead := BeadInfo{
		Labels: []string{"grimoire:custom-workflow"},
		Type:   "feature",
	}

	name, err := mapper.Resolve(bead)
	if err != nil {
		t.Fatalf("Resolve() error: %v", err)
	}
	if name != "custom-workflow" {
		t.Errorf("Resolve() = %q, want %q", name, "custom-workflow")
	}
}

func TestGrimoireMapper_Resolve_TypeMapping(t *testing.T) {
	tmpDir := t.TempDir()
	setupTestGrimoire(t, tmpDir, "bugfix-bead")

	loader := grimoire.NewLoader(tmpDir)
	mapper := NewGrimoireMapper(tmpDir, loader)

	// Set config with type mapping
	mapper.SetConfig(&GrimoireMappingConfig{
		Default: "default-grimoire",
		ByType: map[string]string{
			"bug": "bugfix-bead",
		},
	})

	bead := BeadInfo{
		Labels: []string{},
		Type:   "bug",
	}

	name, err := mapper.Resolve(bead)
	if err != nil {
		t.Fatalf("Resolve() error: %v", err)
	}
	if name != "bugfix-bead" {
		t.Errorf("Resolve() = %q, want %q", name, "bugfix-bead")
	}
}

func TestGrimoireMapper_Resolve_DefaultFallback(t *testing.T) {
	tmpDir := t.TempDir()
	setupTestGrimoire(t, tmpDir, "default-grimoire")

	loader := grimoire.NewLoader(tmpDir)
	mapper := NewGrimoireMapper(tmpDir, loader)

	mapper.SetConfig(&GrimoireMappingConfig{
		Default: "default-grimoire",
		ByType:  map[string]string{},
	})

	bead := BeadInfo{
		Labels: []string{},
		Type:   "unknown",
	}

	name, err := mapper.Resolve(bead)
	if err != nil {
		t.Fatalf("Resolve() error: %v", err)
	}
	if name != "default-grimoire" {
		t.Errorf("Resolve() = %q, want %q", name, "default-grimoire")
	}
}

func TestGrimoireMapper_Resolve_BuiltinDefault(t *testing.T) {
	tmpDir := t.TempDir()
	setupTestGrimoire(t, tmpDir, BuiltinDefaultGrimoire)

	loader := grimoire.NewLoader(tmpDir)
	mapper := NewGrimoireMapper(tmpDir, loader)

	mapper.SetConfig(&GrimoireMappingConfig{
		Default: "", // No default
		ByType:  map[string]string{},
	})

	bead := BeadInfo{
		Labels: []string{},
		Type:   "",
	}

	name, err := mapper.Resolve(bead)
	if err != nil {
		t.Fatalf("Resolve() error: %v", err)
	}
	if name != BuiltinDefaultGrimoire {
		t.Errorf("Resolve() = %q, want %q", name, BuiltinDefaultGrimoire)
	}
}

func TestGrimoireMapper_Resolve_LabelTakesPrecedence(t *testing.T) {
	tmpDir := t.TempDir()
	setupTestGrimoire(t, tmpDir, "explicit-grimoire")
	setupTestGrimoire(t, tmpDir, "type-grimoire")

	loader := grimoire.NewLoader(tmpDir)
	mapper := NewGrimoireMapper(tmpDir, loader)

	mapper.SetConfig(&GrimoireMappingConfig{
		Default: "default-grimoire",
		ByType: map[string]string{
			"feature": "type-grimoire",
		},
	})

	bead := BeadInfo{
		Labels: []string{"grimoire:explicit-grimoire"},
		Type:   "feature",
	}

	name, err := mapper.Resolve(bead)
	if err != nil {
		t.Fatalf("Resolve() error: %v", err)
	}
	if name != "explicit-grimoire" {
		t.Errorf("Resolve() = %q, want %q (explicit label should take precedence)", name, "explicit-grimoire")
	}
}

func TestGrimoireMapper_Resolve_MissingGrimoire(t *testing.T) {
	tmpDir := t.TempDir()
	// Don't create the grimoire

	loader := grimoire.NewLoader(tmpDir)
	mapper := NewGrimoireMapper(tmpDir, loader)

	bead := BeadInfo{
		Labels: []string{"grimoire:nonexistent"},
		Type:   "feature",
	}

	_, err := mapper.Resolve(bead)
	if err == nil {
		t.Fatal("Resolve() should return error for missing grimoire")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("Error should mention 'not found', got: %q", err.Error())
	}
}

func TestGrimoireMapper_Resolve_NoLoader(t *testing.T) {
	tmpDir := t.TempDir()
	mapper := NewGrimoireMapper(tmpDir, nil)

	bead := BeadInfo{
		Labels: []string{"grimoire:any-grimoire"},
		Type:   "feature",
	}

	name, err := mapper.Resolve(bead)
	if err != nil {
		t.Fatalf("Resolve() error: %v", err)
	}
	// Should return the name without validation
	if name != "any-grimoire" {
		t.Errorf("Resolve() = %q, want %q", name, "any-grimoire")
	}
}

func TestGrimoireMapper_LoadConfig(t *testing.T) {
	tmpDir := t.TempDir()

	// Create config file
	configPath := filepath.Join(tmpDir, "grimoire-mapping.json")
	configContent := `{
  "default": "my-default",
  "by_type": {
    "feature": "feature-grimoire",
    "bug": "bugfix-grimoire"
  }
}`
	if err := os.WriteFile(configPath, []byte(configContent), 0644); err != nil {
		t.Fatalf("WriteFile error: %v", err)
	}

	mapper := NewGrimoireMapper(tmpDir, nil)

	cfg, err := mapper.loadConfig()
	if err != nil {
		t.Fatalf("loadConfig() error: %v", err)
	}

	if cfg.Default != "my-default" {
		t.Errorf("Default = %q, want %q", cfg.Default, "my-default")
	}
	if cfg.ByType["feature"] != "feature-grimoire" {
		t.Errorf("ByType[feature] = %q, want %q", cfg.ByType["feature"], "feature-grimoire")
	}
	if cfg.ByType["bug"] != "bugfix-grimoire" {
		t.Errorf("ByType[bug] = %q, want %q", cfg.ByType["bug"], "bugfix-grimoire")
	}
}

func TestGrimoireMapper_LoadConfig_DefaultValues(t *testing.T) {
	tmpDir := t.TempDir()
	// No config file

	mapper := NewGrimoireMapper(tmpDir, nil)

	cfg, err := mapper.loadConfig()
	if err != nil {
		t.Fatalf("loadConfig() error: %v", err)
	}

	if cfg.Default != BuiltinDefaultGrimoire {
		t.Errorf("Default = %q, want %q", cfg.Default, BuiltinDefaultGrimoire)
	}
	if cfg.ByType == nil {
		t.Fatal("ByType should not be nil")
	}
	if cfg.ByType["feature"] != "implement-bead" {
		t.Errorf("ByType[feature] = %q, want %q", cfg.ByType["feature"], "implement-bead")
	}
}

func TestGrimoireMapper_LoadConfig_InvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()

	configPath := filepath.Join(tmpDir, "grimoire-mapping.json")
	if err := os.WriteFile(configPath, []byte("invalid json"), 0644); err != nil {
		t.Fatalf("WriteFile error: %v", err)
	}

	mapper := NewGrimoireMapper(tmpDir, nil)

	_, err := mapper.loadConfig()
	if err == nil {
		t.Fatal("loadConfig() should return error for invalid JSON")
	}
	if !strings.Contains(err.Error(), "parse") {
		t.Errorf("Error should mention parse, got: %q", err.Error())
	}
}

func TestGrimoireMapper_ReloadConfig(t *testing.T) {
	tmpDir := t.TempDir()

	mapper := NewGrimoireMapper(tmpDir, nil)

	// Set initial config
	mapper.SetConfig(&GrimoireMappingConfig{
		Default: "old-default",
	})

	// Create new config file
	configPath := filepath.Join(tmpDir, "grimoire-mapping.json")
	if err := os.WriteFile(configPath, []byte(`{"default": "new-default"}`), 0644); err != nil {
		t.Fatalf("WriteFile error: %v", err)
	}

	err := mapper.ReloadConfig()
	if err != nil {
		t.Fatalf("ReloadConfig() error: %v", err)
	}

	cfg := mapper.GetConfig()
	if cfg.Default != "new-default" {
		t.Errorf("Default = %q, want %q after reload", cfg.Default, "new-default")
	}
}

func TestGrimoireMapper_GetSetConfig(t *testing.T) {
	mapper := NewGrimoireMapper("/tmp", nil)

	// Initially nil
	if mapper.GetConfig() != nil {
		t.Error("GetConfig() should return nil initially")
	}

	cfg := &GrimoireMappingConfig{Default: "test"}
	mapper.SetConfig(cfg)

	if mapper.GetConfig() != cfg {
		t.Error("GetConfig() should return the set config")
	}
}

func TestBuiltinDefaultGrimoire_Constant(t *testing.T) {
	if BuiltinDefaultGrimoire != "implement-bead" {
		t.Errorf("BuiltinDefaultGrimoire = %q, want %q", BuiltinDefaultGrimoire, "implement-bead")
	}
}

// setupTestGrimoire creates a test grimoire file.
func setupTestGrimoire(t *testing.T, covenDir, name string) {
	t.Helper()

	grimoiresDir := filepath.Join(covenDir, "grimoires")
	if err := os.MkdirAll(grimoiresDir, 0755); err != nil {
		t.Fatalf("MkdirAll error: %v", err)
	}

	content := `name: ` + name + `
description: Test grimoire
steps:
  - name: test
    type: script
    command: echo test
`
	path := filepath.Join(grimoiresDir, name+".yaml")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("WriteFile error: %v", err)
	}
}
