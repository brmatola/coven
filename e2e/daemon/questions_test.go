//go:build e2e

package daemon_e2e

import (
	"strings"
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// TestQuestionDetectionAndAnswer verifies the interactive question flow:
// 1. Agent outputs a question
// 2. Question is detected and available via API
// 3. Answer is sent back to agent
// 4. Agent continues to completion
func TestQuestionDetectionAndAnswer(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	// Set up environment with question-asking agent
	env.InitBeads(t)
	taskID := env.CreateBeadsTask(t, "Test task with question", 1)

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
	deadline := time.Now().Add(10 * time.Second)
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
		output, _ := api.GetAgentOutput(taskID)
		t.Logf("Agent output: %+v", output)
		t.Fatal("Question not found in agent output")
	}

	t.Log("Question detected in agent output")

	// Send response to agent
	if err := api.RespondToAgent(taskID, "y"); err != nil {
		t.Fatalf("Failed to respond to agent: %v", err)
	}

	t.Log("Response sent to agent")

	// Wait for agent to complete
	deadline = time.Now().Add(15 * time.Second)
	var completed bool
	for time.Now().Before(deadline) {
		agent, err := api.GetAgent(taskID)
		if err == nil && agent != nil && agent.Status == "completed" {
			completed = true
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	if !completed {
		agent, _ := api.GetAgent(taskID)
		output, _ := api.GetAgentOutput(taskID)
		t.Logf("Final agent state: %+v", agent)
		t.Logf("Final output: %+v", output)
		t.Fatal("Agent did not complete after response")
	}

	t.Log("Agent completed successfully after receiving response")

	// Verify output contains our response
	output, err := api.GetAgentOutput(taskID)
	if err != nil {
		t.Fatalf("Failed to get output: %v", err)
	}

	foundResponse := false
	for _, line := range output.Lines {
		if strings.Contains(line.Data, "Received response") {
			foundResponse = true
			break
		}
	}

	if !foundResponse {
		t.Log("Output lines:")
		for _, line := range output.Lines {
			t.Logf("  [%d] %s", line.Sequence, line.Data)
		}
		t.Error("Expected output to show received response")
	}
}

// TestRespondToCompletedAgent verifies that responding to a completed agent fails gracefully.
func TestRespondToCompletedAgent(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	// Set up environment with fast-completing agent
	taskID := env.SetupWithMockAgentAndTask(t, "Test task for respond after completion")

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
	env.WaitForAgentStatus(t, api, taskID, "completed", 15)

	// Try to respond to completed agent - should fail
	err := api.RespondToAgent(taskID, "too late")
	if err == nil {
		t.Error("Expected error when responding to completed agent")
	} else {
		t.Logf("Got expected error: %v", err)
	}
}
