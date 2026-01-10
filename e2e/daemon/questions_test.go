//go:build e2e

package daemon_e2e

import (
	"strings"
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// simpleQuestionGrimoire is a grimoire for testing question flow
const simpleQuestionGrimoire = `name: simple-question
description: Simple agent step for testing questions
timeout: 5m

steps:
  - name: ask
    type: agent
    spell: |
      Ask a question to the user.
      Return a JSON block when complete:
` + "      ```json" + `
      {"success": true, "summary": "Got response"}
` + "      ```" + `
    timeout: 2m
`

// TestQuestionDetectionAndAnswer verifies the interactive question flow.
// NOTE: With the workflow-based execution model, interactive question handling
// is not supported through the direct API. The agent process is tracked under
// step-specific IDs, not the main task ID, so the respond API cannot find it.
// This test documents the current limitation and will be updated when
// workflow-level question handling (e.g., approval steps) is implemented.
func TestQuestionDetectionAndAnswer(t *testing.T) {
	t.Skip("Interactive question handling requires workflow-level support (not yet implemented)")

	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Write simple grimoire for question testing
	writeGrimoire(t, env, "simple-question", simpleQuestionGrimoire)

	// Create task with the simple grimoire
	taskID := createTaskWithLabel(t, env, "Test task with question", "grimoire:simple-question")

	// Configure mock agent with -question flag
	env.ConfigureMockAgentWithArgs(t, "-question")

	env.MustStart()
	api := helpers.NewAPIClient(env)

	// Start session and task
	if err := api.StartSession(); err != nil {
		t.Fatalf("Failed to start session: %v", err)
	}

	// Wait for task to appear
	time.Sleep(500 * time.Millisecond)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for agent to start
	env.WaitForAgent(t, api, taskID, 10)

	// Wait for question to appear in output
	var questionFound bool
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		output, err := api.GetAgentOutput(taskID)
		if err == nil && output != nil {
			for _, line := range output.Lines {
				if strings.Contains(line.Data, "proceed") {
					questionFound = true
					break
				}
			}
			if questionFound {
				break
			}
		}
		time.Sleep(100 * time.Millisecond)
	}

	if !questionFound {
		t.Fatal("Question not detected in agent output")
	}

	// Send response
	if err := api.RespondToAgent(taskID, "y"); err != nil {
		t.Fatalf("Failed to respond: %v", err)
	}

	// Wait for agent to complete
	env.WaitForAgentStatus(t, api, taskID, "completed", 10)
}

// TestRespondToCompletedAgent verifies that responding to a completed agent fails gracefully.
func TestRespondToCompletedAgent(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Write simple grimoire for agent testing
	writeGrimoire(t, env, "simple-question", simpleQuestionGrimoire)

	// Create task with the simple grimoire
	taskID := createTaskWithLabel(t, env, "Test task for respond after completion", "grimoire:simple-question")

	env.ConfigureMockAgent(t)
	env.MustStart()
	api := helpers.NewAPIClient(env)

	if err := api.StartSession(); err != nil {
		t.Fatalf("Failed to start session: %v", err)
	}

	time.Sleep(500 * time.Millisecond)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for agent to complete
	env.WaitForAgentStatus(t, api, taskID, "completed", 10)

	// Try to respond to completed agent - should fail
	err := api.RespondToAgent(taskID, "too late")
	if err == nil {
		t.Error("Expected error when responding to completed agent")
	} else {
		t.Logf("Got expected error: %v", err)
	}
}
