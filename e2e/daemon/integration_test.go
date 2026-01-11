//go:build e2e

package daemon_e2e

import (
	"encoding/json"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// lastNLines returns the last n lines of a string.
func lastNLines(s string, n int) string {
	lines := strings.Split(s, "\n")
	if len(lines) <= n {
		return s
	}
	return strings.Join(lines[len(lines)-n:], "\n")
}

// min returns the smaller of two integers.
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// integrationGrimoire is a minimal grimoire for real agent testing.
// Uses a very simple task to minimize API usage and test time.
const integrationGrimoire = `name: integration-test
description: Minimal test grimoire for real agent integration
timeout: 5m

steps:
  - name: execute
    type: agent
    spell: |
      Say only: done
    timeout: 3m
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

	// Configure daemon to use real claude CLI with -p flag for print mode
	writeConfig(t, env, map[string]interface{}{
		"poll_interval":         1,
		"agent_command":         "claude",
		"agent_args":            []string{"-p"},
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

	// Poll for PID update (callback may fire after initial agent creation)
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) && agent.PID == 0 {
		time.Sleep(500 * time.Millisecond)
		agent, _ = api.GetAgent(taskID)
		if agent != nil && agent.PID != 0 {
			t.Logf("Agent PID updated to: %d", agent.PID)
			break
		}
	}

	// Check daemon logs for debugging
	logPath := env.TmpDir + "/.coven/covend.log"
	if logData, err := os.ReadFile(logPath); err == nil {
		t.Logf("Daemon log (last 30 lines):\n%s", lastNLines(string(logData), 30))
	}

	// Also check agent output periodically
	go func() {
		for i := 0; i < 24; i++ { // Check every 5s for 2 minutes
			time.Sleep(5 * time.Second)
			if output, err := api.GetAgentOutput(taskID); err == nil && output != nil && output.LineCount > 0 {
				t.Logf("Agent output update (%d lines): %v", output.LineCount, output.Lines[:min(3, len(output.Lines))])
			}
			// Refresh agent status
			if a, err := api.GetAgent(taskID); err == nil && a != nil {
				t.Logf("Agent status: %s", a.Status)
				if a.Status == "completed" || a.Status == "failed" {
					break
				}
			}
		}
	}()

	// Wait for agent to complete or fail
	var finalAgent *helpers.Agent
	deadline = time.Now().Add(120 * time.Second)
	for time.Now().Before(deadline) {
		if a, err := api.GetAgent(taskID); err == nil && a != nil {
			if a.Status == "completed" || a.Status == "failed" {
				finalAgent = a
				break
			}
		}
		time.Sleep(time.Second)
	}

	if finalAgent == nil {
		t.Fatal("Agent did not reach terminal state within 120 seconds")
	}

	// Log final daemon state
	if logData, err := os.ReadFile(logPath); err == nil {
		t.Logf("Final daemon log (last 50 lines):\n%s", lastNLines(string(logData), 50))
	}

	if finalAgent.Status == "failed" {
		t.Logf("Agent failed - checking for error details")
		// Get full state to see error
		if state, err := api.GetState(); err == nil && state != nil {
			for id, agent := range state.State.Agents {
				t.Logf("Agent %s: status=%s", id, agent.Status)
			}
		}
		t.Fatal("Agent failed instead of completing")
	}
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

	// Create .coven directory if it doesn't exist
	covenDir := env.TmpDir + "/.coven"
	if err := os.MkdirAll(covenDir, 0755); err != nil {
		t.Fatalf("Failed to create .coven directory: %v", err)
	}

	configPath := covenDir + "/config.json"

	data, err := json.Marshal(config)
	if err != nil {
		t.Fatalf("Failed to marshal config: %v", err)
	}

	if err := os.WriteFile(configPath, data, 0644); err != nil {
		t.Fatalf("Failed to write config: %v", err)
	}
}
