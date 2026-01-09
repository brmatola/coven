package state

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNew(t *testing.T) {
	tmpDir := t.TempDir()
	state := New(tmpDir)

	if state == nil {
		t.Fatal("New() returned nil")
	}
	if state.Agents == nil {
		t.Error("Agents map not initialized")
	}

	expectedPath := filepath.Join(tmpDir, "state.json")
	if state.FilePath() != expectedPath {
		t.Errorf("FilePath() = %q, want %q", state.FilePath(), expectedPath)
	}
}

func TestLoadNoFile(t *testing.T) {
	tmpDir := t.TempDir()
	state := New(tmpDir)

	if err := state.Load(); err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	// Should have empty agents map
	if len(state.Agents) != 0 {
		t.Errorf("Agents should be empty, got %d", len(state.Agents))
	}
}

func TestSaveAndLoad(t *testing.T) {
	tmpDir := t.TempDir()
	state := New(tmpDir)

	// Set some state
	state.SetVersion("1.0.0")
	state.SetSessionStarted(time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC))
	state.AddAgent("task-1", &AgentState{
		TaskID:    "task-1",
		PID:       1234,
		Worktree:  "/path/to/worktree",
		StartedAt: time.Date(2024, 1, 1, 12, 30, 0, 0, time.UTC),
		Status:    "running",
	})

	if err := state.Save(); err != nil {
		t.Fatalf("Save() error: %v", err)
	}

	// Verify file exists
	if _, err := os.Stat(state.FilePath()); os.IsNotExist(err) {
		t.Error("State file was not created")
	}

	// Load into new state instance
	state2 := New(tmpDir)
	if err := state2.Load(); err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if state2.Version != "1.0.0" {
		t.Errorf("Version = %q, want %q", state2.Version, "1.0.0")
	}

	agent := state2.GetAgent("task-1")
	if agent == nil {
		t.Fatal("Agent not loaded")
	}
	if agent.PID != 1234 {
		t.Errorf("Agent PID = %d, want %d", agent.PID, 1234)
	}
	if agent.Status != "running" {
		t.Errorf("Agent Status = %q, want %q", agent.Status, "running")
	}
}

func TestAddRemoveAgent(t *testing.T) {
	tmpDir := t.TempDir()
	state := New(tmpDir)

	// Add agent
	agent := &AgentState{
		TaskID:    "task-1",
		PID:       1234,
		Worktree:  "/path/to/worktree",
		StartedAt: time.Now(),
		Status:    "running",
	}
	state.AddAgent("task-1", agent)

	// Get agent
	got := state.GetAgent("task-1")
	if got == nil {
		t.Fatal("GetAgent() returned nil")
	}
	if got.PID != agent.PID {
		t.Errorf("PID = %d, want %d", got.PID, agent.PID)
	}

	// Get non-existent agent
	if state.GetAgent("nonexistent") != nil {
		t.Error("GetAgent() should return nil for non-existent agent")
	}

	// Remove agent
	state.RemoveAgent("task-1")
	if state.GetAgent("task-1") != nil {
		t.Error("Agent should be removed")
	}

	// Remove non-existent agent (should not panic)
	state.RemoveAgent("nonexistent")
}

func TestGetAllAgents(t *testing.T) {
	tmpDir := t.TempDir()
	state := New(tmpDir)

	state.AddAgent("task-1", &AgentState{TaskID: "task-1", PID: 1})
	state.AddAgent("task-2", &AgentState{TaskID: "task-2", PID: 2})

	all := state.GetAllAgents()

	if len(all) != 2 {
		t.Errorf("GetAllAgents() returned %d agents, want 2", len(all))
	}

	// Verify it's a copy by modifying the returned map
	all["task-1"].PID = 999
	if state.GetAgent("task-1").PID == 999 {
		t.Error("GetAllAgents() should return a copy")
	}
}

func TestUpdateAgentStatus(t *testing.T) {
	tmpDir := t.TempDir()
	state := New(tmpDir)

	state.AddAgent("task-1", &AgentState{TaskID: "task-1", Status: "running"})

	state.UpdateAgentStatus("task-1", "completed")

	agent := state.GetAgent("task-1")
	if agent.Status != "completed" {
		t.Errorf("Status = %q, want %q", agent.Status, "completed")
	}

	// Update non-existent agent (should not panic)
	state.UpdateAgentStatus("nonexistent", "completed")
}

func TestClear(t *testing.T) {
	tmpDir := t.TempDir()
	state := New(tmpDir)

	state.SetVersion("1.0.0")
	state.SetSessionStarted(time.Now())
	state.AddAgent("task-1", &AgentState{TaskID: "task-1"})

	state.Clear()

	if len(state.Agents) != 0 {
		t.Error("Agents should be empty after Clear()")
	}
	if !state.SessionStarted.IsZero() {
		t.Error("SessionStarted should be zero after Clear()")
	}
}

func TestSetVersion(t *testing.T) {
	tmpDir := t.TempDir()
	state := New(tmpDir)

	state.SetVersion("2.0.0")

	if state.Version != "2.0.0" {
		t.Errorf("Version = %q, want %q", state.Version, "2.0.0")
	}
}

func TestSetSessionStarted(t *testing.T) {
	tmpDir := t.TempDir()
	state := New(tmpDir)

	now := time.Now()
	state.SetSessionStarted(now)

	if !state.SessionStarted.Equal(now) {
		t.Errorf("SessionStarted = %v, want %v", state.SessionStarted, now)
	}
}

func TestLoadInvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	statePath := filepath.Join(tmpDir, "state.json")

	// Write invalid JSON
	if err := os.WriteFile(statePath, []byte("not valid json"), 0644); err != nil {
		t.Fatalf("Failed to write state file: %v", err)
	}

	state := New(tmpDir)
	err := state.Load()
	if err == nil {
		t.Error("Load() should fail for invalid JSON")
	}
}

func TestSaveAtomicity(t *testing.T) {
	tmpDir := t.TempDir()
	state := New(tmpDir)

	state.AddAgent("task-1", &AgentState{TaskID: "task-1"})
	if err := state.Save(); err != nil {
		t.Fatalf("Save() error: %v", err)
	}

	// Verify no temp file left behind
	tmpPath := state.FilePath() + ".tmp"
	if _, err := os.Stat(tmpPath); !os.IsNotExist(err) {
		t.Error("Temp file should not exist after save")
	}
}

func TestConcurrentAccess(t *testing.T) {
	tmpDir := t.TempDir()
	state := New(tmpDir)

	// Concurrent reads and writes
	done := make(chan bool, 10)

	// Writers
	for i := 0; i < 5; i++ {
		go func(id int) {
			for j := 0; j < 100; j++ {
				state.AddAgent("task", &AgentState{TaskID: "task", PID: id*1000 + j})
				state.UpdateAgentStatus("task", "running")
				state.RemoveAgent("task")
			}
			done <- true
		}(i)
	}

	// Readers
	for i := 0; i < 5; i++ {
		go func() {
			for j := 0; j < 100; j++ {
				_ = state.GetAgent("task")
				_ = state.GetAllAgents()
			}
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}
}
