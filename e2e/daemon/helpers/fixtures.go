// Package helpers provides test utilities for daemon E2E tests.
package helpers

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

var (
	mockAgentOnce sync.Once
	mockAgentPath string
	mockAgentErr  error
)

// getMockAgentBinary returns the path to the mock agent binary, building it if needed.
func getMockAgentBinary() (string, error) {
	mockAgentOnce.Do(func() {
		_, filename, _, ok := runtime.Caller(0)
		if !ok {
			mockAgentErr = fmt.Errorf("failed to get caller info")
			return
		}

		// Build directory at repo root
		repoRoot := filepath.Join(filepath.Dir(filename), "..", "..", "..")
		buildDir := filepath.Join(repoRoot, "build")
		mockAgentPath = filepath.Join(buildDir, "mockagent")

		// Check if already built
		if _, err := os.Stat(mockAgentPath); err == nil {
			return
		}

		// Build the mock agent
		if err := os.MkdirAll(buildDir, 0755); err != nil {
			mockAgentErr = fmt.Errorf("failed to create build dir: %w", err)
			return
		}

		mockAgentSrc := filepath.Join(filepath.Dir(filename), "..", "mockagent")
		cmd := exec.Command("go", "build", "-o", mockAgentPath, ".")
		cmd.Dir = mockAgentSrc
		if output, err := cmd.CombinedOutput(); err != nil {
			mockAgentErr = fmt.Errorf("failed to build mockagent: %w\n%s", err, output)
			return
		}
	})

	return mockAgentPath, mockAgentErr
}

// ConfigureMockAgent configures the daemon to use the mock agent instead of claude.
// Returns the path to the mock agent binary for use in tests.
func (e *TestEnv) ConfigureMockAgent(t *testing.T) string {
	return e.ConfigureMockAgentWithArgs(t, "")
}

// ConfigureMockAgentWithArgs configures the daemon to use a mock agent wrapper with specific args.
// If args is empty, uses the mock agent directly.
// If args is provided, creates a wrapper script that calls mockagent with those args.
func (e *TestEnv) ConfigureMockAgentWithArgs(t *testing.T, args string) string {
	t.Helper()

	mockAgent, err := getMockAgentBinary()
	if err != nil {
		t.Fatalf("Failed to get mock agent: %v", err)
	}

	// Create .coven directory
	if err := os.MkdirAll(e.CovenDir, 0755); err != nil {
		t.Fatalf("Failed to create .coven dir: %v", err)
	}

	// Determine the agent command to use
	agentCmd := mockAgent
	if args != "" {
		// Create a wrapper script
		wrapperPath := filepath.Join(e.CovenDir, "mock-agent-wrapper.sh")
		wrapperScript := fmt.Sprintf("#!/bin/bash\nexec %s %s \"$@\"\n", mockAgent, args)
		if err := os.WriteFile(wrapperPath, []byte(wrapperScript), 0755); err != nil {
			t.Fatalf("Failed to write wrapper script: %v", err)
		}
		agentCmd = wrapperPath
	}

	// Write config with mock agent
	// NOTE: agent_args must be empty since mockagent doesn't accept claude's -p flag
	config := map[string]interface{}{
		"poll_interval":         1,
		"agent_command":         agentCmd,
		"agent_args":            []string{},
		"max_concurrent_agents": 3,
		"log_level":             "debug",
	}

	configPath := filepath.Join(e.CovenDir, "config.json")
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		t.Fatalf("Failed to marshal config: %v", err)
	}

	if err := os.WriteFile(configPath, data, 0644); err != nil {
		t.Fatalf("Failed to write config: %v", err)
	}

	return mockAgent
}

// BeadsTaskDef represents a task definition for creating in beads.
type BeadsTaskDef struct {
	ID          string
	Title       string
	Description string
	Priority    int
	Type        string
}

// InitBeads initializes beads in the test workspace.
func (e *TestEnv) InitBeads(t *testing.T) {
	t.Helper()

	cmd := exec.Command("bd", "init")
	cmd.Dir = e.TmpDir
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("Failed to init beads: %v\n%s", err, output)
	}
}

// CreateBeadsTask creates a task in beads and returns its ID.
func (e *TestEnv) CreateBeadsTask(t *testing.T, title string, priority int) string {
	t.Helper()

	cmd := exec.Command("bd", "create",
		"--title="+title,
		"--type=task",
		fmt.Sprintf("--priority=%d", priority),
	)
	cmd.Dir = e.TmpDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("Failed to create task: %v\n%s", err, output)
	}

	// Parse the task ID from output - look for "Created issue: <id>"
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		if strings.Contains(line, "Created issue:") {
			// Extract the ID after the colon
			parts := strings.Split(line, "Created issue:")
			if len(parts) >= 2 {
				taskID := strings.TrimSpace(parts[1])
				// Remove any trailing info (like Title:, Priority:, etc.)
				taskID = strings.Fields(taskID)[0]
				return taskID
			}
		}
	}

	t.Fatalf("Failed to parse task ID from output: %s", output)
	return ""
}

// SetupWithMockAgentAndTask sets up a complete test environment with:
// - Beads initialized
// - A task created
// - Mock agent configured
// Returns the task ID.
func (e *TestEnv) SetupWithMockAgentAndTask(t *testing.T, taskTitle string) string {
	t.Helper()

	e.InitBeads(t)
	e.ConfigureMockAgent(t)
	return e.CreateBeadsTask(t, taskTitle, 1)
}

// WaitForAgent polls until an agent exists for the given task ID.
func (e *TestEnv) WaitForAgent(t *testing.T, api *APIClient, taskID string, timeoutSec int) *Agent {
	t.Helper()

	deadline := time.Now().Add(time.Duration(timeoutSec) * time.Second)
	for time.Now().Before(deadline) {
		agents, err := api.GetAgents()
		if err != nil {
			t.Logf("GetAgents error (retrying): %v", err)
		} else {
			for _, a := range agents.Agents {
				if a.TaskID == taskID {
					return &a
				}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}

	t.Fatalf("Agent for task %s did not appear within %d seconds", taskID, timeoutSec)
	return nil
}

// WaitForAgentStatus polls until an agent has the given status.
func (e *TestEnv) WaitForAgentStatus(t *testing.T, api *APIClient, taskID, status string, timeoutSec int) *Agent {
	t.Helper()

	deadline := time.Now().Add(time.Duration(timeoutSec) * time.Second)
	for time.Now().Before(deadline) {
		agent, err := api.GetAgent(taskID)
		if err == nil && agent != nil && agent.Status == status {
			return agent
		}
		time.Sleep(100 * time.Millisecond)
	}

	t.Fatalf("Agent for task %s did not reach status %q within %d seconds", taskID, status, timeoutSec)
	return nil
}
