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
// Questions are detected in agent output, stored with workflow context,
// and answers are delivered to the agent via stdin using the step task ID.
func TestQuestionDetectionAndAnswer(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Write simple grimoire for question testing
	writeGrimoire(t, env, "simple-question", simpleQuestionGrimoire)

	// Create task with the simple grimoire
	taskID := createTaskWithLabel(t, env, "Test task with question", "grimoire:simple-question")

	// Configure mock agent with -question flag to ask a question
	env.ConfigureMockAgentWithArgs(t, "-question")

	env.MustStart()
	api := helpers.NewAPIClient(env)

	// Start session and task

	// Wait for task to appear
	time.Sleep(500 * time.Millisecond)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for agent to start
	env.WaitForAgent(t, api, taskID, 10)

	// Wait for question to be detected and stored
	var question *helpers.Question
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		questions, err := api.GetQuestions()
		if err == nil && questions != nil && len(questions.Questions) > 0 {
			// Find question for our task
			for i := range questions.Questions {
				q := &questions.Questions[i]
				if q.TaskID == taskID {
					question = q
					break
				}
			}
			if question != nil {
				break
			}
		}
		time.Sleep(100 * time.Millisecond)
	}

	if question == nil {
		t.Fatal("Question not detected via /questions API")
	}

	t.Logf("Found question: ID=%s, TaskID=%s, StepTaskID=%s, Text=%s",
		question.ID, question.TaskID, question.Context.StepTaskID, question.Text)

	// Verify the question has workflow context
	if question.Context.StepTaskID == "" {
		t.Error("Question missing StepTaskID in context")
	}
	if !strings.HasPrefix(question.Context.StepTaskID, taskID+"-step-") {
		t.Errorf("StepTaskID has unexpected format: %s", question.Context.StepTaskID)
	}

	// Answer the question using the questions API
	if err := api.AnswerQuestion(question.ID, "y"); err != nil {
		t.Fatalf("Failed to answer question: %v", err)
	}

	// Wait for agent to complete
	env.WaitForAgentStatus(t, api, taskID, "completed", 10)

	// Verify question was marked as answered
	questionsAfter, err := api.GetQuestions()
	if err != nil {
		t.Fatalf("Failed to get questions after answer: %v", err)
	}

	// Check that pending count decreased or question is no longer pending
	for _, q := range questionsAfter.Questions {
		if q.ID == question.ID {
			if q.AnsweredAt == "" {
				t.Error("Question should be marked as answered")
			}
			break
		}
	}
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
