package workflow

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNewStatePersister(t *testing.T) {
	persister := NewStatePersister("/test/coven")

	expectedDir := "/test/coven/workflows"
	if persister.StateDir() != expectedDir {
		t.Errorf("StateDir() = %q, want %q", persister.StateDir(), expectedDir)
	}
}

func TestStatePersister_SaveAndLoad(t *testing.T) {
	tmpDir := t.TempDir()
	persister := NewStatePersister(tmpDir)

	state := &WorkflowState{
		TaskID:       "task-123",
		WorkflowID:   "wf-456",
		GrimoireName: "test-grimoire",
		WorktreePath: "/path/to/worktree",
		Status:       WorkflowRunning,
		CurrentStep:  2,
		CompletedSteps: map[string]*StepResult{
			"step-1": {Success: true, Output: "done"},
		},
		StepOutputs: map[string]string{
			"step-1": "output-value",
		},
		StartedAt: time.Now().Add(-1 * time.Hour),
		Error:     "",
	}

	// Save
	if err := persister.Save(state); err != nil {
		t.Fatalf("Save() error: %v", err)
	}

	// Verify file exists
	statePath := filepath.Join(tmpDir, "workflows", "task-123.json")
	if _, err := os.Stat(statePath); os.IsNotExist(err) {
		t.Fatal("State file was not created")
	}

	// Load
	loaded, err := persister.Load("task-123")
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if loaded == nil {
		t.Fatal("Load() returned nil")
	}

	// Verify loaded state matches
	if loaded.TaskID != state.TaskID {
		t.Errorf("TaskID = %q, want %q", loaded.TaskID, state.TaskID)
	}
	if loaded.WorkflowID != state.WorkflowID {
		t.Errorf("WorkflowID = %q, want %q", loaded.WorkflowID, state.WorkflowID)
	}
	if loaded.GrimoireName != state.GrimoireName {
		t.Errorf("GrimoireName = %q, want %q", loaded.GrimoireName, state.GrimoireName)
	}
	if loaded.Status != state.Status {
		t.Errorf("Status = %q, want %q", loaded.Status, state.Status)
	}
	if loaded.CurrentStep != state.CurrentStep {
		t.Errorf("CurrentStep = %d, want %d", loaded.CurrentStep, state.CurrentStep)
	}
	if len(loaded.CompletedSteps) != len(state.CompletedSteps) {
		t.Errorf("CompletedSteps length = %d, want %d", len(loaded.CompletedSteps), len(state.CompletedSteps))
	}
	if len(loaded.StepOutputs) != len(state.StepOutputs) {
		t.Errorf("StepOutputs length = %d, want %d", len(loaded.StepOutputs), len(state.StepOutputs))
	}

	// Verify UpdatedAt was set
	if loaded.UpdatedAt.IsZero() {
		t.Error("UpdatedAt should be set on save")
	}
}

func TestStatePersister_Load_NotFound(t *testing.T) {
	tmpDir := t.TempDir()
	persister := NewStatePersister(tmpDir)

	state, err := persister.Load("nonexistent-task")
	if err != nil {
		t.Errorf("Load() error: %v, expected nil error for nonexistent file", err)
	}
	if state != nil {
		t.Error("Load() should return nil for nonexistent file")
	}
}

func TestStatePersister_Load_InvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	persister := NewStatePersister(tmpDir)

	// Create invalid JSON file
	stateDir := filepath.Join(tmpDir, "workflows")
	os.MkdirAll(stateDir, 0755)
	os.WriteFile(filepath.Join(stateDir, "bad-task.json"), []byte("invalid json"), 0644)

	_, err := persister.Load("bad-task")
	if err == nil {
		t.Error("Load() should return error for invalid JSON")
	}
}

func TestStatePersister_Delete(t *testing.T) {
	tmpDir := t.TempDir()
	persister := NewStatePersister(tmpDir)

	// Create state file
	state := &WorkflowState{
		TaskID:     "task-to-delete",
		WorkflowID: "wf-1",
		Status:     WorkflowCompleted,
	}
	if err := persister.Save(state); err != nil {
		t.Fatalf("Save() error: %v", err)
	}

	// Verify file exists
	if !persister.Exists("task-to-delete") {
		t.Fatal("State file should exist before delete")
	}

	// Delete
	if err := persister.Delete("task-to-delete"); err != nil {
		t.Fatalf("Delete() error: %v", err)
	}

	// Verify file is gone
	if persister.Exists("task-to-delete") {
		t.Error("State file should not exist after delete")
	}
}

func TestStatePersister_Delete_NotFound(t *testing.T) {
	tmpDir := t.TempDir()
	persister := NewStatePersister(tmpDir)

	// Delete nonexistent file should succeed
	err := persister.Delete("nonexistent-task")
	if err != nil {
		t.Errorf("Delete() should succeed for nonexistent file, got error: %v", err)
	}
}

