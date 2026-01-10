package questions

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStore_SaveAndGet(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	q := &Question{
		ID:     "q-test-1",
		TaskID: "task-123",
		Context: WorkflowContext{
			WorkflowID: "wf-123",
			StepName:   "implement",
			StepIndex:  0,
			StepTaskID: "task-123-step-1",
		},
		Type:       QuestionTypeConfirmation,
		Text:       "Proceed with changes?",
		DetectedAt: time.Now(),
	}

	// Save
	err := store.Save(q)
	if err != nil {
		t.Fatalf("failed to save question: %v", err)
	}

	// Verify file exists
	qPath := filepath.Join(dir, "questions", "q-test-1.json")
	if _, err := os.Stat(qPath); os.IsNotExist(err) {
		t.Error("question file was not created")
	}

	// Get from memory
	got := store.Get("q-test-1")
	if got == nil {
		t.Fatal("Get returned nil")
	}
	if got.ID != q.ID {
		t.Errorf("ID mismatch: got %s, want %s", got.ID, q.ID)
	}
	if got.TaskID != q.TaskID {
		t.Errorf("TaskID mismatch: got %s, want %s", got.TaskID, q.TaskID)
	}
	if got.Context.StepTaskID != q.Context.StepTaskID {
		t.Errorf("StepTaskID mismatch: got %s, want %s", got.Context.StepTaskID, q.Context.StepTaskID)
	}
}

func TestStore_LoadFromDisk(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	q := &Question{
		ID:         "q-disk-1",
		TaskID:     "task-456",
		Type:       QuestionTypeChoice,
		Text:       "Which option?",
		Options:    []string{"a", "b", "c"},
		DetectedAt: time.Now(),
	}

	// Save
	err := store.Save(q)
	if err != nil {
		t.Fatalf("failed to save question: %v", err)
	}

	// Create a new store and load
	store2 := NewStore(dir)
	err = store2.LoadAll()
	if err != nil {
		t.Fatalf("failed to load questions: %v", err)
	}

	got := store2.Get("q-disk-1")
	if got == nil {
		t.Fatal("question not found after LoadAll")
	}
	if len(got.Options) != 3 {
		t.Errorf("options mismatch: got %d, want 3", len(got.Options))
	}
}

func TestStore_GetPendingForTask(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	// Create questions for two different tasks
	q1 := &Question{ID: "q-1", TaskID: "task-a", Text: "Q1?", DetectedAt: time.Now()}
	q2 := &Question{ID: "q-2", TaskID: "task-a", Text: "Q2?", DetectedAt: time.Now()}
	q3 := &Question{ID: "q-3", TaskID: "task-b", Text: "Q3?", DetectedAt: time.Now()}

	store.Save(q1)
	store.Save(q2)
	store.Save(q3)

	// Get pending for task-a
	pending := store.GetPendingForTask("task-a")
	if len(pending) != 2 {
		t.Errorf("expected 2 pending questions for task-a, got %d", len(pending))
	}

	// Answer one
	store.MarkAnswered("q-1", "yes")

	// Should only have 1 pending now
	pending = store.GetPendingForTask("task-a")
	if len(pending) != 1 {
		t.Errorf("expected 1 pending question for task-a after answer, got %d", len(pending))
	}
}

func TestStore_MarkAnswered(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	q := &Question{
		ID:         "q-answer-test",
		TaskID:     "task-123",
		Text:       "Continue?",
		DetectedAt: time.Now(),
	}
	store.Save(q)

	// Mark as answered
	err := store.MarkAnswered("q-answer-test", "yes")
	if err != nil {
		t.Fatalf("failed to mark answered: %v", err)
	}

	// Verify
	got := store.Get("q-answer-test")
	if got.AnsweredAt == nil {
		t.Error("AnsweredAt not set")
	}
	if got.Answer != "yes" {
		t.Errorf("Answer mismatch: got %s, want yes", got.Answer)
	}
	if got.IsPending() {
		t.Error("question should not be pending after being answered")
	}
}

func TestStore_MarkDelivered(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	q := &Question{
		ID:         "q-deliver-test",
		TaskID:     "task-123",
		Text:       "Continue?",
		DetectedAt: time.Now(),
	}
	store.Save(q)
	store.MarkAnswered("q-deliver-test", "yes")

	// Mark as delivered
	err := store.MarkDelivered("q-deliver-test")
	if err != nil {
		t.Fatalf("failed to mark delivered: %v", err)
	}

	// Verify
	got := store.Get("q-deliver-test")
	if got.DeliveredAt == nil {
		t.Error("DeliveredAt not set")
	}
	if !got.IsDelivered() {
		t.Error("IsDelivered should return true")
	}
}

func TestStore_Delete(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	q := &Question{
		ID:         "q-delete-test",
		TaskID:     "task-123",
		Text:       "Delete me?",
		DetectedAt: time.Now(),
	}
	store.Save(q)

	// Delete
	err := store.Delete("q-delete-test")
	if err != nil {
		t.Fatalf("failed to delete: %v", err)
	}

	// Verify removed from memory
	if store.Get("q-delete-test") != nil {
		t.Error("question still in memory after delete")
	}

	// Verify removed from disk
	qPath := filepath.Join(dir, "questions", "q-delete-test.json")
	if _, err := os.Stat(qPath); !os.IsNotExist(err) {
		t.Error("question file still exists after delete")
	}
}

func TestStore_ClearForTask(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	// Create multiple questions for a task
	store.Save(&Question{ID: "q-c1", TaskID: "task-clear", Text: "Q1?", DetectedAt: time.Now()})
	store.Save(&Question{ID: "q-c2", TaskID: "task-clear", Text: "Q2?", DetectedAt: time.Now()})
	store.Save(&Question{ID: "q-c3", TaskID: "task-other", Text: "Q3?", DetectedAt: time.Now()})

	// Clear for task-clear
	store.ClearForTask("task-clear")

	// task-clear questions should be gone
	if len(store.GetPendingForTask("task-clear")) != 0 {
		t.Error("questions for task-clear should be cleared")
	}

	// task-other question should remain
	if len(store.GetPendingForTask("task-other")) != 1 {
		t.Error("question for task-other should remain")
	}
}

func TestStore_Count(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	if store.Count() != 0 {
		t.Error("expected count 0 for empty store")
	}

	store.Save(&Question{ID: "q-1", TaskID: "t", DetectedAt: time.Now()})
	store.Save(&Question{ID: "q-2", TaskID: "t", DetectedAt: time.Now()})

	if store.Count() != 2 {
		t.Errorf("expected count 2, got %d", store.Count())
	}

	if store.PendingCount() != 2 {
		t.Errorf("expected pending count 2, got %d", store.PendingCount())
	}

	store.MarkAnswered("q-1", "yes")
	if store.PendingCount() != 1 {
		t.Errorf("expected pending count 1 after answer, got %d", store.PendingCount())
	}
}
