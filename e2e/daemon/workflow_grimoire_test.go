//go:build e2e

package daemon_e2e

import (
	"strings"
	"testing"

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

	waitForTaskStatus(t, api, taskID, "closed", 30)

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
	mappingConfig := `{
  "mappings": {
    "types": {
      "bug": "fix-bug",
      "feature": "implement-feature"
    },
    "default": "implement-bead"
  }
}`
	writeCovenConfig(t, env, "grimoire-mapping.json", mappingConfig)

	// Create tasks of each type
	bugTaskID := createTaskWithType(t, env, "Fix login issue", "bug")
	featureTaskID := createTaskWithType(t, env, "Add notifications", "feature")

	env.ConfigureMockAgent(t)
	env.MustStart()
	api := helpers.NewAPIClient(env)

	if err := api.StartSession(); err != nil {
		t.Fatalf("Failed to start session: %v", err)
	}

	waitForTask(t, api, bugTaskID, 5)
	waitForTask(t, api, featureTaskID, 5)

	// Run bug task
	if err := api.StartTask(bugTaskID); err != nil {
		t.Fatalf("Failed to start bug task: %v", err)
	}
	waitForTaskStatus(t, api, bugTaskID, "closed", 30)

	// Run feature task
	if err := api.StartTask(featureTaskID); err != nil {
		t.Fatalf("Failed to start feature task: %v", err)
	}
	waitForTaskStatus(t, api, featureTaskID, "closed", 30)

	logContent := readDaemonLog(t, env)

	if !strings.Contains(logContent, "BUG_FIX_WORKFLOW") {
		t.Error("Bug task should use fix-bug grimoire")
	}
	if !strings.Contains(logContent, "FEATURE_WORKFLOW") {
		t.Error("Feature task should use implement-feature grimoire")
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

	// Should use default workflow and complete
	waitForTaskStatus(t, api, taskID, "closed", 60)

	logContent := readDaemonLog(t, env)
	// Default grimoire should be implement-bead
	if !strings.Contains(logContent, "implement-bead") && !strings.Contains(logContent, "resolved grimoire") {
		t.Log("Log content:", logContent)
		t.Error("Should have resolved to default grimoire")
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

	// Built-in grimoire should execute
	waitForTaskStatus(t, api, taskID, "closed", 120)
}
