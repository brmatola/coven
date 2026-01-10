//go:build integration

package workflow

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/coven/daemon/internal/grimoire"
	"github.com/coven/daemon/internal/spell"
)

// TestIntegration_GrimoireLoading verifies grimoire loading from filesystem and embedded sources.
func TestIntegration_GrimoireLoading(t *testing.T) {
	tmpDir := t.TempDir()
	covenDir := filepath.Join(tmpDir, ".coven")
	if err := os.MkdirAll(filepath.Join(covenDir, "grimoires"), 0755); err != nil {
		t.Fatalf("Failed to create grimoires dir: %v", err)
	}

	t.Run("BuiltinGrimoires", func(t *testing.T) {
		loader := grimoire.NewLoader(covenDir)
		grimoires, err := loader.List()
		if err != nil {
			t.Fatalf("List() error: %v", err)
		}

		expected := map[string]bool{
			"implement-bead": false,
			"spec-to-beads":  false,
		}
		for _, name := range grimoires {
			if _, ok := expected[name]; ok {
				expected[name] = true
			}
		}
		for name, found := range expected {
			if !found {
				t.Errorf("Expected built-in grimoire %q not found", name)
			}
		}

		g, err := loader.Load("implement-bead")
		if err != nil {
			t.Fatalf("Load(implement-bead) error: %v", err)
		}
		if g.Name != "implement-bead" {
			t.Errorf("Name = %q, want %q", g.Name, "implement-bead")
		}
		if g.Source != grimoire.SourceBuiltIn {
			t.Errorf("Source = %q, want %q", g.Source, grimoire.SourceBuiltIn)
		}
		if len(g.Steps) < 2 {
			t.Errorf("Expected at least 2 steps, got %d", len(g.Steps))
		}
	})

	t.Run("UserGrimoires", func(t *testing.T) {
		userGrimoire := `name: test-workflow
description: Test workflow for integration testing
timeout: 5m

steps:
  - name: step-one
    type: script
    command: "echo 'Step one executed'"
    timeout: 1m

  - name: step-two
    type: script
    command: "echo 'Step two executed'"
    timeout: 1m
`
		grimoirePath := filepath.Join(covenDir, "grimoires", "test-workflow.yaml")
		if err := os.WriteFile(grimoirePath, []byte(userGrimoire), 0644); err != nil {
			t.Fatalf("Failed to write user grimoire: %v", err)
		}

		loader := grimoire.NewLoader(covenDir)
		g, err := loader.Load("test-workflow")
		if err != nil {
			t.Fatalf("Load(test-workflow) error: %v", err)
		}

		if g.Name != "test-workflow" {
			t.Errorf("Name = %q, want %q", g.Name, "test-workflow")
		}
		if g.Source != grimoire.SourceUser {
			t.Errorf("Source = %q, want %q", g.Source, grimoire.SourceUser)
		}
		if len(g.Steps) != 2 {
			t.Errorf("Expected 2 steps, got %d", len(g.Steps))
		}
	})

	t.Run("GrimoireNotFound", func(t *testing.T) {
		loader := grimoire.NewLoader(covenDir)
		_, err := loader.Load("nonexistent-grimoire")
		if err == nil {
			t.Error("Expected error for nonexistent grimoire")
		}
		if !grimoire.IsNotFound(err) {
			t.Errorf("Expected GrimoireNotFoundError, got: %v", err)
		}
	})
}

