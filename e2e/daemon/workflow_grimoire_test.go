//go:build e2e

package daemon_e2e

import (
	"strings"
	"testing"
	"time"

	"github.com/coven/e2e/daemon/helpers"
)

// TestWorkflowGrimoireResolutionByLabel verifies grimoire resolution via task labels.
func TestWorkflowGrimoireResolutionByLabel(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Create grimoire that will be selected by label
	grimoireYAML := `name: custom-workflow
description: Custom workflow selected by label
timeout: 5m

steps:
  - name: custom-step
    type: script
    command: "echo 'CUSTOM_GRIMOIRE_EXECUTED'"
    timeout: 1m
`
	writeGrimoire(t, env, "custom-workflow", grimoireYAML)

	// Create task with explicit grimoire label
	taskID := createTaskWithLabel(t, env, "Custom task", "grimoire:custom-workflow")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	waitForTaskStatus(t, api, taskID, "closed", 10)

	// Verify the custom grimoire was resolved
	logContent := readDaemonLog(t, env)
	if !strings.Contains(logContent, `"grimoire":"custom-workflow"`) {
		t.Logf("Log: %s", logContent)
		t.Error("Custom grimoire should have been selected by label")
	}
}

// TestWorkflowGrimoireResolutionByType verifies grimoire resolution via task type.
func TestWorkflowGrimoireResolutionByType(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Create type-specific grimoires
	bugGrimoire := `name: fix-bug
description: Bug fix workflow
timeout: 5m
steps:
  - name: fix
    type: script
    command: "echo 'BUG_FIX_WORKFLOW'"
    timeout: 1m
`
	featureGrimoire := `name: implement-feature
description: Feature workflow
timeout: 5m
steps:
  - name: implement
    type: script
    command: "echo 'FEATURE_WORKFLOW'"
    timeout: 1m
`
	writeGrimoire(t, env, "fix-bug", bugGrimoire)
	writeGrimoire(t, env, "implement-feature", featureGrimoire)

	// Create mapping configuration
	// Must match GrimoireMappingConfig struct: {"default": "...", "by_type": {...}}
	mappingConfig := `{
  "default": "implement-bead",
  "by_type": {
    "bug": "fix-bug",
    "feature": "implement-feature"
  }
}`
	writeCovenConfig(t, env, "grimoire-mapping.json", mappingConfig)

	// Create tasks of each type
	bugTaskID := createTaskWithType(t, env, "Fix login issue", "bug")

	env.ConfigureMockAgent(t)
	env.MustStart()
	api := helpers.NewAPIClient(env)


	waitForTask(t, api, bugTaskID, 5)

	// Run bug task
	if err := api.StartTask(bugTaskID); err != nil {
		t.Fatalf("Failed to start bug task: %v", err)
	}
	// Short timeout - should fail fast if type-based mapping not implemented
	waitForTaskStatus(t, api, bugTaskID, "closed", 10)

	// Verify the fix-bug grimoire was resolved based on task type
	logContent := readDaemonLog(t, env)
	if !strings.Contains(logContent, `"grimoire":"fix-bug"`) {
		t.Log("Log:", logContent)
		t.Error("Bug task should use fix-bug grimoire via type-based mapping")
	}
}

// TestWorkflowGrimoireDefaultFallback verifies default grimoire is used when no match.
func TestWorkflowGrimoireDefaultFallback(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Create a task with no special labels or type mapping
	// Should fall back to default (implement-bead builtin)
	taskID := env.CreateBeadsTask(t, "Generic task", 1)
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for the workflow to start and resolve grimoire
	// NOTE: implement-bead has npm test which will fail in test env,
	// so we verify grimoire resolution rather than completion
	deadline := time.Now().Add(15 * time.Second)
	var foundGrimoire bool
	for time.Now().Before(deadline) {
		logContent := readDaemonLog(t, env)
		if strings.Contains(logContent, `"grimoire":"implement-bead"`) {
			foundGrimoire = true
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	if !foundGrimoire {
		logContent := readDaemonLog(t, env)
		t.Log("Log content:", logContent)
		t.Error("Should have resolved to implement-bead grimoire")
	}
}

// TestWorkflowBuiltinGrimoireAvailable verifies builtin grimoires work.
func TestWorkflowBuiltinGrimoireAvailable(t *testing.T) {
	env := helpers.NewTestEnv(t)
	defer env.Stop()

	env.InitBeads(t)

	// Use the builtin implement-bead grimoire
	taskID := createTaskWithLabel(t, env, "Use builtin", "grimoire:implement-bead")
	env.ConfigureMockAgent(t)

	env.MustStart()
	api := helpers.NewAPIClient(env)

	startSessionAndWaitForTask(t, env, api, taskID)

	if err := api.StartTask(taskID); err != nil {
		t.Fatalf("Failed to start task: %v", err)
	}

	// Wait for the workflow to start and resolve grimoire
	// NOTE: implement-bead has npm test which will fail in test env,
	// so we verify grimoire resolution and first agent step execution
	deadline := time.Now().Add(15 * time.Second)
	var foundGrimoire bool
	for time.Now().Before(deadline) {
		logContent := readDaemonLog(t, env)
		if strings.Contains(logContent, `"grimoire":"implement-bead"`) &&
			strings.Contains(logContent, "spawned agent process") {
			foundGrimoire = true
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	if !foundGrimoire {
		logContent := readDaemonLog(t, env)
		t.Log("Log content:", logContent)
		t.Error("Should have resolved implement-bead grimoire and started agent")
	}
}
