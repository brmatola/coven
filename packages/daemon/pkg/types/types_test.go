package types

import (
	"encoding/json"
	"testing"
	"time"
)

func TestNewDaemonState(t *testing.T) {
	state := NewDaemonState()

	if state == nil {
		t.Fatal("NewDaemonState() returned nil")
	}

	if state.Session.Status != SessionStatusInactive {
		t.Errorf("Session.Status = %q, want %q", state.Session.Status, SessionStatusInactive)
	}

	if state.Agents == nil {
		t.Error("Agents map not initialized")
	}

	if state.Tasks == nil {
		t.Error("Tasks slice not initialized")
	}
}

func TestSessionStatusConstants(t *testing.T) {
	// Verify constants have expected values
	if SessionStatusInactive != "inactive" {
		t.Errorf("SessionStatusInactive = %q, want %q", SessionStatusInactive, "inactive")
	}
	if SessionStatusActive != "active" {
		t.Errorf("SessionStatusActive = %q, want %q", SessionStatusActive, "active")
	}
	if SessionStatusStopping != "stopping" {
		t.Errorf("SessionStatusStopping = %q, want %q", SessionStatusStopping, "stopping")
	}
}

func TestAgentStatusConstants(t *testing.T) {
	statuses := []struct {
		status AgentStatus
		want   string
	}{
		{AgentStatusStarting, "starting"},
		{AgentStatusRunning, "running"},
		{AgentStatusCompleted, "completed"},
		{AgentStatusFailed, "failed"},
		{AgentStatusKilled, "killed"},
	}

	for _, tt := range statuses {
		if string(tt.status) != tt.want {
			t.Errorf("AgentStatus = %q, want %q", tt.status, tt.want)
		}
	}
}

func TestTaskStatusConstants(t *testing.T) {
	statuses := []struct {
		status TaskStatus
		want   string
	}{
		{TaskStatusOpen, "open"},
		{TaskStatusInProgress, "in_progress"},
		{TaskStatusClosed, "closed"},
		{TaskStatusBlocked, "blocked"},
		{TaskStatusPendingMerge, "pending_merge"},
	}

	for _, tt := range statuses {
		if string(tt.status) != tt.want {
			t.Errorf("TaskStatus = %q, want %q", tt.status, tt.want)
		}
	}
}

func TestEventTypeConstants(t *testing.T) {
	events := []struct {
		eventType string
		want      string
	}{
		{EventTypeSessionStarted, "session.started"},
		{EventTypeSessionStopped, "session.stopped"},
		{EventTypeTasksUpdated, "tasks.updated"},
		{EventTypeAgentStarted, "agent.started"},
		{EventTypeAgentOutput, "agent.output"},
		{EventTypeAgentCompleted, "agent.completed"},
		{EventTypeAgentFailed, "agent.failed"},
		{EventTypeStateSnapshot, "state.snapshot"},
		{EventTypeHeartbeat, "heartbeat"},
	}

	for _, tt := range events {
		if tt.eventType != tt.want {
			t.Errorf("EventType = %q, want %q", tt.eventType, tt.want)
		}
	}
}

func TestTaskJSONSerialization(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	task := Task{
		ID:          "task-123",
		Title:       "Test Task",
		Description: "A test task",
		Status:      TaskStatusOpen,
		Priority:    2,
		Type:        "task",
		Labels:      []string{"test", "example"},
		DependsOn:   []string{"task-100"},
		Blocks:      []string{"task-200"},
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	data, err := json.Marshal(task)
	if err != nil {
		t.Fatalf("Marshal error: %v", err)
	}

	var decoded Task
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal error: %v", err)
	}

	if decoded.ID != task.ID {
		t.Errorf("ID = %q, want %q", decoded.ID, task.ID)
	}
	if decoded.Title != task.Title {
		t.Errorf("Title = %q, want %q", decoded.Title, task.Title)
	}
	if decoded.Status != task.Status {
		t.Errorf("Status = %q, want %q", decoded.Status, task.Status)
	}
	if len(decoded.Labels) != len(task.Labels) {
		t.Errorf("Labels length = %d, want %d", len(decoded.Labels), len(task.Labels))
	}
}