// TestIntegration_SpellLoading verifies spell loading and rendering.
func TestIntegration_SpellLoading(t *testing.T) {
	tmpDir := t.TempDir()
	covenDir := filepath.Join(tmpDir, ".coven")
	if err := os.MkdirAll(filepath.Join(covenDir, "spells"), 0755); err != nil {
		t.Fatalf("Failed to create spells dir: %v", err)
	}

	t.Run("BuiltinSpells", func(t *testing.T) {
		loader := spell.NewLoader(covenDir)
		spells, err := loader.List()
		if err != nil {
			t.Fatalf("List() error: %v", err)
		}

		expected := []string{"implement", "fix-tests", "review", "is-actionable", "apply-review-fixes", "analyze-spec", "create-beads"}
		for _, name := range expected {
			found := false
			for _, s := range spells {
				if s == name {
					found = true
					break
				}
			}
			if !found {
				t.Errorf("Expected built-in spell %q not found in %v", name, spells)
			}
		}
	})

	t.Run("UserSpells", func(t *testing.T) {
		userSpell := `# Test Spell

This is a test spell for integration testing.

## Input
- Test input: {{.test_input | default "no input"}}

## Instructions
Execute the test with the provided input.
`
		spellPath := filepath.Join(covenDir, "spells", "test-spell.md")
		if err := os.WriteFile(spellPath, []byte(userSpell), 0644); err != nil {
			t.Fatalf("Failed to write user spell: %v", err)
		}

		loader := spell.NewLoader(covenDir)
		s, err := loader.Load("test-spell")
		if err != nil {
			t.Fatalf("Load(test-spell) error: %v", err)
		}

		if s.Name != "test-spell" {
			t.Errorf("Name = %q, want %q", s.Name, "test-spell")
		}
		if s.Source != spell.SourceUser {
			t.Errorf("Source = %q, want %q", s.Source, spell.SourceUser)
		}
	})

	t.Run("SpellRendering", func(t *testing.T) {
		templateSpell := `# Task: {{.task_title}}

## Description
{{.task_body}}

## Priority
{{.priority | default "P2"}}
`
		spellPath := filepath.Join(covenDir, "spells", "template-spell.md")
		if err := os.WriteFile(spellPath, []byte(templateSpell), 0644); err != nil {
			t.Fatalf("Failed to write template spell: %v", err)
		}

		loader := spell.NewLoader(covenDir)
		s, err := loader.Load("template-spell")
		if err != nil {
			t.Fatalf("Load(template-spell) error: %v", err)
		}

		renderer := spell.NewRenderer()
		ctx := spell.RenderContext{
			"task_title": "Implement Feature X",
			"task_body":  "This feature adds new functionality",
			"priority":   "P1",
		}

		rendered, err := renderer.Render(s, ctx)
		if err != nil {
			t.Fatalf("Render() error: %v", err)
		}

		if !containsString(rendered, "Implement Feature X") {
			t.Error("Rendered spell should contain task title")
		}
		if !containsString(rendered, "This feature adds new functionality") {
			t.Error("Rendered spell should contain task body")
		}
		if !containsString(rendered, "P1") {
			t.Error("Rendered spell should contain priority")
		}
	})
}

func containsString(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsStringHelper(s, substr))
}

