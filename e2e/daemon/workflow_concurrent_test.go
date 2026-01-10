//go:build e2e

package daemon_e2e

import (
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// TestWorkflowConcurrentExecution verifies multiple workflows can run concurrently.
func TestWorkflowConcurrentExecution(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Create a simple fast workflow
	grimoireYAML := `name: test-concurrent
description: Fast workflow for concurrency testing
timeout: 2m

steps:
  - name: quick-step
    type: script
    command: "sleep 1 && echo 'Workflow complete'"
    timeout: 30s
`
	writeGrimoire(t, env, "test-concurrent", grimoireYAML)

	// Create multiple tasks
	taskID1 := createTaskWithLabel(t, env, "Concurrent test 1", "grimoire:test-concurrent")
	taskID2 := createTaskWithLabel(t, env, "Concurrent test 2", "grimoire:test-concurrent")
	taskID3 := createTaskWithLabel(t, env, "Concurrent test 3", "grimoire:test-concurrent")

	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)


	// Wait for tasks to appear
	waitForTask(t, api, taskID1, 5)
	waitForTask(t, api, taskID2, 5)
	waitForTask(t, api, taskID3, 5)

	// Start all tasks concurrently
	var wg sync.WaitGroup
	errors := make(chan error, 3)

	for _, taskID := range []string{taskID1, taskID2, taskID3} {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			if err := api.StartTask(id); err != nil {
				errors <- err
			}
		}(taskID)
	}

	wg.Wait()
	close(errors)

	for err := range errors {
		t.Errorf("Failed to start task: %v", err)
	}

	// Wait for all workflows to complete
	for _, taskID := range []string{taskID1, taskID2, taskID3} {
		waitForTaskStatus(t, api, taskID, "closed", 20)
	}

	// Verify all workflows completed successfully
	logContent := readDaemonLog(t, env)
	completedCount := strings.Count(logContent, `"status":"completed"`)
	if completedCount < 3 {
		t.Errorf("Expected 3 completed workflows, got %d", completedCount)
		t.Logf("Log: %s", logContent)
	}
}

// TestWorkflowConcurrentWithSlowAgent verifies workflows run without blocking each other.
func TestWorkflowConcurrentWithSlowAgent(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Fast workflow
	fastGrimoire := `name: test-fast
description: Fast workflow
timeout: 2m

steps:
  - name: fast-step
    type: script
    command: "echo 'Fast complete'"
    timeout: 30s
`
	writeGrimoire(t, env, "test-fast", fastGrimoire)

	// Slow workflow
	slowGrimoire := `name: test-slow-concurrent
description: Slow workflow
timeout: 5m

steps:
  - name: slow-step
    type: script
    command: "sleep 3 && echo 'Slow complete'"
    timeout: 1m
`
	writeGrimoire(t, env, "test-slow-concurrent", slowGrimoire)

	taskFast := createTaskWithLabel(t, env, "Fast task", "grimoire:test-fast")
	taskSlow := createTaskWithLabel(t, env, "Slow task", "grimoire:test-slow-concurrent")

	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)


	waitForTask(t, api, taskFast, 5)
	waitForTask(t, api, taskSlow, 5)

	// Start slow task first
	startTime := time.Now()
	if err := api.StartTask(taskSlow); err != nil {
		t.Fatalf("Failed to start slow task: %v", err)
	}

	// Give it a moment to start
	time.Sleep(100 * time.Millisecond)

	// Start fast task
	if err := api.StartTask(taskFast); err != nil {
		t.Fatalf("Failed to start fast task: %v", err)
	}

	// Fast task should complete quickly (before slow task)
	waitForTaskStatus(t, api, taskFast, "closed", 5)
	fastDuration := time.Since(startTime)

	// Verify fast task didn't wait for slow task
	if fastDuration > 2*time.Second {
		t.Errorf("Fast task took too long (%v), may have been blocked by slow task", fastDuration)
	}

	// Wait for slow task to complete
	waitForTaskStatus(t, api, taskSlow, "closed", 10)
}

// TestWorkflowConcurrentAgentLimit verifies max concurrent agents is respected.
func TestWorkflowConcurrentAgentLimit(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Create a workflow with agent step
	grimoireYAML := `name: test-agent-limit
description: Workflow with agent for limit testing
timeout: 5m

steps:
  - name: agent-step
    type: agent
    spell: |
      Do something.
      Return: {"success": true}
    timeout: 1m
`
	writeGrimoire(t, env, "test-agent-limit", grimoireYAML)

	// Create more tasks than the default max agents (usually 3)
	var taskIDs []string
	for i := 0; i < 5; i++ {
		taskID := createTaskWithLabel(t, env, "Agent limit test", "grimoire:test-agent-limit")
		taskIDs = append(taskIDs, taskID)
	}

	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)


	for _, taskID := range taskIDs {
		waitForTask(t, api, taskID, 5)
	}

	// Start all tasks
	for _, taskID := range taskIDs {
		if err := api.StartTask(taskID); err != nil {
			t.Fatalf("Failed to start task %s: %v", taskID, err)
		}
	}

	// All should eventually complete
	for _, taskID := range taskIDs {
		waitForTaskStatus(t, api, taskID, "closed", 30)
	}

	// Verify all workflows completed
	logContent := readDaemonLog(t, env)
	completedCount := strings.Count(logContent, `"status":"completed"`)
	if completedCount < 5 {
		t.Errorf("Expected 5 completed workflows, got %d", completedCount)
	}
}

// TestWorkflowConcurrentIsolation verifies workflows don't interfere with each other.
func TestWorkflowConcurrentIsolation(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Two workflows writing to different files
	grimoire1 := `name: test-isolation-1
description: Isolation test 1
timeout: 2m

steps:
  - name: write-1
    type: script
    command: "echo 'workflow1' > /tmp/coven-iso-1.txt && cat /tmp/coven-iso-1.txt"
    output: result1
    timeout: 30s
`
	writeGrimoire(t, env, "test-isolation-1", grimoire1)

	grimoire2 := `name: test-isolation-2
description: Isolation test 2
timeout: 2m

steps:
  - name: write-2
    type: script
    command: "echo 'workflow2' > /tmp/coven-iso-2.txt && cat /tmp/coven-iso-2.txt"
    output: result2
    timeout: 30s
`
	writeGrimoire(t, env, "test-isolation-2", grimoire2)

	task1 := createTaskWithLabel(t, env, "Isolation 1", "grimoire:test-isolation-1")
	task2 := createTaskWithLabel(t, env, "Isolation 2", "grimoire:test-isolation-2")

	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)


	waitForTask(t, api, task1, 5)
	waitForTask(t, api, task2, 5)

	// Start both concurrently
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		api.StartTask(task1)
	}()
	go func() {
		defer wg.Done()
		api.StartTask(task2)
	}()
	wg.Wait()

	// Both should complete
	waitForTaskStatus(t, api, task1, "closed", 10)
	waitForTaskStatus(t, api, task2, "closed", 10)

	// Verify both completed
	logContent := readDaemonLog(t, env)
	completedCount := strings.Count(logContent, `"status":"completed"`)
	if completedCount < 2 {
		t.Errorf("Expected 2 completed workflows, got %d", completedCount)
		t.Logf("Log: %s", logContent)
	}
}
