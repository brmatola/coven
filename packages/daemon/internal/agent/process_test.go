package agent

import (
	"context"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/coven/daemon/internal/logging"
)

func newTestProcessManager(t *testing.T) *ProcessManager {
	t.Helper()

	logPath := filepath.Join(t.TempDir(), "test.log")
	logger, err := logging.New(logPath)
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}
	t.Cleanup(func() { logger.Close() })

	return NewProcessManager(logger)
}

func TestNewProcessManager(t *testing.T) {
	pm := newTestProcessManager(t)
	if pm == nil {
		t.Fatal("NewProcessManager() returned nil")
	}
	if pm.gracePeriod != DefaultGracePeriod {
		t.Errorf("gracePeriod = %v, want %v", pm.gracePeriod, DefaultGracePeriod)
	}
	if pm.timeout != DefaultTimeout {
		t.Errorf("timeout = %v, want %v", pm.timeout, DefaultTimeout)
	}
}

func TestProcessManagerSetGracePeriod(t *testing.T) {
	pm := newTestProcessManager(t)
	pm.SetGracePeriod(10 * time.Second)
	if pm.gracePeriod != 10*time.Second {
		t.Errorf("gracePeriod = %v, want 10s", pm.gracePeriod)
	}
}

func TestProcessManagerSetTimeout(t *testing.T) {
	pm := newTestProcessManager(t)
	pm.SetTimeout(5 * time.Minute)
	if pm.timeout != 5*time.Minute {
		t.Errorf("timeout = %v, want 5m", pm.timeout)
	}
}

func TestProcessManagerSpawn(t *testing.T) {
	pm := newTestProcessManager(t)
	ctx := context.Background()

	info, err := pm.Spawn(ctx, SpawnConfig{
		TaskID:  "task-1",
		Command: "echo",
		Args:    []string{"hello"},
	})
	if err != nil {
		t.Fatalf("Spawn() error: %v", err)
	}

	if info.TaskID != "task-1" {
		t.Errorf("TaskID = %q, want %q", info.TaskID, "task-1")
	}
	if info.PID <= 0 {
		t.Errorf("PID = %d, want > 0", info.PID)
	}
	if info.Command != "echo" {
		t.Errorf("Command = %q, want %q", info.Command, "echo")
	}

	// Wait for completion
	result, err := pm.WaitForCompletion("task-1")
	if err != nil {
		t.Fatalf("WaitForCompletion() error: %v", err)
	}
	if result.ExitCode != 0 {
		t.Errorf("ExitCode = %d, want 0", result.ExitCode)
	}
}

func TestProcessManagerSpawnDuplicate(t *testing.T) {
	pm := newTestProcessManager(t)
	ctx := context.Background()

	// Start long-running process
	_, err := pm.Spawn(ctx, SpawnConfig{
		TaskID:  "task-1",
		Command: "sleep",
		Args:    []string{"10"},
	})
	if err != nil {
		t.Fatalf("First Spawn() error: %v", err)
	}
	defer pm.Kill("task-1")

	// Try to spawn duplicate
	_, err = pm.Spawn(ctx, SpawnConfig{
		TaskID:  "task-1",
		Command: "echo",
		Args:    []string{"hello"},
	})
	if err == nil {
		t.Error("Spawn() should fail for duplicate task ID")
	}
}

func TestProcessManagerIsRunning(t *testing.T) {
	pm := newTestProcessManager(t)
	ctx := context.Background()

	// Not running before spawn
	if pm.IsRunning("task-1") {
		t.Error("IsRunning() should be false before spawn")
	}

	// Start process
	_, err := pm.Spawn(ctx, SpawnConfig{
		TaskID:  "task-1",
		Command: "sleep",
		Args:    []string{"10"},
	})
	if err != nil {
		t.Fatalf("Spawn() error: %v", err)
	}
	defer pm.Kill("task-1")

	// Should be running
	if !pm.IsRunning("task-1") {
		t.Error("IsRunning() should be true after spawn")
	}
}