func containsStringHelper(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// TestIntegration_WorkflowExecution_SimpleGrimoire verifies basic workflow execution.
func TestIntegration_WorkflowExecution_SimpleGrimoire(t *testing.T) {
	tmpDir := t.TempDir()
	covenDir := filepath.Join(tmpDir, ".coven")
	worktree := filepath.Join(tmpDir, "worktree")

	for _, dir := range []string{
		filepath.Join(covenDir, "grimoires"),
		filepath.Join(covenDir, "spells"),
		worktree,
	} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatalf("Failed to create dir %s: %v", dir, err)
		}
	}

	simpleGrimoire := `name: simple-test
description: Simple workflow with script steps
timeout: 2m

steps:
  - name: create-file
    type: script
    command: "echo 'hello' > test-output.txt"
    timeout: 30s

  - name: verify-file
    type: script
    command: "cat test-output.txt"
    timeout: 30s

  - name: cleanup
    type: script
    command: "rm test-output.txt"
    timeout: 30s
`
	grimoirePath := filepath.Join(covenDir, "grimoires", "simple-test.yaml")
	if err := os.WriteFile(grimoirePath, []byte(simpleGrimoire), 0644); err != nil {
		t.Fatalf("Failed to write grimoire: %v", err)
	}

	engine := NewEngine(EngineConfig{
		CovenDir:     covenDir,
		WorktreePath: worktree,
		BeadID:       "test-bead-001",
		WorkflowID:   "test-workflow-001",
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result := engine.ExecuteByName(ctx, "simple-test")

	if result.Status != WorkflowCompleted {
		t.Errorf("Status = %v, want %v", result.Status, WorkflowCompleted)
		if result.Error != nil {
			t.Errorf("Error: %v", result.Error)
		}
	}

	expectedSteps := []string{"create-file", "verify-file", "cleanup"}
	for _, step := range expectedSteps {
		if _, ok := result.StepResults[step]; !ok {
			t.Errorf("Step %q not found in results", step)
		}
	}
}

// TestIntegration_WorkflowExecution_MultiStep verifies multi-step workflow execution.
func TestIntegration_WorkflowExecution_MultiStep(t *testing.T) {
	tmpDir := t.TempDir()
	covenDir := filepath.Join(tmpDir, ".coven")
	worktree := filepath.Join(tmpDir, "worktree")

	for _, dir := range []string{
		filepath.Join(covenDir, "grimoires"),
		worktree,
	} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatalf("Failed to create dir %s: %v", dir, err)
		}
	}

	contextGrimoire := `name: context-test
description: Workflow testing context propagation
timeout: 2m

steps:
  - name: generate-data
    type: script
    command: "echo 'test-data-123'"
    timeout: 30s
    output: generated_data

  - name: use-data
    type: script
    command: "echo 'Processing data'"
    timeout: 30s
`
	grimoirePath := filepath.Join(covenDir, "grimoires", "context-test.yaml")
	if err := os.WriteFile(grimoirePath, []byte(contextGrimoire), 0644); err != nil {
		t.Fatalf("Failed to write grimoire: %v", err)
	}

	engine := NewEngine(EngineConfig{
		CovenDir:     covenDir,
		WorktreePath: worktree,
		BeadID:       "test-bead-002",
		WorkflowID:   "test-workflow-002",
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result := engine.ExecuteByName(ctx, "context-test")

	if result.Status != WorkflowCompleted {
		t.Errorf("Status = %v, want %v", result.Status, WorkflowCompleted)
		if result.Error != nil {
			t.Errorf("Error: %v", result.Error)
		}
	}

	if stepResult, ok := result.StepResults["generate-data"]; ok {
		if stepResult.Output == "" {
			t.Error("Expected output from generate-data step")
		}
	} else {
		t.Error("generate-data step not found in results")
	}
}

// TestIntegration_WorkflowExecution_StepFailure verifies workflow handles step failures.
func TestIntegration_WorkflowExecution_StepFailure(t *testing.T) {
	tmpDir := t.TempDir()
	covenDir := filepath.Join(tmpDir, ".coven")
	worktree := filepath.Join(tmpDir, "worktree")

	for _, dir := range []string{
		filepath.Join(covenDir, "grimoires"),
		worktree,
	} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatalf("Failed to create dir %s: %v", dir, err)
		}
	}

	failingGrimoire := `name: failing-test
description: Workflow with a failing step
timeout: 2m

steps:
  - name: successful-step
    type: script
    command: "echo 'success'"
    timeout: 30s

  - name: failing-step
    type: script
    command: "exit 1"
    timeout: 30s

  - name: should-not-run
    type: script
    command: "echo 'this should not run'"
    timeout: 30s
`
	grimoirePath := filepath.Join(covenDir, "grimoires", "failing-test.yaml")
	if err := os.WriteFile(grimoirePath, []byte(failingGrimoire), 0644); err != nil {
		t.Fatalf("Failed to write grimoire: %v", err)
	}

	engine := NewEngine(EngineConfig{
		CovenDir:     covenDir,
		WorktreePath: worktree,
		BeadID:       "test-bead-003",
		WorkflowID:   "test-workflow-003",
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result := engine.ExecuteByName(ctx, "failing-test")

	if result.Status != WorkflowFailed {
		t.Errorf("Status = %v, want %v", result.Status, WorkflowFailed)
	}

	if _, ok := result.StepResults["successful-step"]; !ok {
		t.Error("successful-step should have been executed")
	}

	if _, ok := result.StepResults["should-not-run"]; ok {
		t.Error("should-not-run step should not have been executed")
	}
}

// TestIntegration_WorkflowExecution_OnFailContinue verifies on_fail: continue behavior.
func TestIntegration_WorkflowExecution_OnFailContinue(t *testing.T) {
	tmpDir := t.TempDir()
	covenDir := filepath.Join(tmpDir, ".coven")
	worktree := filepath.Join(tmpDir, "worktree")

	for _, dir := range []string{
		filepath.Join(covenDir, "grimoires"),
		worktree,
	} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatalf("Failed to create dir %s: %v", dir, err)
		}
	}

	continueGrimoire := `name: continue-test
description: Workflow that continues after failure
timeout: 2m

steps:
  - name: step-one
    type: script
    command: "echo 'step one'"
    timeout: 30s

  - name: failing-step
    type: script
    command: "exit 1"
    timeout: 30s
    on_fail: continue

  - name: step-three
    type: script
    command: "echo 'step three'"
    timeout: 30s
`
	grimoirePath := filepath.Join(covenDir, "grimoires", "continue-test.yaml")
	if err := os.WriteFile(grimoirePath, []byte(continueGrimoire), 0644); err != nil {
		t.Fatalf("Failed to write grimoire: %v", err)
	}

	engine := NewEngine(EngineConfig{
		CovenDir:     covenDir,
		WorktreePath: worktree,
		BeadID:       "test-bead-004",
		WorkflowID:   "test-workflow-004",
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result := engine.ExecuteByName(ctx, "continue-test")

	if result.Status != WorkflowCompleted {
		t.Errorf("Status = %v, want %v", result.Status, WorkflowCompleted)
		if result.Error != nil {
			t.Errorf("Error: %v", result.Error)
		}
	}

	expectedSteps := []string{"step-one", "failing-step", "step-three"}
	for _, step := range expectedSteps {
		if _, ok := result.StepResults[step]; !ok {
			t.Errorf("Step %q not found in results", step)
		}
	}
}

// TestIntegration_WorkflowExecution_GrimoireNotFound verifies error handling for missing grimoire.
func TestIntegration_WorkflowExecution_GrimoireNotFound(t *testing.T) {
	tmpDir := t.TempDir()
	covenDir := filepath.Join(tmpDir, ".coven")
	worktree := filepath.Join(tmpDir, "worktree")

	for _, dir := range []string{covenDir, worktree} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatalf("Failed to create dir %s: %v", dir, err)
		}
	}

	engine := NewEngine(EngineConfig{
		CovenDir:     covenDir,
		WorktreePath: worktree,
		BeadID:       "test-bead-005",
		WorkflowID:   "test-workflow-005",
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result := engine.ExecuteByName(ctx, "nonexistent-grimoire")

	if result.Status != WorkflowFailed {
		t.Errorf("Status = %v, want %v", result.Status, WorkflowFailed)
	}
	if result.Error == nil {
		t.Error("Expected error for nonexistent grimoire")
	}
}

// TestIntegration_GrimoireMapper verifies grimoire resolution from labels and defaults.
func TestIntegration_GrimoireMapper(t *testing.T) {
	tmpDir := t.TempDir()
	covenDir := filepath.Join(tmpDir, ".coven")
	if err := os.MkdirAll(covenDir, 0755); err != nil {
		t.Fatalf("Failed to create coven dir: %v", err)
	}

	grimoireLoader := grimoire.NewLoader(covenDir)
	mapper := NewGrimoireMapper(covenDir, grimoireLoader)

	t.Run("ExplicitLabel", func(t *testing.T) {
		bead := BeadInfo{
			ID:     "test-1",
			Labels: []string{"priority:high", "grimoire:implement-bead"},
			Type:   "feature",
		}

		name, err := mapper.Resolve(bead)
		if err != nil {
			t.Fatalf("Resolve() error: %v", err)
		}
		if name != "implement-bead" {
			t.Errorf("Resolved = %q, want %q", name, "implement-bead")
		}
	})

	t.Run("DefaultByType", func(t *testing.T) {
		// Reset mapper config to force reload
		mapper.SetConfig(nil)

		bead := BeadInfo{
			ID:   "test-2",
			Type: "task",
		}

		name, err := mapper.Resolve(bead)
		if err != nil {
			t.Fatalf("Resolve() error: %v", err)
		}
		if name != "implement-bead" {
			t.Errorf("Resolved = %q, want %q", name, "implement-bead")
		}
	})

	t.Run("FallbackToBuiltinDefault", func(t *testing.T) {
		mapper.SetConfig(nil)

		bead := BeadInfo{
			ID: "test-3",
		}

		name, err := mapper.Resolve(bead)
		if err != nil {
			t.Fatalf("Resolve() error: %v", err)
		}
		if name != "implement-bead" {
			t.Errorf("Resolved = %q, want %q", name, "implement-bead")
		}
	})

	t.Run("InvalidGrimoireLabel", func(t *testing.T) {
		mapper.SetConfig(nil)

		bead := BeadInfo{
			ID:     "test-4",
			Labels: []string{"grimoire:nonexistent"},
		}

		_, err := mapper.Resolve(bead)
		if err == nil {
			t.Error("Expected error for nonexistent grimoire")
		}
	})
}

// =============================================================================
// Loop Step Tests (coven-6nq)
// =============================================================================

// TestIntegration_LoopStep_ExitOnSuccess verifies loop exits on on_success: exit_loop.
func TestIntegration_LoopStep_ExitOnSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	covenDir := filepath.Join(tmpDir, ".coven")
	worktree := filepath.Join(tmpDir, "worktree")

	for _, dir := range []string{
		filepath.Join(covenDir, "grimoires"),
		worktree,
	} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatalf("Failed to create dir %s: %v", dir, err)
		}
	}

	// Create grimoire with loop that exits on success
	loopGrimoire := `name: loop-exit-test
description: Test loop with exit on success
timeout: 2m

steps:
  - name: setup
    type: script
    command: "echo 0 > /tmp/counter-{{.workflow_id}}.txt"
    timeout: 10s

  - name: quality-loop
    type: loop
    max_iterations: 5
    on_max_iterations: exit
    steps:
      - name: increment
        type: script
        command: "cat /tmp/counter-{{.workflow_id}}.txt | xargs -I{} bash -c 'echo $(({} + 1)) > /tmp/counter-{{.workflow_id}}.txt && cat /tmp/counter-{{.workflow_id}}.txt'"
        timeout: 10s
        output: counter

      - name: check-done
        type: script
        command: "test $(cat /tmp/counter-{{.workflow_id}}.txt) -ge 2"
        timeout: 10s
        on_success: exit_loop
        on_fail: continue

  - name: cleanup
    type: script
    command: "rm -f /tmp/counter-{{.workflow_id}}.txt"
    timeout: 10s
`
	grimoirePath := filepath.Join(covenDir, "grimoires", "loop-exit-test.yaml")
	if err := os.WriteFile(grimoirePath, []byte(loopGrimoire), 0644); err != nil {
		t.Fatalf("Failed to write grimoire: %v", err)
	}

	workflowID := "test-loop-001"
	engine := NewEngine(EngineConfig{
		CovenDir:     covenDir,
		WorktreePath: worktree,
		BeadID:       "test-bead-loop",
		WorkflowID:   workflowID,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	result := engine.ExecuteByName(ctx, "loop-exit-test")

	if result.Status != WorkflowCompleted {
		t.Errorf("Status = %v, want %v", result.Status, WorkflowCompleted)
		if result.Error != nil {
			t.Errorf("Error: %v", result.Error)
		}
	}

	// Should have setup and quality-loop steps
	if _, ok := result.StepResults["setup"]; !ok {
		t.Error("setup step should have been executed")
	}
	if _, ok := result.StepResults["quality-loop"]; !ok {
		t.Error("quality-loop step should have been executed")
	}
}

// TestIntegration_LoopStep_MaxIterations verifies max_iterations enforcement.
func TestIntegration_LoopStep_MaxIterations(t *testing.T) {
	tmpDir := t.TempDir()
	covenDir := filepath.Join(tmpDir, ".coven")
	worktree := filepath.Join(tmpDir, "worktree")

	for _, dir := range []string{
		filepath.Join(covenDir, "grimoires"),
		worktree,
	} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatalf("Failed to create dir %s: %v", dir, err)
		}
	}

	// Create grimoire with loop that always fails (hits max iterations)
	maxIterGrimoire := `name: max-iter-test
description: Test loop max iterations
timeout: 2m

steps:
  - name: infinite-loop
    type: loop
    max_iterations: 3
    on_max_iterations: block
    steps:
      - name: always-fail
        type: script
        command: "exit 1"
        timeout: 10s
        on_fail: continue
`
	grimoirePath := filepath.Join(covenDir, "grimoires", "max-iter-test.yaml")
	if err := os.WriteFile(grimoirePath, []byte(maxIterGrimoire), 0644); err != nil {
		t.Fatalf("Failed to write grimoire: %v", err)
	}

	engine := NewEngine(EngineConfig{
		CovenDir:     covenDir,
		WorktreePath: worktree,
		BeadID:       "test-bead-maxiter",
		WorkflowID:   "test-maxiter-001",
	})

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	result := engine.ExecuteByName(ctx, "max-iter-test")

	// Should be blocked (on_max_iterations: block)
	if result.Status != WorkflowBlocked {
		t.Errorf("Status = %v, want %v (loop should hit max iterations and block)", result.Status, WorkflowBlocked)
	}
}

