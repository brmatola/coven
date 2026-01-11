//go:build e2e

package daemon_e2e

import (
	"encoding/json"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// integrationGrimoire is a minimal grimoire for real agent testing.
// Uses a very simple task to minimize API usage and test time.
const integrationGrimoire = `name: integration-test
description: Minimal test grimoire for real agent integration
timeout: 2m

steps:
  - name: execute
    type: agent
    spell: |
      Return a JSON block with "success": true immediately:
      ` + "```json" + `
      {"success": true, "summary": "Integration test passed"}
      ` + "```" + `
    timeout: 1m
`

// TestRealAgentIntegration tests the full workflow with the real Claude agent.
// This test is skipped by default - set COVEN_INTEGRATION_TEST=1 to run it.
//
// Prerequisites:
// - claude CLI installed and authenticated (run `claude` to verify)
//
// Usage:
//   COVEN_INTEGRATION_TEST=1 go test -tags=e2e -run TestRealAgentIntegration ./e2e/daemon/...
func TestRealAgentIntegration(t *testing.T) {
	// Skip unless explicitly requested
	if os.Getenv("COVEN_INTEGRATION_TEST") != "1" {
		t.Skip("Skipping real agent integration test (set COVEN_INTEGRATION_TEST=1 to run)")
	}

	// Check claude CLI is available
	if _, err := exec.LookPath("claude"); err != nil {
		t.Skip("Skipping: claude CLI not found in PATH")
	}

	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Write integration test grimoire
	writeGrimoire(t, env, "integration-test", integrationGrimoire)

	// Create task
	taskID := createTaskWithLabel(t, env, "Integration test task", "grimoire:integration-test")
	t.Logf("Created integration test task: %s", taskID)

	// Configure daemon to use real claude CLI (no mock agent)
	writeConfig(t, env, map[string]interface{}{
		"poll_interval":         1,
		"agent_command":         "claude",
		"max_concurrent_agents": 1,
		"log_level":             "debug",
	})

	env.MustStart()
	api := helpers.NewAPIClient(env)

	// Wait for task to appear
	time.Sleep(500 * time.Millisecond)

	// Start the task
	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}
	t.Log("Task started")

	// Wait for agent to appear
	agent := env.WaitForAgent(t, api, taskID, 30)
	if agent == nil {
		t.Fatal("Agent did not appear")
	}
	t.Logf("Agent started with PID: %d, status: %s", agent.PID, agent.Status)

	// Wait for agent to complete (real agent may take longer)
	env.WaitForAgentStatus(t, api, taskID, "completed", 120)
	t.Log("Agent completed")

	// Verify output was captured
	output, err := api.GetAgentOutput(taskID)
	if err != nil {
		t.Fatalf("Failed to get agent output: %v", err)
	}

	if output != nil && output.LineCount > 0 {
		t.Logf("Captured %d lines of real agent output", output.LineCount)
		// Log first few lines for debugging
		for i, line := range output.Lines {
			if i >= 5 {
				t.Log("  ... (truncated)")
				break
			}
			t.Logf("  [%d] %s: %s", line.Sequence, line.Stream, line.Data)
		}
	}

	// Wait for task to complete
	waitForTaskStatus(t, api, taskID, "closed", 30)
	t.Log("Integration test completed successfully!")
}

// writeConfig writes a config file for the daemon.
func writeConfig(t *testing.T, env *helpers.TestEnv, config map[string]interface{}) {
	t.Helper()

	// Use bd config or write directly
	configPath := env.TmpDir + "/.coven/config.json"

	data, err := json.Marshal(config)
	if err != nil {
		t.Fatalf("Failed to marshal config: %v", err)
	}

	if err := os.WriteFile(configPath, data, 0644); err != nil {
		t.Fatalf("Failed to write config: %v", err)
	}
}
