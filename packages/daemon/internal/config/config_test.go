package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()

	if cfg.PollInterval != 1 {
		t.Errorf("PollInterval = %d, want 1", cfg.PollInterval)
	}
	if cfg.AgentCommand != "claude" {
		t.Errorf("AgentCommand = %q, want %q", cfg.AgentCommand, "claude")
	}
	if cfg.MaxConcurrentAgents != 3 {
		t.Errorf("MaxConcurrentAgents = %d, want 3", cfg.MaxConcurrentAgents)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel = %q, want %q", cfg.LogLevel, "info")
	}
}

func TestLoadNoFile(t *testing.T) {
	tmpDir := t.TempDir()

	cfg, err := Load(tmpDir)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	// Should return defaults when no file exists
	if cfg.PollInterval != 1 {
		t.Errorf("PollInterval = %d, want 1", cfg.PollInterval)
	}
}

func TestLoadFromFile(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.json")

	// Write custom config
	configJSON := `{
		"poll_interval": 5,
		"agent_command": "custom-agent",
		"max_concurrent_agents": 10,
		"log_level": "debug"
	}`
	if err := os.WriteFile(configPath, []byte(configJSON), 0644); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	cfg, err := Load(tmpDir)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if cfg.PollInterval != 5 {
		t.Errorf("PollInterval = %d, want 5", cfg.PollInterval)
	}
	if cfg.AgentCommand != "custom-agent" {
		t.Errorf("AgentCommand = %q, want %q", cfg.AgentCommand, "custom-agent")
	}
	if cfg.MaxConcurrentAgents != 10 {
		t.Errorf("MaxConcurrentAgents = %d, want 10", cfg.MaxConcurrentAgents)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("LogLevel = %q, want %q", cfg.LogLevel, "debug")
	}
}

func TestLoadPartialConfig(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.json")

	// Write partial config - should merge with defaults
	configJSON := `{
		"poll_interval": 10
	}`
	if err := os.WriteFile(configPath, []byte(configJSON), 0644); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	cfg, err := Load(tmpDir)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	// Custom value
	if cfg.PollInterval != 10 {
		t.Errorf("PollInterval = %d, want 10", cfg.PollInterval)
	}

	// Default values should still be present
	if cfg.AgentCommand != "claude" {
		t.Errorf("AgentCommand = %q, want %q", cfg.AgentCommand, "claude")
	}
}

func TestLoadInvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.json")

	// Write invalid JSON
	if err := os.WriteFile(configPath, []byte("not valid json"), 0644); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	_, err := Load(tmpDir)
	if err == nil {
		t.Error("Load() should fail for invalid JSON")
	}
}

func TestSave(t *testing.T) {
	tmpDir := t.TempDir()

	cfg := &Config{
		PollInterval:        3,
		AgentCommand:        "my-agent",
		MaxConcurrentAgents: 5,
		LogLevel:            "warn",
	}

	if err := cfg.Save(tmpDir); err != nil {
		t.Fatalf("Save() error: %v", err)
	}

	// Load it back
	loaded, err := Load(tmpDir)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if loaded.PollInterval != cfg.PollInterval {
		t.Errorf("PollInterval = %d, want %d", loaded.PollInterval, cfg.PollInterval)
	}
	if loaded.AgentCommand != cfg.AgentCommand {
		t.Errorf("AgentCommand = %q, want %q", loaded.AgentCommand, cfg.AgentCommand)
	}
}

func TestSaveInvalidPath(t *testing.T) {
	cfg := DefaultConfig()

	// Try to save to non-existent directory
	err := cfg.Save("/nonexistent/directory")
	if err == nil {
		t.Error("Save() should fail for invalid path")
	}
}

func TestValidate(t *testing.T) {
	tests := []struct {
		name    string
		cfg     *Config
		wantErr bool
	}{
		{
			name:    "valid config",
			cfg:     DefaultConfig(),
			wantErr: false,
		},
		{
			name: "invalid poll interval",
			cfg: &Config{
				PollInterval:        0,
				AgentCommand:        "claude",
				MaxConcurrentAgents: 1,
			},
			wantErr: true,
		},
		{
			name: "negative poll interval",
			cfg: &Config{
				PollInterval:        -1,
				AgentCommand:        "claude",
				MaxConcurrentAgents: 1,
			},
			wantErr: true,
		},
		{
			name: "invalid max concurrent agents",
			cfg: &Config{
				PollInterval:        1,
				AgentCommand:        "claude",
				MaxConcurrentAgents: 0,
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.cfg.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