// =============================================================================
// Step-to-Step Context Propagation Tests (coven-skn)
// =============================================================================

// TestIntegration_ContextPropagation_StepOutput verifies output flows between steps.
func TestIntegration_ContextPropagation_StepOutput(t *testing.T) {
	tmpDir := t.TempDir()
	covenDir := filepath.Join(tmpDir, ".coven")
	worktree := filepath.Join(tmpDir, "worktree")

	for _, dir := range []string{
		filepath.Join(covenDir, "grimoires"),
		worktree,
	} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatalf("Failed to create dir %s: %v", dir, err)
		}
	}

	// Create grimoire that captures and passes output between steps
	contextGrimoire := `name: context-prop-test
description: Test context propagation between steps
timeout: 2m

steps:
  - name: step-one
    type: script
    command: "echo 'first-output-value'"
    timeout: 10s
    output: step_one_result

  - name: step-two
    type: script
    command: "echo 'step two runs after step one'"
    timeout: 10s
    output: step_two_result

  - name: step-three
    type: script
    command: "echo 'final step'"
    timeout: 10s
`
	grimoirePath := filepath.Join(covenDir, "grimoires", "context-prop-test.yaml")
	if err := os.WriteFile(grimoirePath, []byte(contextGrimoire), 0644); err != nil {
		t.Fatalf("Failed to write grimoire: %v", err)
	}

	engine := NewEngine(EngineConfig{
		CovenDir:     covenDir,
		WorktreePath: worktree,
		BeadID:       "test-bead-context",
		WorkflowID:   "test-context-001",
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result := engine.ExecuteByName(ctx, "context-prop-test")

	if result.Status != WorkflowCompleted {
		t.Errorf("Status = %v, want %v", result.Status, WorkflowCompleted)
		if result.Error != nil {
			t.Errorf("Error: %v", result.Error)
		}
	}

	// Verify each step captured output
	if stepResult, ok := result.StepResults["step-one"]; ok {
		if !containsString(stepResult.Output, "first-output-value") {
			t.Errorf("step-one output = %q, want to contain 'first-output-value'", stepResult.Output)
		}
	} else {
		t.Error("step-one not found in results")
	}

	if stepResult, ok := result.StepResults["step-two"]; ok {
		if !containsString(stepResult.Output, "step two runs after step one") {
			t.Errorf("step-two output = %q, want to contain 'step two runs after step one'", stepResult.Output)
		}
	} else {
		t.Error("step-two not found in results")
	}
}

// =============================================================================
// Timeout Enforcement Tests (coven-dow)
// =============================================================================

// TestIntegration_Timeout_StepTimeout verifies step timeout is enforced.
func TestIntegration_Timeout_StepTimeout(t *testing.T) {
	tmpDir := t.TempDir()
	covenDir := filepath.Join(tmpDir, ".coven")
	worktree := filepath.Join(tmpDir, "worktree")

	for _, dir := range []string{
		filepath.Join(covenDir, "grimoires"),
		worktree,
	} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatalf("Failed to create dir %s: %v", dir, err)
		}
	}

	// Create grimoire with a step that exceeds timeout
	timeoutGrimoire := `name: timeout-test
description: Test step timeout enforcement
timeout: 5m

steps:
  - name: fast-step
    type: script
    command: "echo 'fast'"
    timeout: 10s

  - name: slow-step
    type: script
    command: "sleep 10"
    timeout: 1s

  - name: after-timeout
    type: script
    command: "echo 'should not run'"
    timeout: 10s
`
	grimoirePath := filepath.Join(covenDir, "grimoires", "timeout-test.yaml")
	if err := os.WriteFile(grimoirePath, []byte(timeoutGrimoire), 0644); err != nil {
		t.Fatalf("Failed to write grimoire: %v", err)
	}

	engine := NewEngine(EngineConfig{
		CovenDir:     covenDir,
		WorktreePath: worktree,
		BeadID:       "test-bead-timeout",
		WorkflowID:   "test-timeout-001",
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result := engine.ExecuteByName(ctx, "timeout-test")

	// Workflow should fail due to timeout
	if result.Status != WorkflowFailed {
		t.Errorf("Status = %v, want %v (slow step should timeout)", result.Status, WorkflowFailed)
	}

	// Fast step should have completed
	if _, ok := result.StepResults["fast-step"]; !ok {
		t.Error("fast-step should have completed before timeout")
	}

	// Step after timeout should not have run
	if _, ok := result.StepResults["after-timeout"]; ok {
		t.Error("after-timeout step should not have been executed")
	}
}

// TestIntegration_Timeout_ContextCancellation verifies workflow responds to context cancellation.
func TestIntegration_Timeout_ContextCancellation(t *testing.T) {
	tmpDir := t.TempDir()
	covenDir := filepath.Join(tmpDir, ".coven")
	worktree := filepath.Join(tmpDir, "worktree")

	for _, dir := range []string{
		filepath.Join(covenDir, "grimoires"),
		worktree,
	} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatalf("Failed to create dir %s: %v", dir, err)
		}
	}

	// Create grimoire with slow steps
	slowGrimoire := `name: slow-workflow
description: Slow workflow for cancellation test
timeout: 5m

steps:
  - name: slow-step-1
    type: script
    command: "sleep 30"
    timeout: 1m

  - name: slow-step-2
    type: script
    command: "sleep 30"
    timeout: 1m
`
	grimoirePath := filepath.Join(covenDir, "grimoires", "slow-workflow.yaml")
	if err := os.WriteFile(grimoirePath, []byte(slowGrimoire), 0644); err != nil {
		t.Fatalf("Failed to write grimoire: %v", err)
	}

	engine := NewEngine(EngineConfig{
		CovenDir:     covenDir,
		WorktreePath: worktree,
		BeadID:       "test-bead-cancel",
		WorkflowID:   "test-cancel-001",
	})

	// Create context that will be cancelled
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	result := engine.ExecuteByName(ctx, "slow-workflow")

	// Workflow should be cancelled
	if result.Status != WorkflowCancelled && result.Status != WorkflowFailed {
		t.Errorf("Status = %v, want Cancelled or Failed (context was cancelled)", result.Status)
	}
}

