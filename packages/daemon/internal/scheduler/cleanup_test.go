package scheduler

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCleanupDirectory(t *testing.T) {
	sched, _, _ := newTestScheduler(t)
	defer sched.Stop()

	// Create test directory
	testDir := filepath.Join(t.TempDir(), "cleanup-test")
	if err := os.MkdirAll(testDir, 0755); err != nil {
		t.Fatalf("Failed to create test directory: %v", err)
	}

	// Create some test files
	oldFile := filepath.Join(testDir, "old.json")
	newFile := filepath.Join(testDir, "new.json")
	otherFile := filepath.Join(testDir, "other.txt")

	// Write files
	os.WriteFile(oldFile, []byte("old"), 0644)
	os.WriteFile(newFile, []byte("new"), 0644)
	os.WriteFile(otherFile, []byte("other"), 0644)

	// Set old file to be older than 7 days
	oldTime := time.Now().Add(-8 * 24 * time.Hour)
	os.Chtimes(oldFile, oldTime, oldTime)

	// Run cleanup with cutoff at 7 days ago
	cutoff := time.Now().Add(-7 * 24 * time.Hour)
	sched.cleanupDirectory(testDir, cutoff, ".json")

	// Verify old file was deleted
	if _, err := os.Stat(oldFile); !os.IsNotExist(err) {
		t.Error("Old file should have been deleted")
	}

	// Verify new file still exists
	if _, err := os.Stat(newFile); err != nil {
		t.Error("New file should still exist")
	}

	// Verify other file (wrong extension) still exists
	if _, err := os.Stat(otherFile); err != nil {
		t.Error("Other file should still exist (wrong extension)")
	}
}

func TestCleanupDirectory_NonexistentDir(t *testing.T) {
	sched, _, _ := newTestScheduler(t)
	defer sched.Stop()

	// Should not panic or error for nonexistent directory
	cutoff := time.Now().Add(-7 * 24 * time.Hour)
	sched.cleanupDirectory("/nonexistent/path", cutoff, ".json")
}

func TestCleanupDirectory_SkipsDirectories(t *testing.T) {
	sched, _, _ := newTestScheduler(t)
	defer sched.Stop()

	// Create test directory with a subdirectory
	testDir := filepath.Join(t.TempDir(), "cleanup-test-dirs")
	if err := os.MkdirAll(testDir, 0755); err != nil {
		t.Fatalf("Failed to create test directory: %v", err)
	}

	subDir := filepath.Join(testDir, "subdir.json")
	if err := os.MkdirAll(subDir, 0755); err != nil {
		t.Fatalf("Failed to create subdirectory: %v", err)
	}

	// Run cleanup
	cutoff := time.Now().Add(-7 * 24 * time.Hour)
	sched.cleanupDirectory(testDir, cutoff, ".json")

	// Subdirectory should still exist
	if _, err := os.Stat(subDir); err != nil {
		t.Error("Subdirectory should not be deleted")
	}
}