func TestAgentJSONSerialization(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	exitCode := 0
	agent := Agent{
		TaskID:    "task-123",
		PID:       12345,
		Status:    AgentStatusCompleted,
		Worktree:  "/path/to/worktree",
		Branch:    "feature/test",
		StartedAt: now,
		EndedAt:   &now,
		ExitCode:  &exitCode,
	}

	data, err := json.Marshal(agent)
	if err != nil {
		t.Fatalf("Marshal error: %v", err)
	}

	var decoded Agent
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal error: %v", err)
	}

	if decoded.TaskID != agent.TaskID {
		t.Errorf("TaskID = %q, want %q", decoded.TaskID, agent.TaskID)
	}
	if decoded.PID != agent.PID {
		t.Errorf("PID = %d, want %d", decoded.PID, agent.PID)
	}
	if decoded.Status != agent.Status {
		t.Errorf("Status = %q, want %q", decoded.Status, agent.Status)
	}
	if decoded.ExitCode == nil || *decoded.ExitCode != *agent.ExitCode {
		t.Errorf("ExitCode mismatch")
	}
}

func TestDaemonStateJSONSerialization(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	state := NewDaemonState()
	state.Session.Status = SessionStatusActive
	state.Session.StartedAt = &now
	state.Agents["task-1"] = &Agent{
		TaskID:    "task-1",
		PID:       1234,
		Status:    AgentStatusRunning,
		StartedAt: now,
	}
	state.Tasks = []Task{
		{ID: "task-1", Title: "Test", Status: TaskStatusInProgress},
	}
	state.LastTaskSync = &now

	data, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("Marshal error: %v", err)
	}

	var decoded DaemonState
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal error: %v", err)
	}

	if decoded.Session.Status != state.Session.Status {
		t.Errorf("Session.Status = %q, want %q", decoded.Session.Status, state.Session.Status)
	}
	if len(decoded.Agents) != len(state.Agents) {
		t.Errorf("Agents length = %d, want %d", len(decoded.Agents), len(state.Agents))
	}
	if len(decoded.Tasks) != len(state.Tasks) {
		t.Errorf("Tasks length = %d, want %d", len(decoded.Tasks), len(state.Tasks))
	}
}

func TestHealthStatusJSONSerialization(t *testing.T) {
	health := HealthStatus{
		Status:    "healthy",
		Version:   "1.0.0",
		Uptime:    "1h30m",
		Workspace: "/path/to/workspace",
	}

	data, err := json.Marshal(health)
	if err != nil {
		t.Fatalf("Marshal error: %v", err)
	}

	var decoded HealthStatus
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal error: %v", err)
	}

	if decoded != health {
		t.Errorf("Decoded = %+v, want %+v", decoded, health)
	}
}

func TestVersionInfoJSONSerialization(t *testing.T) {
	version := VersionInfo{
		Version:   "1.0.0",
		GitCommit: "abc123",
		BuildTime: "2024-01-01T00:00:00Z",
		GoVersion: "go1.22",
	}

	data, err := json.Marshal(version)
	if err != nil {
		t.Fatalf("Marshal error: %v", err)
	}

	var decoded VersionInfo
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal error: %v", err)
	}

	if decoded != version {
		t.Errorf("Decoded = %+v, want %+v", decoded, version)
	}
}

func TestEventJSONSerialization(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	event := Event{
		Type:      EventTypeAgentStarted,
		Data:      map[string]string{"task_id": "task-1"},
		Timestamp: now,
	}

	data, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("Marshal error: %v", err)
	}

	var decoded Event
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal error: %v", err)
	}

	if decoded.Type != event.Type {
		t.Errorf("Type = %q, want %q", decoded.Type, event.Type)
	}
}

func TestErrorResponseJSONSerialization(t *testing.T) {
	errResp := ErrorResponse{
		Error:   "something went wrong",
		Code:    "ERR_001",
		Details: "Additional details here",
	}

	data, err := json.Marshal(errResp)
	if err != nil {
		t.Fatalf("Marshal error: %v", err)
	}

	var decoded ErrorResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal error: %v", err)
	}

	if decoded != errResp {
		t.Errorf("Decoded = %+v, want %+v", decoded, errResp)
	}
}

func TestStateResponseJSONSerialization(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	resp := StateResponse{
		State:     NewDaemonState(),
		Timestamp: now,
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("Marshal error: %v", err)
	}

	var decoded StateResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal error: %v", err)
	}

	if decoded.State == nil {
		t.Error("State should not be nil")
	}
}
