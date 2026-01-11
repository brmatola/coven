package git

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/coven/daemon/internal/logging"
)

func initTestRepo(t *testing.T) string {
	t.Helper()

	tmpDir := t.TempDir()

	// Initialize git repo
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to init git repo: %v", err)
	}

	// Configure git for the test
	exec.Command("git", "-C", tmpDir, "config", "user.email", "test@test.com").Run()
	exec.Command("git", "-C", tmpDir, "config", "user.name", "Test").Run()

	// Create initial commit
	testFile := filepath.Join(tmpDir, "README.md")
	if err := os.WriteFile(testFile, []byte("# Test"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	cmd = exec.Command("git", "add", ".")
	cmd.Dir = tmpDir
	cmd.Run()

	cmd = exec.Command("git", "commit", "-m", "Initial commit")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create initial commit: %v", err)
	}

	return tmpDir
}

func newTestManager(t *testing.T, repoPath string) *WorktreeManager {
	t.Helper()

	logPath := filepath.Join(t.TempDir(), "test.log")
	logger, err := logging.New(logPath)
	if err != nil {
		t.Fatalf("Failed to create logger: %v", err)
	}
	t.Cleanup(func() { logger.Close() })

	return NewWorktreeManager(repoPath, logger)
}

func TestNewWorktreeManager(t *testing.T) {
	repoPath := initTestRepo(t)
	manager := newTestManager(t, repoPath)

	if manager == nil {
		t.Fatal("NewWorktreeManager() returned nil")
	}
	if manager.repoPath != repoPath {
		t.Errorf("repoPath = %q, want %q", manager.repoPath, repoPath)
	}
}

func TestWorktreeCreate(t *testing.T) {
	repoPath := initTestRepo(t)
	manager := newTestManager(t, repoPath)
	ctx := context.Background()

	info, err := manager.Create(ctx, "task-1")
	if err != nil {
		t.Fatalf("Create() error: %v", err)
	}

	if info.TaskID != "task-1" {
		t.Errorf("TaskID = %q, want %q", info.TaskID, "task-1")
	}
	if info.Branch != "coven/task-1" {
		t.Errorf("Branch = %q, want %q", info.Branch, "coven/task-1")
	}

	// Verify worktree exists
	if _, err := os.Stat(info.Path); os.IsNotExist(err) {
		t.Error("Worktree path does not exist")
	}

	// Creating again should be idempotent (return existing worktree)
	info2, err := manager.Create(ctx, "task-1")
	if err != nil {
		t.Errorf("Create() should be idempotent: %v", err)
	}
	if info2.Path != info.Path {
		t.Errorf("Idempotent Create() should return same path: got %q, want %q", info2.Path, info.Path)
	}
}

func TestWorktreeRemove(t *testing.T) {
	repoPath := initTestRepo(t)
	manager := newTestManager(t, repoPath)
	ctx := context.Background()

	// Create worktree
	info, err := manager.Create(ctx, "task-1")
	if err != nil {
		t.Fatalf("Create() error: %v", err)
	}

	// Remove worktree
	if err := manager.Remove(ctx, "task-1"); err != nil {
		t.Fatalf("Remove() error: %v", err)
	}

	// Verify worktree is gone
	if _, err := os.Stat(info.Path); !os.IsNotExist(err) {
		t.Error("Worktree path should not exist after Remove()")
	}

	// Removing again should be idempotent
	if err := manager.Remove(ctx, "task-1"); err != nil {
		t.Errorf("Remove() should be idempotent: %v", err)
	}
}

func TestWorktreeGet(t *testing.T) {
	repoPath := initTestRepo(t)
	manager := newTestManager(t, repoPath)
	ctx := context.Background()

	// Get non-existent worktree
	_, err := manager.Get("nonexistent")
	if err == nil {
		t.Error("Get() should fail for non-existent worktree")
	}

	// Create worktree
	_, err = manager.Create(ctx, "task-1")
	if err != nil {
		t.Fatalf("Create() error: %v", err)
	}

	// Get worktree
	info, err := manager.Get("task-1")
	if err != nil {
		t.Fatalf("Get() error: %v", err)
	}

	if info.TaskID != "task-1" {
		t.Errorf("TaskID = %q, want %q", info.TaskID, "task-1")
	}
}