// =============================================================================
// Preview/Dry-Run Mode Tests (coven-bvc)
// =============================================================================

// TestIntegration_Preview_SimpleGrimoire verifies preview mode shows expected output.
func TestIntegration_Preview_SimpleGrimoire(t *testing.T) {
	tmpDir := t.TempDir()
	covenDir := filepath.Join(tmpDir, ".coven")

	for _, dir := range []string{
		filepath.Join(covenDir, "grimoires"),
		filepath.Join(covenDir, "spells"),
	} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatalf("Failed to create dir %s: %v", dir, err)
		}
	}

	// Create grimoire
	previewGrimoire := `name: preview-test
description: Grimoire for preview testing
timeout: 10m

steps:
  - name: implement
    type: agent
    spell: preview-spell
    timeout: 5m
    output: implementation

  - name: verify
    type: script
    command: "echo 'Verification step'"
    timeout: 1m
`
	grimoirePath := filepath.Join(covenDir, "grimoires", "preview-test.yaml")
	if err := os.WriteFile(grimoirePath, []byte(previewGrimoire), 0644); err != nil {
		t.Fatalf("Failed to write grimoire: %v", err)
	}

	// Create spell
	previewSpell := `# Preview Spell

## Task
Implement the feature described in: {{.bead.title | default "No title"}}

## Description
{{.bead.body | default "No description"}}

## Instructions
1. Analyze the requirements
2. Implement the solution
3. Write tests
`
	spellPath := filepath.Join(covenDir, "spells", "preview-spell.md")
	if err := os.WriteFile(spellPath, []byte(previewSpell), 0644); err != nil {
		t.Fatalf("Failed to write spell: %v", err)
	}

	// Test preview functionality using Previewer
	previewer := NewPreviewer(covenDir)

	// Create preview options with bead data
	opts := &PreviewOptions{
		BeadData: &BeadData{
			ID:       "preview-bead-001",
			Title:    "Implement User Authentication",
			Body:     "Add login and logout functionality with JWT tokens",
			Type:     "feature",
			Priority: "P1",
		},
		MaxSpellPreviewLength: 2000,
		IncludeFullSpells:     true,
	}

	result, err := previewer.Preview("preview-test", opts)
	if err != nil {
		t.Fatalf("Preview() error: %v", err)
	}

	// Verify preview includes grimoire info
	if result.GrimoireName != "preview-test" {
		t.Errorf("GrimoireName = %q, want %q", result.GrimoireName, "preview-test")
	}

	// Verify grimoire is valid
	if !result.IsValid {
		t.Errorf("Expected grimoire to be valid, got errors: %v", result.Errors)
	}

	// Verify steps are previewed
	if len(result.Steps) != 2 {
		t.Errorf("Expected 2 steps in preview, got %d", len(result.Steps))
	}

	// Verify spell was rendered with context
	for _, step := range result.Steps {
		if step.Name == "implement" {
			if !containsString(step.SpellPreview, "Implement User Authentication") {
				t.Errorf("Rendered spell should contain bead title, got: %s", step.SpellPreview)
			}
			if !containsString(step.SpellPreview, "JWT tokens") {
				t.Errorf("Rendered spell should contain bead body content, got: %s", step.SpellPreview)
			}
		}
	}
}

// TestIntegration_Preview_Validation verifies preview validates grimoire.
func TestIntegration_Preview_Validation(t *testing.T) {
	tmpDir := t.TempDir()
	covenDir := filepath.Join(tmpDir, ".coven")

	for _, dir := range []string{
		filepath.Join(covenDir, "grimoires"),
	} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatalf("Failed to create dir %s: %v", dir, err)
		}
	}

	// Create invalid grimoire (missing required fields)
	invalidGrimoire := `name: invalid-test
steps: []
`
	grimoirePath := filepath.Join(covenDir, "grimoires", "invalid-test.yaml")
	if err := os.WriteFile(grimoirePath, []byte(invalidGrimoire), 0644); err != nil {
		t.Fatalf("Failed to write grimoire: %v", err)
	}

	grimoireLoader := grimoire.NewLoader(covenDir)

	// Try to load invalid grimoire
	_, err := grimoireLoader.Load("invalid-test")
	if err == nil {
		t.Error("Expected validation error for invalid grimoire")
	}

	// Verify error message indicates validation issue (description required or steps required)
	errStr := err.Error()
	if !containsString(errStr, "description") && !containsString(errStr, "validation") {
		t.Errorf("Expected error mentioning validation or description, got: %v", err)
	}
}
