package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// Config represents the daemon configuration.
type Config struct {
	// PollInterval is the interval between task reconciliation polls in seconds.
	PollInterval int `json:"poll_interval"`

	// AgentCommand is the command to run for agents (default: claude).
	AgentCommand string `json:"agent_command"`

	// AgentArgs are the arguments to pass to the agent command (default: ["-p"]).
	AgentArgs []string `json:"agent_args"`

	// MaxConcurrentAgents is the maximum number of concurrent agents.
	MaxConcurrentAgents int `json:"max_concurrent_agents"`

	// LogLevel is the logging level (debug, info, warn, error).
	LogLevel string `json:"log_level"`
}

// DefaultConfig returns the default configuration.
func DefaultConfig() *Config {
	return &Config{
		PollInterval:        1,
		AgentCommand:        "claude",
		AgentArgs:           []string{"-p"},
		MaxConcurrentAgents: 3,
		LogLevel:            "info",
	}
}

// Load loads configuration from .coven/config.json or returns defaults.
func Load(covenDir string) (*Config, error) {
	configPath := filepath.Join(covenDir, "config.json")

	data, err := os.ReadFile(configPath)
	if os.IsNotExist(err) {
		return DefaultConfig(), nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	cfg := DefaultConfig()
	if err := json.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config file: %w", err)
	}

	return cfg, nil
}

// Save saves the configuration to .coven/config.json.
func (c *Config) Save(covenDir string) error {
	configPath := filepath.Join(covenDir, "config.json")

	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	if err := os.WriteFile(configPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write config file: %w", err)
	}

	return nil
}

// Validate validates the configuration.
func (c *Config) Validate() error {
	if c.PollInterval < 1 {
		return fmt.Errorf("poll_interval must be at least 1 second")
	}
	if c.MaxConcurrentAgents < 1 {
		return fmt.Errorf("max_concurrent_agents must be at least 1")
	}
	return nil
}
