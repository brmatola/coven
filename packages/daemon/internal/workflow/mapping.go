package workflow

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/coven/daemon/internal/grimoire"
)

// GrimoireMappingConfig contains the grimoire mapping configuration.
type GrimoireMappingConfig struct {
	// Default is the default grimoire to use when no other mapping applies.
	Default string `json:"default"`

	// ByType maps bead types to grimoire names.
	ByType map[string]string `json:"by_type"`
}

// GrimoireMapper resolves which grimoire to use for a given bead.
type GrimoireMapper struct {
	config         *GrimoireMappingConfig
	grimoireLoader *grimoire.Loader
	covenDir       string
}

// NewGrimoireMapper creates a new grimoire mapper.
func NewGrimoireMapper(covenDir string, grimoireLoader *grimoire.Loader) *GrimoireMapper {
	return &GrimoireMapper{
		config:         nil,
		grimoireLoader: grimoireLoader,
		covenDir:       covenDir,
	}
}

// BeadInfo contains the information needed to resolve a grimoire.
type BeadInfo struct {
	// ID is the bead identifier.
	ID string

	// Labels are the bead's labels (e.g., ["grimoire:implement-bead", "priority:high"]).
	Labels []string

	// Type is the bead type (e.g., "feature", "bug", "task").
	Type string

	// Title is the bead title.
	Title string

	// Body is the bead description/body.
	Body string

	// Priority is the bead priority (e.g., "P1", "P2").
	Priority string
}

// Resolve determines which grimoire to use for a bead.
// Resolution order:
// 1. Explicit label on bead: grimoire:name
// 2. Type-based mapping from config
// 3. Default grimoire from config
// 4. Built-in default (implement-bead)
func (m *GrimoireMapper) Resolve(bead BeadInfo) (string, error) {
	// Load config if not already loaded
	if m.config == nil {
		cfg, err := m.loadConfig()
		if err != nil {
			return "", fmt.Errorf("failed to load grimoire mapping config: %w", err)
		}
		m.config = cfg
	}

	// 1. Check for explicit grimoire label
	grimoireName := m.extractGrimoireLabel(bead.Labels)
	if grimoireName != "" {
		return m.validateGrimoire(grimoireName)
	}

	// 2. Check type-based mapping
	if m.config.ByType != nil && bead.Type != "" {
		if mapped, ok := m.config.ByType[bead.Type]; ok && mapped != "" {
			return m.validateGrimoire(mapped)
		}
	}

	// 3. Use default from config
	if m.config.Default != "" {
		return m.validateGrimoire(m.config.Default)
	}

	// 4. Built-in default
	return m.validateGrimoire(BuiltinDefaultGrimoire)
}

// BuiltinDefaultGrimoire is the name of the built-in default grimoire.
const BuiltinDefaultGrimoire = "implement-bead"

// extractGrimoireLabel extracts a grimoire name from bead labels.
// Looks for labels in the format "grimoire:name".
func (m *GrimoireMapper) extractGrimoireLabel(labels []string) string {
	for _, label := range labels {
		if strings.HasPrefix(label, "grimoire:") {
			return strings.TrimPrefix(label, "grimoire:")
		}
	}
	return ""
}

// validateGrimoire checks if a grimoire exists and returns its name.
func (m *GrimoireMapper) validateGrimoire(name string) (string, error) {
	if m.grimoireLoader == nil {
		// No loader configured, just return the name
		return name, nil
	}

	_, err := m.grimoireLoader.Load(name)
	if err != nil {
		if grimoire.IsNotFound(err) {
			return "", fmt.Errorf("grimoire %q not found", name)
		}
		return "", fmt.Errorf("failed to load grimoire %q: %w", name, err)
	}

	return name, nil
}

// loadConfig loads the grimoire mapping configuration.
func (m *GrimoireMapper) loadConfig() (*GrimoireMappingConfig, error) {
	configPath := filepath.Join(m.covenDir, "grimoire-mapping.json")

	data, err := os.ReadFile(configPath)
	if os.IsNotExist(err) {
		// Return default config
		return &GrimoireMappingConfig{
			Default: BuiltinDefaultGrimoire,
			ByType: map[string]string{
				"feature": "implement-bead",
				"bug":     "implement-bead",
				"task":    "implement-bead",
			},
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to read grimoire mapping config: %w", err)
	}

	var cfg GrimoireMappingConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse grimoire mapping config: %w", err)
	}

	return &cfg, nil
}

// ReloadConfig reloads the configuration from disk.
func (m *GrimoireMapper) ReloadConfig() error {
	cfg, err := m.loadConfig()
	if err != nil {
		return err
	}
	m.config = cfg
	return nil
}

// GetConfig returns the current configuration.
// Returns nil if not yet loaded.
func (m *GrimoireMapper) GetConfig() *GrimoireMappingConfig {
	return m.config
}

// SetConfig sets the configuration directly.
// Useful for testing.
func (m *GrimoireMapper) SetConfig(cfg *GrimoireMappingConfig) {
	m.config = cfg
}

// GetGrimoire loads and returns a grimoire by name.
func (m *GrimoireMapper) GetGrimoire(name string) (*grimoire.Grimoire, error) {
	if m.grimoireLoader == nil {
		return nil, fmt.Errorf("grimoire loader not configured")
	}
	return m.grimoireLoader.Load(name)
}