func TestProcessManagerListRunning(t *testing.T) {
	pm := newTestProcessManager(t)
	ctx := context.Background()

	// Empty initially
	if len(pm.ListRunning()) != 0 {
		t.Error("ListRunning() should be empty initially")
	}

	// Start processes
	pm.Spawn(ctx, SpawnConfig{TaskID: "task-1", Command: "sleep", Args: []string{"10"}})
	pm.Spawn(ctx, SpawnConfig{TaskID: "task-2", Command: "sleep", Args: []string{"10"}})
	defer pm.Kill("task-1")
	defer pm.Kill("task-2")

	running := pm.ListRunning()
	if len(running) != 2 {
		t.Errorf("ListRunning() = %d tasks, want 2", len(running))
	}
}

func TestProcessManagerStop(t *testing.T) {
	pm := newTestProcessManager(t)
	pm.SetGracePeriod(100 * time.Millisecond)
	ctx := context.Background()

	// Start process that handles SIGTERM
	_, err := pm.Spawn(ctx, SpawnConfig{
		TaskID:  "task-1",
		Command: "sleep",
		Args:    []string{"30"},
	})
	if err != nil {
		t.Fatalf("Spawn() error: %v", err)
	}

	// Stop gracefully
	if err := pm.Stop("task-1"); err != nil {
		t.Errorf("Stop() error: %v", err)
	}

	// Should not be running
	if pm.IsRunning("task-1") {
		t.Error("IsRunning() should be false after Stop()")
	}
}

func TestProcessManagerKill(t *testing.T) {
	pm := newTestProcessManager(t)
	ctx := context.Background()

	_, err := pm.Spawn(ctx, SpawnConfig{
		TaskID:  "task-1",
		Command: "sleep",
		Args:    []string{"30"},
	})
	if err != nil {
		t.Fatalf("Spawn() error: %v", err)
	}

	// Kill immediately
	if err := pm.Kill("task-1"); err != nil {
		t.Errorf("Kill() error: %v", err)
	}

	// Should not be running
	if pm.IsRunning("task-1") {
		t.Error("IsRunning() should be false after Kill()")
	}

	// Result should indicate killed
	result, _ := pm.GetResult("task-1")
	if !result.Killed {
		t.Error("Result.Killed should be true")
	}
}

func TestProcessManagerGetOutput(t *testing.T) {
	pm := newTestProcessManager(t)
	ctx := context.Background()

	_, err := pm.Spawn(ctx, SpawnConfig{
		TaskID:  "task-1",
		Command: "echo",
		Args:    []string{"hello world"},
	})
	if err != nil {
		t.Fatalf("Spawn() error: %v", err)
	}

	// Wait for completion
	pm.WaitForCompletion("task-1")

	// Get output
	output, err := pm.GetOutput("task-1")
	if err != nil {
		t.Fatalf("GetOutput() error: %v", err)
	}

	found := false
	for _, line := range output {
		if line.Data == "hello world" {
			found = true
			break
		}
	}
	if !found {
		t.Error("Output should contain 'hello world'")
	}
}

func TestProcessManagerGetOutputSince(t *testing.T) {
	pm := newTestProcessManager(t)
	ctx := context.Background()

	_, err := pm.Spawn(ctx, SpawnConfig{
		TaskID:  "task-1",
		Command: "sh",
		Args:    []string{"-c", "echo line1; echo line2; echo line3"},
	})
	if err != nil {
		t.Fatalf("Spawn() error: %v", err)
	}

	pm.WaitForCompletion("task-1")

	// Get output since sequence 1
	output, err := pm.GetOutputSince("task-1", 1)
	if err != nil {
		t.Fatalf("GetOutputSince() error: %v", err)
	}

	if len(output) < 2 {
		t.Errorf("Expected at least 2 lines since seq 1, got %d", len(output))
	}
}

