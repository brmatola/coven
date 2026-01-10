//go:build e2e

package daemon_e2e

import (
	"os"
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// TestWorkflowResumption verifies workflows resume from checkpoint after daemon restart.
// This test uses the workflow API to verify step progress instead of timing-based synchronization.
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
	defer os.Remove(step1Marker)
	defer os.Remove(step2Marker)
	defer os.Remove(step3Marker)

	// Use a long-running step 2 (15s) to ensure we have time to verify and kill
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
    command: "sleep 15 && echo 'done' > ` + step2Marker + `"
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

	// Wait for step-one to complete and step-two to start.
	// CurrentStep shows the last completed step (0 after step-one completes).
	// We verify step-one is in CompletedSteps to confirm it finished.
	deadline := time.Now().Add(10 * time.Second)
	var workflow *helpers.Workflow
	for time.Now().Before(deadline) {
		var err error
		workflow, err = api.GetWorkflow(taskID)
		if err != nil {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		// Check if step-one is in completed steps (meaning step-two is now running)
		if workflow != nil && workflow.CompletedSteps != nil {
			if _, ok := workflow.CompletedSteps["step-one"]; ok {
				t.Logf("Step-one completed, step-two now running (current_step: %d)", workflow.CurrentStep)
				break
			}
		}
		time.Sleep(200 * time.Millisecond)
	}

	if workflow == nil || workflow.CompletedSteps["step-one"] == nil {
		t.Fatalf("Step-one did not complete - workflow: %+v", workflow)
	}

	// Verify step 1 completed via marker
	if _, err := os.Stat(step1Marker); os.IsNotExist(err) {
		t.Fatal("Step 1 marker should exist")
	}

	// Kill daemon while step 2 is running (it sleeps for 15s so we have plenty of time)
	if err := env.Cmd.Process.Kill(); err != nil {
		t.Fatalf("Failed to kill daemon: %v", err)
	}
	env.Cmd.Wait()

	// Verify step 2 did NOT complete (killed before 15s sleep finished)
	if _, err := os.Stat(step2Marker); err == nil {
		t.Fatal("Step 2 should not have completed yet (was killed during 15s sleep)")
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
	// Wait for step 3 to complete (longer timeout since step 2 still needs to finish)
	deadline = time.Now().Add(25 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(step3Marker); err == nil {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	// Verify workflow completed
	if _, err := os.Stat(step3Marker); os.IsNotExist(err) {
		t.Error("Workflow did not resume and complete after daemon restart")
	} else {
		t.Log("Workflow successfully resumed and completed after daemon restart")
	}

	// Verify step 1 was NOT re-run (marker should still be removed)
	if _, err := os.Stat(step1Marker); err == nil {
		t.Error("Step 1 should not have re-run after resume")
	}
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
    command: "sleep 2 && echo 'Second step'"
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
	time.Sleep(1 * time.Second)

	// Check that workflow state file exists
	stateDir := env.CovenDir + "/workflows"
	if _, err := os.Stat(stateDir); os.IsNotExist(err) {
		t.Error("Workflow state directory should exist (state persistence not implemented)")
	}

	// Check for state file for this task
	stateFiles, _ := os.ReadDir(stateDir)
	if len(stateFiles) == 0 {
		t.Error("Expected workflow state file to be persisted (state persistence not implemented)")
	}
}