func TestStatePersister_ListInterrupted(t *testing.T) {
	tmpDir := t.TempDir()
	persister := NewStatePersister(tmpDir)

	// Create various workflow states
	states := []*WorkflowState{
		{TaskID: "running-1", WorkflowID: "wf-1", Status: WorkflowRunning},
		{TaskID: "running-2", WorkflowID: "wf-2", Status: WorkflowRunning},
		{TaskID: "completed-1", WorkflowID: "wf-3", Status: WorkflowCompleted},
		{TaskID: "failed-1", WorkflowID: "wf-4", Status: WorkflowFailed},
		{TaskID: "pending-1", WorkflowID: "wf-5", Status: WorkflowPendingMerge},
	}

	for _, s := range states {
		if err := persister.Save(s); err != nil {
			t.Fatalf("Save() error: %v", err)
		}
	}

	// Get interrupted workflows
	interrupted, err := persister.ListInterrupted()
	if err != nil {
		t.Fatalf("ListInterrupted() error: %v", err)
	}

	// Should only have the running workflows
	if len(interrupted) != 2 {
		t.Errorf("ListInterrupted() returned %d workflows, want 2", len(interrupted))
	}

	// Verify they are the running ones
	foundRunning1, foundRunning2 := false, false
	for _, s := range interrupted {
		if s.TaskID == "running-1" {
			foundRunning1 = true
		}
		if s.TaskID == "running-2" {
			foundRunning2 = true
		}
	}
	if !foundRunning1 || !foundRunning2 {
		t.Error("ListInterrupted() should return running-1 and running-2")
	}
}

func TestStatePersister_ListInterrupted_EmptyDir(t *testing.T) {
	tmpDir := t.TempDir()
	persister := NewStatePersister(tmpDir)

	// Don't create any files
	interrupted, err := persister.ListInterrupted()
	if err != nil {
		t.Fatalf("ListInterrupted() error: %v", err)
	}
	if interrupted != nil && len(interrupted) != 0 {
		t.Errorf("ListInterrupted() should return nil or empty for empty/nonexistent dir, got %d items", len(interrupted))
	}
}

func TestStatePersister_Exists(t *testing.T) {
	tmpDir := t.TempDir()
	persister := NewStatePersister(tmpDir)

	// Should not exist initially
	if persister.Exists("task-exists-test") {
		t.Error("Exists() should return false before save")
	}

	// Save state
	state := &WorkflowState{
		TaskID:     "task-exists-test",
		WorkflowID: "wf-1",
		Status:     WorkflowRunning,
	}
	if err := persister.Save(state); err != nil {
		t.Fatalf("Save() error: %v", err)
	}

	// Should exist now
	if !persister.Exists("task-exists-test") {
		t.Error("Exists() should return true after save")
	}

	// Delete and verify
	persister.Delete("task-exists-test")
	if persister.Exists("task-exists-test") {
		t.Error("Exists() should return false after delete")
	}
}

func TestStatePersister_Save_AtomicWrite(t *testing.T) {
	tmpDir := t.TempDir()
	persister := NewStatePersister(tmpDir)

	state := &WorkflowState{
		TaskID:     "atomic-test",
		WorkflowID: "wf-1",
		Status:     WorkflowRunning,
	}

	// Save multiple times to verify atomic write doesn't leave temp files
	for i := 0; i < 5; i++ {
		state.CurrentStep = i
		if err := persister.Save(state); err != nil {
			t.Fatalf("Save() iteration %d error: %v", i, err)
		}
	}

	// Verify no temp files remain
	stateDir := filepath.Join(tmpDir, "workflows")
	entries, _ := os.ReadDir(stateDir)
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".tmp" {
			t.Errorf("Found leftover temp file: %s", e.Name())
		}
	}

	// Verify final state
	loaded, _ := persister.Load("atomic-test")
	if loaded.CurrentStep != 4 {
		t.Errorf("CurrentStep = %d, want 4", loaded.CurrentStep)
	}
}

func TestStatePersister_ListInterrupted_IgnoresDirectories(t *testing.T) {
	tmpDir := t.TempDir()
	persister := NewStatePersister(tmpDir)

	// Create state directory
	stateDir := filepath.Join(tmpDir, "workflows")
	os.MkdirAll(stateDir, 0755)

	// Create a valid state file
	state := &WorkflowState{
		TaskID:     "real-task",
		WorkflowID: "wf-1",
		Status:     WorkflowRunning,
	}
	persister.Save(state)

	// Create a subdirectory (should be ignored)
	os.MkdirAll(filepath.Join(stateDir, "subdir"), 0755)

	// Create a non-JSON file (should be ignored)
	os.WriteFile(filepath.Join(stateDir, "notes.txt"), []byte("notes"), 0644)

	interrupted, err := persister.ListInterrupted()
	if err != nil {
		t.Fatalf("ListInterrupted() error: %v", err)
	}

	// Should only find the one valid running workflow
	if len(interrupted) != 1 {
		t.Errorf("ListInterrupted() returned %d workflows, want 1", len(interrupted))
	}
	if len(interrupted) > 0 && interrupted[0].TaskID != "real-task" {
		t.Errorf("Expected task 'real-task', got %s", interrupted[0].TaskID)
	}
}