func TestProcessManagerGetInfo(t *testing.T) {
	pm := newTestProcessManager(t)
	ctx := context.Background()

	tmpDir := t.TempDir()
	_, err := pm.Spawn(ctx, SpawnConfig{
		TaskID:     "task-1",
		Command:    "sleep",
		Args:       []string{"10"},
		WorkingDir: tmpDir,
	})
	if err != nil {
		t.Fatalf("Spawn() error: %v", err)
	}
	defer pm.Kill("task-1")

	info, err := pm.GetInfo("task-1")
	if err != nil {
		t.Fatalf("GetInfo() error: %v", err)
	}

	if info.TaskID != "task-1" {
		t.Errorf("TaskID = %q, want %q", info.TaskID, "task-1")
	}
	if info.WorkingDir != tmpDir {
		t.Errorf("WorkingDir = %q, want %q", info.WorkingDir, tmpDir)
	}
}

func TestProcessManagerGetInfoNotFound(t *testing.T) {
	pm := newTestProcessManager(t)

	_, err := pm.GetInfo("nonexistent")
	if err == nil {
		t.Error("GetInfo() should fail for nonexistent task")
	}
}

func TestProcessManagerGetResultRunning(t *testing.T) {
	pm := newTestProcessManager(t)
	ctx := context.Background()

	_, err := pm.Spawn(ctx, SpawnConfig{
		TaskID:  "task-1",
		Command: "sleep",
		Args:    []string{"10"},
	})
	if err != nil {
		t.Fatalf("Spawn() error: %v", err)
	}
	defer pm.Kill("task-1")

	_, err = pm.GetResult("task-1")
	if err == nil {
		t.Error("GetResult() should fail for running process")
	}
}

func TestProcessManagerCleanup(t *testing.T) {
	pm := newTestProcessManager(t)
	ctx := context.Background()

	_, err := pm.Spawn(ctx, SpawnConfig{
		TaskID:  "task-1",
		Command: "echo",
		Args:    []string{"hello"},
	})
	if err != nil {
		t.Fatalf("Spawn() error: %v", err)
	}

	pm.WaitForCompletion("task-1")

	// Cleanup
	pm.Cleanup("task-1")

	// Should no longer be tracked
	_, err = pm.GetInfo("task-1")
	if err == nil {
		t.Error("GetInfo() should fail after Cleanup()")
	}
}

func TestProcessManagerCleanupRunning(t *testing.T) {
	pm := newTestProcessManager(t)
	ctx := context.Background()

	_, err := pm.Spawn(ctx, SpawnConfig{
		TaskID:  "task-1",
		Command: "sleep",
		Args:    []string{"10"},
	})
	if err != nil {
		t.Fatalf("Spawn() error: %v", err)
	}
	defer pm.Kill("task-1")

	// Cleanup should not remove running process
	pm.Cleanup("task-1")

	// Should still be tracked
	_, err = pm.GetInfo("task-1")
	if err != nil {
		t.Error("Running process should not be cleaned up")
	}
}

func TestProcessManagerOnComplete(t *testing.T) {
	pm := newTestProcessManager(t)
	ctx := context.Background()

	var completedResult *ProcessResult
	var mu sync.Mutex
	pm.OnComplete(func(result *ProcessResult) {
		mu.Lock()
		completedResult = result
		mu.Unlock()
	})

	_, err := pm.Spawn(ctx, SpawnConfig{
		TaskID:  "task-1",
		Command: "echo",
		Args:    []string{"hello"},
	})
	if err != nil {
		t.Fatalf("Spawn() error: %v", err)
	}

	pm.WaitForCompletion("task-1")

	mu.Lock()
	defer mu.Unlock()
	if completedResult == nil {
		t.Error("OnComplete callback should be called")
	}
	if completedResult.TaskID != "task-1" {
		t.Errorf("TaskID = %q, want %q", completedResult.TaskID, "task-1")
	}
}

func TestProcessManagerOnOutput(t *testing.T) {
	pm := newTestProcessManager(t)
	ctx := context.Background()

	var outputLines []OutputLine
	var mu sync.Mutex
	pm.OnOutput(func(taskID string, line OutputLine) {
		mu.Lock()
		outputLines = append(outputLines, line)
		mu.Unlock()
	})

	_, err := pm.Spawn(ctx, SpawnConfig{
		TaskID:  "task-1",
		Command: "echo",
		Args:    []string{"test output"},
	})
	if err != nil {
		t.Fatalf("Spawn() error: %v", err)
	}

	pm.WaitForCompletion("task-1")

	mu.Lock()
	defer mu.Unlock()
	if len(outputLines) == 0 {
		t.Error("OnOutput callback should be called")
	}
}

