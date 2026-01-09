//go:build e2e

package daemon_e2e

import (
	"testing"

	"github.com/coven/e2e/daemon/helpers"
)

// TestStateEndpoint verifies the state endpoint returns valid data.
func TestStateEndpoint(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	api := helpers.NewAPIClient(env)
	state, err := api.GetState()
	if err != nil {
		t.Fatalf("Get state error: %v", err)
	}

	// State should have session info
	if state.State.Session.Status == "" {
		t.Error("State should have session status")
	}
}

// TestTasksEndpoint verifies the tasks endpoint.
func TestTasksEndpoint(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	api := helpers.NewAPIClient(env)
	tasks, err := api.GetTasks()
	if err != nil {
		t.Fatalf("Get tasks error: %v", err)
	}

	// Initially should be empty (no beads tasks)
	if tasks.Count != 0 {
		t.Logf("Tasks count: %d (expected 0 without beads)", tasks.Count)
	}
}

// TestAgentsEndpoint verifies the agents endpoint.
func TestAgentsEndpoint(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	api := helpers.NewAPIClient(env)
	agents, err := api.GetAgents()
	if err != nil {
		t.Fatalf("Get agents error: %v", err)
	}

	// Initially should be empty (no agents running)
	if agents.Count != 0 {
		t.Errorf("Agents count = %d, want 0", agents.Count)
	}
}

// TestQuestionsEndpoint verifies the questions endpoint.
func TestQuestionsEndpoint(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.MustStart()

	api := helpers.NewAPIClient(env)
	questions, err := api.GetQuestions()
	if err != nil {
		t.Fatalf("Get questions error: %v", err)
	}

	// Initially should be empty
	if questions.Count != 0 {
		t.Errorf("Questions count = %d, want 0", questions.Count)
	}
	if questions.PendingCount != 0 {
		t.Errorf("Pending questions = %d, want 0", questions.PendingCount)
	}
}