func TestWorktreeList(t *testing.T) {
	repoPath := initTestRepo(t)
	manager := newTestManager(t, repoPath)
	ctx := context.Background()

	// List empty
	worktrees, err := manager.List()
	if err != nil {
		t.Fatalf("List() error: %v", err)
	}
	if len(worktrees) != 0 {
		t.Errorf("Expected 0 worktrees, got %d", len(worktrees))
	}

	// Create worktrees
	manager.Create(ctx, "task-1")
	manager.Create(ctx, "task-2")

	// List again
	worktrees, err = manager.List()
	if err != nil {
		t.Fatalf("List() error: %v", err)
	}
	if len(worktrees) != 2 {
		t.Errorf("Expected 2 worktrees, got %d", len(worktrees))
	}
}

func TestWorktreeDetectOrphans(t *testing.T) {
	repoPath := initTestRepo(t)
	manager := newTestManager(t, repoPath)
	ctx := context.Background()

	// Create worktrees
	manager.Create(ctx, "task-1")
	manager.Create(ctx, "task-2")
	manager.Create(ctx, "task-3")

	// Only task-1 is active
	activeTasks := map[string]bool{
		"task-1": true,
	}

	orphans, err := manager.DetectOrphans(activeTasks)
	if err != nil {
		t.Fatalf("DetectOrphans() error: %v", err)
	}

	if len(orphans) != 2 {
		t.Errorf("Expected 2 orphans, got %d", len(orphans))
	}

	// Verify orphan task IDs
	orphanIDs := make(map[string]bool)
	for _, o := range orphans {
		orphanIDs[o.TaskID] = true
	}
	if !orphanIDs["task-2"] || !orphanIDs["task-3"] {
		t.Error("Expected task-2 and task-3 to be orphans")
	}
}

func TestWorktreeCleanupOrphans(t *testing.T) {
	repoPath := initTestRepo(t)
	manager := newTestManager(t, repoPath)
	ctx := context.Background()

	// Create worktrees
	manager.Create(ctx, "task-1")
	manager.Create(ctx, "task-2")

	orphans := []WorktreeInfo{
		{Path: manager.GetPath("task-2"), TaskID: "task-2"},
	}

	if err := manager.CleanupOrphans(ctx, orphans); err != nil {
		t.Fatalf("CleanupOrphans() error: %v", err)
	}

	// task-1 should still exist
	if !manager.Exists("task-1") {
		t.Error("task-1 should still exist")
	}

	// task-2 should be gone
	if manager.Exists("task-2") {
		t.Error("task-2 should be removed")
	}
}

func TestWorktreeExists(t *testing.T) {
	repoPath := initTestRepo(t)
	manager := newTestManager(t, repoPath)
	ctx := context.Background()

	if manager.Exists("task-1") {
		t.Error("Exists() should return false for non-existent worktree")
	}

	manager.Create(ctx, "task-1")

	if !manager.Exists("task-1") {
		t.Error("Exists() should return true for existing worktree")
	}
}

func TestWorktreeGetPath(t *testing.T) {
	repoPath := initTestRepo(t)
	manager := newTestManager(t, repoPath)

	path := manager.GetPath("task-1")
	expected := filepath.Join(repoPath, ".coven", "worktrees", "task-1")
	if path != expected {
		t.Errorf("GetPath() = %q, want %q", path, expected)
	}
}

func TestSanitizeBranchName(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"task-1", "coven/task-1"},
		{"task.1", "coven/task.1"},
		{"task 1", "coven/task-1"},
		{"task..1", "coven/task-1"},
		{"task~1", "coven/task-1"},
		{"task^1", "coven/task-1"},
		{"task:1", "coven/task-1"},
		{"task?1", "coven/task-1"},
		{"task*1", "coven/task-1"},
		{"task[1", "coven/task-1"},
		{"task\\1", "coven/task-1"},
	}

	for _, tt := range tests {
		got := sanitizeBranchName(tt.input)
		if got != tt.want {
			t.Errorf("sanitizeBranchName(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}