func TestProcessManagerTimeout(t *testing.T) {
	pm := newTestProcessManager(t)
	ctx := context.Background()

	_, err := pm.Spawn(ctx, SpawnConfig{
		TaskID:  "task-1",
		Command: "sleep",
		Args:    []string{"30"},
		Timeout: 100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("Spawn() error: %v", err)
	}

	// Wait for completion (should timeout)
	result, _ := pm.WaitForCompletion("task-1")

	if !result.TimedOut {
		t.Error("Result.TimedOut should be true")
	}
}

func TestProcessManagerStopAlreadyStopped(t *testing.T) {
	pm := newTestProcessManager(t)
	ctx := context.Background()

	_, err := pm.Spawn(ctx, SpawnConfig{
		TaskID:  "task-1",
		Command: "echo",
		Args:    []string{"hello"},
	})
	if err != nil {
		t.Fatalf("Spawn() error: %v", err)
	}

	pm.WaitForCompletion("task-1")

	// Stopping already completed process should be no-op
	if err := pm.Stop("task-1"); err != nil {
		t.Errorf("Stop() on completed process: %v", err)
	}
}

func TestProcessManagerKillNotFound(t *testing.T) {
	pm := newTestProcessManager(t)

	err := pm.Kill("nonexistent")
	if err == nil {
		t.Error("Kill() should fail for nonexistent task")
	}
}

func TestProcessManagerStopNotFound(t *testing.T) {
	pm := newTestProcessManager(t)

	err := pm.Stop("nonexistent")
	if err == nil {
		t.Error("Stop() should fail for nonexistent task")
	}
}

func TestProcessResultToAgentStatus(t *testing.T) {
	tests := []struct {
		name   string
		result *ProcessResult
		want   string
	}{
		{"nil result", nil, "running"},
		{"timed out", &ProcessResult{TimedOut: true}, "failed"},
		{"killed", &ProcessResult{Killed: true}, "killed"},
		{"success", &ProcessResult{ExitCode: 0}, "completed"},
		{"failed", &ProcessResult{ExitCode: 1}, "failed"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.result.ToAgentStatus()
			if string(got) != tt.want {
				t.Errorf("ToAgentStatus() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestProcessManagerStderr(t *testing.T) {
	pm := newTestProcessManager(t)
	ctx := context.Background()

	_, err := pm.Spawn(ctx, SpawnConfig{
		TaskID:  "task-1",
		Command: "sh",
		Args:    []string{"-c", "echo stdout-msg; echo stderr-msg >&2"},
	})
	if err != nil {
		t.Fatalf("Spawn() error: %v", err)
	}

	pm.WaitForCompletion("task-1")

	output, _ := pm.GetOutput("task-1")

	hasStdout := false
	hasStderr := false
	for _, line := range output {
		if line.Stream == "stdout" && line.Data == "stdout-msg" {
			hasStdout = true
		}
		if line.Stream == "stderr" && line.Data == "stderr-msg" {
			hasStderr = true
		}
	}

	if !hasStdout {
		t.Error("Should capture stdout")
	}
	if !hasStderr {
		t.Error("Should capture stderr")
	}
}

func TestProcessManagerExitCode(t *testing.T) {
	pm := newTestProcessManager(t)
	ctx := context.Background()

	_, err := pm.Spawn(ctx, SpawnConfig{
		TaskID:  "task-1",
		Command: "sh",
		Args:    []string{"-c", "exit 42"},
	})
	if err != nil {
		t.Fatalf("Spawn() error: %v", err)
	}

	result, _ := pm.WaitForCompletion("task-1")

	if result.ExitCode != 42 {
		t.Errorf("ExitCode = %d, want 42", result.ExitCode)
	}
}
