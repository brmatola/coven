package workflow

import (
	"bufio"
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestNewLogger(t *testing.T) {
	logger := NewLogger("/test/coven")

	expectedDir := "/test/coven/logs/workflows"
	if logger.LogDir() != expectedDir {
		t.Errorf("LogDir() = %q, want %q", logger.LogDir(), expectedDir)
	}
}

func TestLogger_LogPath(t *testing.T) {
	logger := NewLogger("/test/coven")

	path := logger.LogPath("wf-123")
	expected := "/test/coven/logs/workflows/wf-123.jsonl"
	if path != expected {
		t.Errorf("LogPath() = %q, want %q", path, expected)
	}
}

func TestLogger_LogWorkflowStart(t *testing.T) {
	tmpDir := t.TempDir()
	logger := NewLogger(tmpDir)
	defer logger.Close()

	err := logger.LogWorkflowStart("wf-test-1", "bead-123", "test-grimoire", "/path/to/worktree")
	if err != nil {
		t.Fatalf("LogWorkflowStart() error: %v", err)
	}

	// Read and verify log file
	logPath := logger.LogPath("wf-test-1")
	entries := readLogEntries(t, logPath)

	if len(entries) != 1 {
		t.Fatalf("Expected 1 log entry, got %d", len(entries))
	}

	entry := entries[0]
	if entry.Event != LogEventWorkflowStart {
		t.Errorf("Event = %q, want %q", entry.Event, LogEventWorkflowStart)
	}
	if entry.WorkflowID != "wf-test-1" {
		t.Errorf("WorkflowID = %q, want %q", entry.WorkflowID, "wf-test-1")
	}
	if entry.BeadID != "bead-123" {
		t.Errorf("BeadID = %q, want %q", entry.BeadID, "bead-123")
	}

	var data WorkflowStartData
	if err := json.Unmarshal(entry.Data, &data); err != nil {
		t.Fatalf("Failed to parse data: %v", err)
	}
	if data.GrimoireName != "test-grimoire" {
		t.Errorf("GrimoireName = %q, want %q", data.GrimoireName, "test-grimoire")
	}
	if data.WorktreePath != "/path/to/worktree" {
		t.Errorf("WorktreePath = %q, want %q", data.WorktreePath, "/path/to/worktree")
	}
}

func TestLogger_LogWorkflowEnd(t *testing.T) {
	tmpDir := t.TempDir()
	logger := NewLogger(tmpDir)
	// Don't defer Close - LogWorkflowEnd should close the file

	logger.LogWorkflowStart("wf-test-2", "bead-456", "test-grimoire", "/worktree")

	err := logger.LogWorkflowEnd("wf-test-2", "bead-456", WorkflowCompleted, 5*time.Second, 3, "")
	if err != nil {
		t.Fatalf("LogWorkflowEnd() error: %v", err)
	}

	// Read and verify log file
	entries := readLogEntries(t, logger.LogPath("wf-test-2"))

	if len(entries) != 2 {
		t.Fatalf("Expected 2 log entries, got %d", len(entries))
	}

	entry := entries[1] // Second entry is the end event
	if entry.Event != LogEventWorkflowEnd {
		t.Errorf("Event = %q, want %q", entry.Event, LogEventWorkflowEnd)
	}

	var data WorkflowEndData
	if err := json.Unmarshal(entry.Data, &data); err != nil {
		t.Fatalf("Failed to parse data: %v", err)
	}
	if data.Status != string(WorkflowCompleted) {
		t.Errorf("Status = %q, want %q", data.Status, WorkflowCompleted)
	}
	if data.DurationMs != 5000 {
		t.Errorf("DurationMs = %d, want 5000", data.DurationMs)
	}
	if data.StepCount != 3 {
		t.Errorf("StepCount = %d, want 3", data.StepCount)
	}
}

func TestLogger_LogWorkflowEnd_WithError(t *testing.T) {
	tmpDir := t.TempDir()
	logger := NewLogger(tmpDir)

	logger.LogWorkflowStart("wf-error", "bead-err", "test-grimoire", "/worktree")

	err := logger.LogWorkflowEnd("wf-error", "bead-err", WorkflowFailed, 2*time.Second, 1, "step failed: timeout")
	if err != nil {
		t.Fatalf("LogWorkflowEnd() error: %v", err)
	}

	entries := readLogEntries(t, logger.LogPath("wf-error"))
	entry := entries[1]

	var data WorkflowEndData
	json.Unmarshal(entry.Data, &data)

	if data.Error != "step failed: timeout" {
		t.Errorf("Error = %q, want %q", data.Error, "step failed: timeout")
	}
	if data.Status != string(WorkflowFailed) {
		t.Errorf("Status = %q, want %q", data.Status, WorkflowFailed)
	}
}

func TestLogger_LogStepStart(t *testing.T) {
	tmpDir := t.TempDir()
	logger := NewLogger(tmpDir)
	defer logger.Close()

	err := logger.LogStepStart("wf-step-1", "bead-1", "analyze", "agent", 0)
	if err != nil {
		t.Fatalf("LogStepStart() error: %v", err)
	}

	entries := readLogEntries(t, logger.LogPath("wf-step-1"))
	if len(entries) != 1 {
		t.Fatalf("Expected 1 log entry, got %d", len(entries))
	}

	entry := entries[0]
	if entry.Event != LogEventStepStart {
		t.Errorf("Event = %q, want %q", entry.Event, LogEventStepStart)
	}

	var data StepStartData
	json.Unmarshal(entry.Data, &data)

	if data.StepName != "analyze" {
		t.Errorf("StepName = %q, want %q", data.StepName, "analyze")
	}
	if data.StepType != "agent" {
		t.Errorf("StepType = %q, want %q", data.StepType, "agent")
	}
	if data.StepIndex != 0 {
		t.Errorf("StepIndex = %d, want 0", data.StepIndex)
	}
}

func TestLogger_LogStepEnd(t *testing.T) {
	tmpDir := t.TempDir()
	logger := NewLogger(tmpDir)
	defer logger.Close()

	err := logger.LogStepEnd("wf-step-2", "bead-1", "implement", "script", 1, true, false, 10*time.Second, 0, "")
	if err != nil {
		t.Fatalf("LogStepEnd() error: %v", err)
	}

	entries := readLogEntries(t, logger.LogPath("wf-step-2"))
	entry := entries[0]

	if entry.Event != LogEventStepEnd {
		t.Errorf("Event = %q, want %q", entry.Event, LogEventStepEnd)
	}

	var data StepEndData
	json.Unmarshal(entry.Data, &data)

	if data.StepName != "implement" {
		t.Errorf("StepName = %q, want %q", data.StepName, "implement")
	}
	if !data.Success {
		t.Error("Success should be true")
	}
	if data.Skipped {
		t.Error("Skipped should be false")
	}
	if data.DurationMs != 10000 {
		t.Errorf("DurationMs = %d, want 10000", data.DurationMs)
	}
}

func TestLogger_LogStepEnd_Skipped(t *testing.T) {
	tmpDir := t.TempDir()
	logger := NewLogger(tmpDir)
	defer logger.Close()

	err := logger.LogStepEnd("wf-skip", "bead-1", "optional", "script", 2, true, true, 0, 0, "")
	if err != nil {
		t.Fatalf("LogStepEnd() error: %v", err)
	}

	entries := readLogEntries(t, logger.LogPath("wf-skip"))
	var data StepEndData
	json.Unmarshal(entries[0].Data, &data)

	if !data.Skipped {
		t.Error("Skipped should be true")
	}
}

func TestLogger_LogStepEnd_WithError(t *testing.T) {
	tmpDir := t.TempDir()
	logger := NewLogger(tmpDir)
	defer logger.Close()

	err := logger.LogStepEnd("wf-fail", "bead-1", "build", "script", 0, false, false, 5*time.Second, 1, "build failed")
	if err != nil {
		t.Fatalf("LogStepEnd() error: %v", err)
	}

	entries := readLogEntries(t, logger.LogPath("wf-fail"))
	var data StepEndData
	json.Unmarshal(entries[0].Data, &data)

	if data.Success {
		t.Error("Success should be false")
	}
	if data.ExitCode != 1 {
		t.Errorf("ExitCode = %d, want 1", data.ExitCode)
	}
	if data.Error != "build failed" {
		t.Errorf("Error = %q, want %q", data.Error, "build failed")
	}
}

func TestLogger_LogStepInput(t *testing.T) {
	tmpDir := t.TempDir()
	logger := NewLogger(tmpDir)
	defer logger.Close()

	vars := map[string]string{
		"task_description": "Test task",
		"previous_output":  "analyzed",
	}
	err := logger.LogStepInput("wf-input", "bead-1", "implement", vars, "implement the task", "")
	if err != nil {
		t.Fatalf("LogStepInput() error: %v", err)
	}

	entries := readLogEntries(t, logger.LogPath("wf-input"))
	entry := entries[0]

	if entry.Event != LogEventStepInput {
		t.Errorf("Event = %q, want %q", entry.Event, LogEventStepInput)
	}

	var data StepInputData
	json.Unmarshal(entry.Data, &data)

	if data.StepName != "implement" {
		t.Errorf("StepName = %q, want %q", data.StepName, "implement")
	}
	if data.Spell != "implement the task" {
		t.Errorf("Spell = %q, want %q", data.Spell, "implement the task")
	}
	if len(data.Variables) != 2 {
		t.Errorf("Variables length = %d, want 2", len(data.Variables))
	}
	if data.Variables["task_description"] != "Test task" {
		t.Errorf("Variables[task_description] = %q, want %q", data.Variables["task_description"], "Test task")
	}
}

func TestLogger_LogStepOutput(t *testing.T) {
	tmpDir := t.TempDir()
	logger := NewLogger(tmpDir)
	defer logger.Close()

	err := logger.LogStepOutput("wf-output", "bead-1", "analyze", "Analysis complete", "analysis_result", 1500, 8000)
	if err != nil {
		t.Fatalf("LogStepOutput() error: %v", err)
	}

	entries := readLogEntries(t, logger.LogPath("wf-output"))
	entry := entries[0]

	if entry.Event != LogEventStepOutput {
		t.Errorf("Event = %q, want %q", entry.Event, LogEventStepOutput)
	}

	var data StepOutputData
	json.Unmarshal(entry.Data, &data)

	if data.StepName != "analyze" {
		t.Errorf("StepName = %q, want %q", data.StepName, "analyze")
	}
	if data.Output != "Analysis complete" {
		t.Errorf("Output = %q, want %q", data.Output, "Analysis complete")
	}
	if data.OutputVar != "analysis_result" {
		t.Errorf("OutputVar = %q, want %q", data.OutputVar, "analysis_result")
	}
	if data.TokensUsed != 1500 {
		t.Errorf("TokensUsed = %d, want 1500", data.TokensUsed)
	}
	if data.TokensLimit != 8000 {
		t.Errorf("TokensLimit = %d, want 8000", data.TokensLimit)
	}
}

func TestLogger_LogLoopIteration(t *testing.T) {
	tmpDir := t.TempDir()
	logger := NewLogger(tmpDir)
	defer logger.Close()

	err := logger.LogLoopIteration("wf-loop", "bead-1", "refine", 3, 5, "until_pass", false)
	if err != nil {
		t.Fatalf("LogLoopIteration() error: %v", err)
	}

	entries := readLogEntries(t, logger.LogPath("wf-loop"))
	entry := entries[0]

	if entry.Event != LogEventLoopIteration {
		t.Errorf("Event = %q, want %q", entry.Event, LogEventLoopIteration)
	}

	var data LoopIterationData
	json.Unmarshal(entry.Data, &data)

	if data.StepName != "refine" {
		t.Errorf("StepName = %q, want %q", data.StepName, "refine")
	}
	if data.Iteration != 3 {
		t.Errorf("Iteration = %d, want 3", data.Iteration)
	}
	if data.MaxIter != 5 {
		t.Errorf("MaxIter = %d, want 5", data.MaxIter)
	}
	if data.LoopType != "until_pass" {
		t.Errorf("LoopType = %q, want %q", data.LoopType, "until_pass")
	}
	if data.ShouldBreak {
		t.Error("ShouldBreak should be false")
	}
}

func TestLogger_LogLoopIteration_Break(t *testing.T) {
	tmpDir := t.TempDir()
	logger := NewLogger(tmpDir)
	defer logger.Close()

	err := logger.LogLoopIteration("wf-break", "bead-1", "iterate", 2, 10, "for_each", true)
	if err != nil {
		t.Fatalf("LogLoopIteration() error: %v", err)
	}

	entries := readLogEntries(t, logger.LogPath("wf-break"))
	var data LoopIterationData
	json.Unmarshal(entries[0].Data, &data)

	if !data.ShouldBreak {
		t.Error("ShouldBreak should be true")
	}
}

func TestLogger_Close(t *testing.T) {
	tmpDir := t.TempDir()
	logger := NewLogger(tmpDir)

	// Log to multiple workflows
	logger.LogWorkflowStart("wf-1", "bead-1", "grimoire-1", "/wt1")
	logger.LogWorkflowStart("wf-2", "bead-2", "grimoire-2", "/wt2")
	logger.LogWorkflowStart("wf-3", "bead-3", "grimoire-3", "/wt3")

	// Close all
	err := logger.Close()
	if err != nil {
		t.Fatalf("Close() error: %v", err)
	}

	// Verify files exist and are valid
	for _, wfID := range []string{"wf-1", "wf-2", "wf-3"} {
		entries := readLogEntries(t, logger.LogPath(wfID))
		if len(entries) != 1 {
			t.Errorf("Workflow %s should have 1 entry, got %d", wfID, len(entries))
		}
	}
}

func TestLogger_CloseWorkflow(t *testing.T) {
	tmpDir := t.TempDir()
	logger := NewLogger(tmpDir)
	defer logger.Close()

	logger.LogWorkflowStart("wf-close-test", "bead-1", "grimoire", "/wt")

	err := logger.CloseWorkflow("wf-close-test")
	if err != nil {
		t.Fatalf("CloseWorkflow() error: %v", err)
	}

	// Closing again should not error
	err = logger.CloseWorkflow("wf-close-test")
	if err != nil {
		t.Errorf("CloseWorkflow() second call should not error, got: %v", err)
	}
}

func TestLogger_MultipleEntries(t *testing.T) {
	tmpDir := t.TempDir()
	logger := NewLogger(tmpDir)
	defer logger.Close()

	workflowID := "wf-multi"
	beadID := "bead-multi"

	// Log a complete workflow sequence
	logger.LogWorkflowStart(workflowID, beadID, "test-grimoire", "/worktree")
	logger.LogStepStart(workflowID, beadID, "step-1", "script", 0)
	logger.LogStepInput(workflowID, beadID, "step-1", nil, "", "echo test")
	logger.LogStepOutput(workflowID, beadID, "step-1", "test output", "", 0, 0)
	logger.LogStepEnd(workflowID, beadID, "step-1", "script", 0, true, false, time.Second, 0, "")

	entries := readLogEntries(t, logger.LogPath(workflowID))

	if len(entries) != 5 {
		t.Errorf("Expected 5 entries, got %d", len(entries))
	}

	// Verify sequence of events
	expectedEvents := []LogEventType{
		LogEventWorkflowStart,
		LogEventStepStart,
		LogEventStepInput,
		LogEventStepOutput,
		LogEventStepEnd,
	}

	for i, expected := range expectedEvents {
		if entries[i].Event != expected {
			t.Errorf("Entry %d: Event = %q, want %q", i, entries[i].Event, expected)
		}
	}
}

func TestLogger_TimestampIsSet(t *testing.T) {
	tmpDir := t.TempDir()
	logger := NewLogger(tmpDir)
	defer logger.Close()

	before := time.Now()
	logger.LogWorkflowStart("wf-time", "bead-1", "grimoire", "/wt")
	after := time.Now()

	entries := readLogEntries(t, logger.LogPath("wf-time"))

	ts := entries[0].Timestamp
	if ts.Before(before) || ts.After(after) {
		t.Errorf("Timestamp %v not between %v and %v", ts, before, after)
	}
}

// Helper to read log entries from a JSONL file
func readLogEntries(t *testing.T, path string) []LogEntry {
	t.Helper()

	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("Failed to open log file: %v", err)
	}
	defer f.Close()

	var entries []LogEntry
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		var entry LogEntry
		if err := json.Unmarshal(scanner.Bytes(), &entry); err != nil {
			t.Fatalf("Failed to parse log entry: %v", err)
		}
		entries = append(entries, entry)
	}

	if err := scanner.Err(); err != nil {
		t.Fatalf("Scanner error: %v", err)
	}

	return entries
}
