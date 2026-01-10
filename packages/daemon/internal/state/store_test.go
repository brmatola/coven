package state

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/coven/daemon/pkg/types"
)

func TestNewStore(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)

	if store == nil {
		t.Fatal("NewStore() returned nil")
	}

	expectedPath := filepath.Join(tmpDir, "state.json")
	if store.FilePath() != expectedPath {
		t.Errorf("FilePath() = %q, want %q", store.FilePath(), expectedPath)
	}
}

func TestStoreLoadNoFile(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)

	if err := store.Load(); err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	state := store.GetState()
	if state.Agents == nil {
		t.Error("Agents map should be initialized")
	}
}

func TestStoreSaveAndLoad(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)

	now := time.Now()
	store.AddAgent(&types.Agent{
		TaskID:    "task-1",
		PID:       1234,
		Status:    types.AgentStatusRunning,
		Worktree:  "/path/to/worktree",
		Branch:    "feature/test",
		StartedAt: now,
	})

	if err := store.Save(); err != nil {
		t.Fatalf("Save() error: %v", err)
	}

	// Load into new store
	store2 := NewStore(tmpDir)
	if err := store2.Load(); err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	agent := store2.GetAgent("task-1")
	if agent == nil {
		t.Fatal("Agent not found")
	}
	if agent.PID != 1234 {
		t.Errorf("Agent.PID = %d, want %d", agent.PID, 1234)
	}
}

func TestStoreAgentOperations(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)

	// Add agent
	now := time.Now()
	agent := &types.Agent{
		TaskID:    "task-1",
		PID:       1234,
		Status:    types.AgentStatusRunning,
		Worktree:  "/path/to/worktree",
		Branch:    "feature/test",
		StartedAt: now,
	}
	store.AddAgent(agent)

	// Get agent
	got := store.GetAgent("task-1")
	if got == nil {
		t.Fatal("GetAgent() returned nil")
	}
	if got.PID != agent.PID {
		t.Errorf("PID = %d, want %d", got.PID, agent.PID)
	}

	// Verify it's a copy
	got.PID = 9999
	got2 := store.GetAgent("task-1")
	if got2.PID == 9999 {
		t.Error("GetAgent() should return a copy")
	}

	// Get non-existent agent
	if store.GetAgent("nonexistent") != nil {
		t.Error("GetAgent() should return nil for non-existent agent")
	}

	// Update status
	store.UpdateAgentStatus("task-1", types.AgentStatusCompleted)
	got = store.GetAgent("task-1")
	if got.Status != types.AgentStatusCompleted {
		t.Errorf("Status = %q, want %q", got.Status, types.AgentStatusCompleted)
	}
	if got.EndedAt == nil {
		t.Error("EndedAt should be set for completed agent")
	}

	// Set exit code
	store.SetAgentExitCode("task-1", 0)
	got = store.GetAgent("task-1")
	if got.ExitCode == nil || *got.ExitCode != 0 {
		t.Error("ExitCode should be 0")
	}

	// Set error
	store.SetAgentError("task-1", "test error")
	got = store.GetAgent("task-1")
	if got.Error != "test error" {
		t.Errorf("Error = %q, want %q", got.Error, "test error")
	}

	// Remove agent
	store.RemoveAgent("task-1")
	if store.GetAgent("task-1") != nil {
		t.Error("Agent should be removed")
	}
}

func TestStoreGetAllAgents(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)

	store.AddAgent(&types.Agent{TaskID: "task-1", PID: 1})
	store.AddAgent(&types.Agent{TaskID: "task-2", PID: 2})

	all := store.GetAllAgents()

	if len(all) != 2 {
		t.Errorf("GetAllAgents() returned %d agents, want 2", len(all))
	}

	// Verify it's a copy
	all["task-1"].PID = 999
	if store.GetAgent("task-1").PID == 999 {
		t.Error("GetAllAgents() should return a copy")
	}
}

