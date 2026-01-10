//go:build e2e

package daemon_e2e

import (
	"os"
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// TestWorkflowResumption verifies workflows resume from checkpoint after daemon restart.
// This test:
// 1. Starts a workflow with multiple steps
// 2. Kills the daemon during step 2
// 3. Restarts the daemon
// 4. Verifies the workflow resumes from step 2 (not step 1)
func TestWorkflowResumption(t *testing.T) {
	env := helpers.NewTestEnv(t)
	// Don't defer env.Stop() - we restart manually

	env.InitBeads(t)

	// Marker files to track step execution
	step1Marker := "/tmp/coven-e2e-resume-step1.txt"
	step2Marker := "/tmp/coven-e2e-resume-step2.txt"
	step3Marker := "/tmp/coven-e2e-resume-step3.txt"

	// Clean up any existing markers
	os.Remove(step1Marker)
	os.Remove(step2Marker)
	os.Remove(step3Marker)

	grimoireYAML := `name: test-resume
description: Workflow to test checkpoint/resume
timeout: 10m

steps:
  - name: step-one
    type: script
    command: "echo 'done' > ` + step1Marker + `"
    timeout: 30s

  - name: step-two-slow
    type: script
    command: "sleep 5 && echo 'done' > ` + step2Marker + `"
    timeout: 2m

  - name: step-three
    type: script
    command: "echo 'done' > ` + step3Marker + `"
    timeout: 30s
`
	writeGrimoire(t, env, "test-resume", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test resumption", "grimoire:test-resume")
	env.ConfigureMockAgent(t)

	// Start daemon
	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for step 1 to complete
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(step1Marker); err == nil {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	if _, err := os.Stat(step1Marker); os.IsNotExist(err) {
		t.Fatal("Step 1 did not complete")
	}

	// Let step 2 start (it has a 5s sleep)
	time.Sleep(500 * time.Millisecond)

	// Kill daemon during step 2
	if err := env.Cmd.Process.Kill(); err != nil {
		t.Fatalf("Failed to kill daemon: %v", err)
	}
	env.Cmd.Wait()

	// Verify step 2 and 3 did NOT complete
	if _, err := os.Stat(step2Marker); err == nil {
		t.Log("Step 2 completed before kill - test timing issue")
		t.SkipNow()
	}

	// Clear step 1 marker to verify we DON'T re-run it
	os.Remove(step1Marker)

	// Restart daemon
	if err := env.Start(); err != nil {
		t.Fatalf("Failed to restart daemon: %v", err)
	}
	defer env.Stop()

	// Start new session
	api = helpers.NewAPIClient(env)
	if err := api.StartSession(); err != nil {
		t.Fatalf("Failed to start session: %v", err)
	}

	// Daemon should detect interrupted workflow and resume
	// Wait for completion
	deadline = time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(step3Marker); err == nil {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	// Verify workflow completed
	if _, err := os.Stat(step3Marker); os.IsNotExist(err) {
		t.Error("Workflow did not resume and complete after daemon restart")
	}

	// Verify step 1 was NOT re-run (marker should still be removed)
	if _, err := os.Stat(step1Marker); err == nil {
		t.Error("Step 1 should not have re-run after resume")
	}

	// Cleanup
	os.Remove(step1Marker)
	os.Remove(step2Marker)
	os.Remove(step3Marker)
}

// TestWorkflowStatePersistedToFile verifies workflow state is written to disk.
func TestWorkflowStatePersistedToFile(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	grimoireYAML := `name: test-persist
description: Test state persistence
timeout: 5m

steps:
  - name: first
    type: script
    command: "echo 'First step'"
    timeout: 30s

  - name: second
    type: script
    command: "sleep 3 && echo 'Second step'"
    timeout: 1m
`
	writeGrimoire(t, env, "test-persist", grimoireYAML)

	taskID := createTaskWithLabel(t, env, "Test persistence", "grimoire:test-persist")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Give it time to start and run first step
	time.Sleep(2 * time.Second)

	// Check that workflow state file exists
	// The exact path depends on implementation, but should be in .coven/workflows/
	stateDir := env.CovenDir + "/workflows"
	if _, err := os.Stat(stateDir); os.IsNotExist(err) {
		t.Error("Workflow state directory should exist")
	}

	// Check for state file for this task
	stateFiles, _ := os.ReadDir(stateDir)
	if len(stateFiles) == 0 {
		t.Error("Expected workflow state file to be persisted")
	}
}