func TestStoreTaskOperations(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)

	// Initial state
	tasks := store.GetTasks()
	if len(tasks) != 0 {
		t.Errorf("Initial tasks = %d, want 0", len(tasks))
	}

	// Set tasks
	newTasks := []types.Task{
		{ID: "task-1", Title: "Task 1", Status: types.TaskStatusOpen},
		{ID: "task-2", Title: "Task 2", Status: types.TaskStatusInProgress},
	}
	store.SetTasks(newTasks)

	tasks = store.GetTasks()
	if len(tasks) != 2 {
		t.Errorf("Tasks = %d, want 2", len(tasks))
	}

	// Verify it's a copy
	tasks[0].Title = "Modified"
	if store.GetTasks()[0].Title == "Modified" {
		t.Error("GetTasks() should return a copy")
	}

	// Last sync should be set
	lastSync := store.GetLastTaskSync()
	if lastSync == nil {
		t.Error("LastTaskSync should be set")
	}
}

func TestStoreDirtyFlag(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)

	// Initial state - dirty from initialization
	if store.IsDirty() {
		t.Error("New store should not be dirty")
	}

	// Adding agent makes it dirty
	store.AddAgent(&types.Agent{TaskID: "task-1"})
	if !store.IsDirty() {
		t.Error("Store should be dirty after AddAgent")
	}

	// Clear dirty
	store.ClearDirty()
	if store.IsDirty() {
		t.Error("Store should not be dirty after ClearDirty")
	}
}

func TestStoreClear(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)

	store.AddAgent(&types.Agent{TaskID: "task-1"})
	store.SetTasks([]types.Task{{ID: "task-1"}})

	store.Clear()

	state := store.GetState()
	if len(state.Agents) != 0 {
		t.Error("Agents should be empty after Clear")
	}
	if len(state.Tasks) != 0 {
		t.Error("Tasks should be empty after Clear")
	}
}

func TestStoreGetStateReturnsDeepCopy(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)

	store.AddAgent(&types.Agent{TaskID: "task-1", PID: 1})
	store.SetTasks([]types.Task{{ID: "task-1", Title: "Test"}})

	state := store.GetState()

	// Modify the copy
	state.Agents["task-1"].PID = 999
	state.Tasks[0].Title = "Modified"

	// Original should be unchanged
	original := store.GetState()
	if original.Agents["task-1"].PID == 999 {
		t.Error("GetState() should return a deep copy (agents)")
	}
	if original.Tasks[0].Title == "Modified" {
		t.Error("GetState() should return a deep copy (tasks)")
	}
}

func TestStoreLoadInvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	statePath := filepath.Join(tmpDir, "state.json")

	// Write invalid JSON
	if err := os.WriteFile(statePath, []byte("not valid json"), 0644); err != nil {
		t.Fatalf("Failed to write state file: %v", err)
	}

	store := NewStore(tmpDir)
	err := store.Load()
	if err == nil {
		t.Error("Load() should fail for invalid JSON")
	}
}

func TestStoreConcurrentAccess(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)

	done := make(chan bool, 10)

	// Writers
	for i := 0; i < 5; i++ {
		go func(id int) {
			for j := 0; j < 100; j++ {
				store.AddAgent(&types.Agent{TaskID: "task", PID: id*1000 + j})
				store.UpdateAgentStatus("task", types.AgentStatusRunning)
				store.RemoveAgent("task")
			}
			done <- true
		}(i)
	}

	// Readers
	for i := 0; i < 5; i++ {
		go func() {
			for j := 0; j < 100; j++ {
				_ = store.GetAgent("task")
				_ = store.GetAllAgents()
				_ = store.GetState()
			}
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}
}

func TestUpdateNonExistentAgent(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)

	// These should not panic
	store.UpdateAgentStatus("nonexistent", types.AgentStatusRunning)
	store.SetAgentExitCode("nonexistent", 0)
	store.SetAgentError("nonexistent", "error")
	store.RemoveAgent("nonexistent")
}
