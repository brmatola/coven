package workflow

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/coven/daemon/internal/grimoire"
)

// MockMergeRunner is a mock implementation for testing.
type MockMergeRunner struct {
	// Diff to return from GetDiff.
	Diff string
	// DiffErr to return from GetDiff.
	DiffErr error

	// Files to return from GetStatus.
	Files []string
	// StatusErr to return from GetStatus.
	StatusErr error

	// Additions to return from GetDiffStats.
	Additions int
	// Deletions to return from GetDiffStats.
	Deletions int
	// StatsErr to return from GetDiffStats.
	StatsErr error

	// HasConflictsResult to return from HasConflicts.
	HasConflictsResult bool
	// ConflictFiles to return from HasConflicts.
	ConflictFiles []string
	// ConflictsErr to return from HasConflicts.
	ConflictsErr error

	// MergeErr to return from Merge.
	MergeErr error

	// MergeCalled tracks if Merge was called.
	MergeCalled bool
}

func (m *MockMergeRunner) GetDiff(ctx context.Context, workDir string) (string, error) {
	return m.Diff, m.DiffErr
}

func (m *MockMergeRunner) GetStatus(ctx context.Context, workDir string) ([]string, error) {
	return m.Files, m.StatusErr
}

func (m *MockMergeRunner) GetDiffStats(ctx context.Context, workDir string) (int, int, error) {
	return m.Additions, m.Deletions, m.StatsErr
}

func (m *MockMergeRunner) HasConflicts(ctx context.Context, workDir string) (bool, []string, error) {
	return m.HasConflictsResult, m.ConflictFiles, m.ConflictsErr
}

func (m *MockMergeRunner) Merge(ctx context.Context, workDir string) error {
	m.MergeCalled = true
	return m.MergeErr
}

func TestNewMergeExecutor(t *testing.T) {
	executor := NewMergeExecutor()
	if executor == nil {
		t.Fatal("NewMergeExecutor() returned nil")
	}
	if executor.runner == nil {
		t.Fatal("executor.runner is nil")
	}
}

func TestNewMergeExecutorWithRunner(t *testing.T) {
	runner := &MockMergeRunner{}
	executor := NewMergeExecutorWithRunner(runner)
	if executor == nil {
		t.Fatal("NewMergeExecutorWithRunner() returned nil")
	}
	if executor.runner != runner {
		t.Fatal("executor.runner is not the provided runner")
	}
}

func TestMergeExecutor_Execute_WrongType(t *testing.T) {
	executor := NewMergeExecutorWithRunner(&MockMergeRunner{})

	step := &grimoire.Step{
		Name: "test",
		Type: grimoire.StepTypeScript,
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	_, err := executor.Execute(context.Background(), step, stepCtx)
	if err == nil {
		t.Fatal("Expected error for wrong step type")
	}
	if !strings.Contains(err.Error(), "expected merge step") {
		t.Errorf("Error should mention expected type, got: %q", err.Error())
	}
}

func TestMergeExecutor_Execute_RequireReviewTrue(t *testing.T) {
	runner := &MockMergeRunner{
		Diff:      "diff content",
		Files:     []string{"src/main.go", "src/util.go"},
		Additions: 50,
		Deletions: 10,
	}
	executor := NewMergeExecutorWithRunner(runner)

	step := &grimoire.Step{
		Name: "merge",
		Type: grimoire.StepTypeMerge,
		// RequireReview defaults to true (nil)
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	// Should block for review
	if result.Action != ActionBlock {
		t.Errorf("Action = %q, want %q", result.Action, ActionBlock)
	}
	if !result.Success {
		t.Error("Expected success (merge preparation successful)")
	}

	// Should not have called Merge
	if runner.MergeCalled {
		t.Error("Merge should not be called when require_review is true")
	}

	// Check that review info was stored
	reviewVar := stepCtx.GetVariable("merge_review")
	if reviewVar == nil {
		t.Fatal("merge_review variable should be set")
	}

	review, ok := reviewVar.(*MergeReview)
	if !ok {
		t.Fatalf("merge_review should be *MergeReview, got %T", reviewVar)
	}

	if len(review.FilesChanged) != 2 {
		t.Errorf("FilesChanged = %d, want 2", len(review.FilesChanged))
	}
	if review.Additions != 50 {
		t.Errorf("Additions = %d, want 50", review.Additions)
	}
}

func TestMergeExecutor_Execute_RequireReviewFalse(t *testing.T) {
	runner := &MockMergeRunner{
		Diff:      "diff content",
		Files:     []string{"src/main.go"},
		Additions: 10,
		Deletions: 5,
	}
	executor := NewMergeExecutorWithRunner(runner)

	requireReview := false
	step := &grimoire.Step{
		Name:          "merge",
		Type:          grimoire.StepTypeMerge,
		RequireReview: &requireReview,
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	// Should continue (auto-merge)
	if result.Action != ActionContinue {
		t.Errorf("Action = %q, want %q", result.Action, ActionContinue)
	}
	if !result.Success {
		t.Error("Expected success")
	}

	// Should have called Merge
	if !runner.MergeCalled {
		t.Error("Merge should be called when require_review is false")
	}
}

func TestMergeExecutor_Execute_WithConflicts(t *testing.T) {
	runner := &MockMergeRunner{
		Diff:               "diff with conflicts",
		Files:              []string{"src/main.go"},
		HasConflictsResult: true,
		ConflictFiles:      []string{"src/main.go"},
	}
	executor := NewMergeExecutorWithRunner(runner)

	step := &grimoire.Step{
		Name: "merge",
		Type: grimoire.StepTypeMerge,
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	// Should block due to conflicts
	if result.Action != ActionBlock {
		t.Errorf("Action = %q, want %q", result.Action, ActionBlock)
	}
	if result.Success {
		t.Error("Expected failure due to conflicts")
	}
	if !strings.Contains(result.Error, "conflict") {
		t.Errorf("Error should mention conflict, got: %q", result.Error)
	}
}

func TestMergeExecutor_Execute_NoChanges(t *testing.T) {
	runner := &MockMergeRunner{
		Diff:      "",
		Files:     []string{},
		Additions: 0,
		Deletions: 0,
	}
	executor := NewMergeExecutorWithRunner(runner)

	step := &grimoire.Step{
		Name: "merge",
		Type: grimoire.StepTypeMerge,
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	// Still blocks for review
	if result.Action != ActionBlock {
		t.Errorf("Action = %q, want %q", result.Action, ActionBlock)
	}

	// Output should mention no changes
	if !strings.Contains(result.Output, "No changes") {
		t.Errorf("Output should mention no changes, got: %s", result.Output)
	}
}

func TestMergeExecutor_Execute_DiffError(t *testing.T) {
	runner := &MockMergeRunner{
		DiffErr: errors.New("git diff failed"),
	}
	executor := NewMergeExecutorWithRunner(runner)

	step := &grimoire.Step{
		Name: "merge",
		Type: grimoire.StepTypeMerge,
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() returned error: %v", err)
	}

	if result.Success {
		t.Error("Expected failure")
	}
	if result.Action != ActionFail {
		t.Errorf("Action = %q, want %q", result.Action, ActionFail)
	}
	if !strings.Contains(result.Error, "generate review") {
		t.Errorf("Error should mention generate review, got: %q", result.Error)
	}
}

func TestMergeExecutor_Execute_MergeError(t *testing.T) {
	runner := &MockMergeRunner{
		Diff:     "diff content",
		Files:    []string{"src/main.go"},
		MergeErr: errors.New("merge failed"),
	}
	executor := NewMergeExecutorWithRunner(runner)

	requireReview := false
	step := &grimoire.Step{
		Name:          "merge",
		Type:          grimoire.StepTypeMerge,
		RequireReview: &requireReview,
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	result, err := executor.Execute(context.Background(), step, stepCtx)
	if err != nil {
		t.Fatalf("Execute() returned error: %v", err)
	}

	if result.Success {
		t.Error("Expected failure")
	}
	if result.Action != ActionFail {
		t.Errorf("Action = %q, want %q", result.Action, ActionFail)
	}
	if !strings.Contains(result.Error, "merge failed") {
		t.Errorf("Error should mention merge failed, got: %q", result.Error)
	}
}

func TestMergeExecutor_Execute_InvalidTimeout(t *testing.T) {
	executor := NewMergeExecutorWithRunner(&MockMergeRunner{})

	step := &grimoire.Step{
		Name:    "merge",
		Type:    grimoire.StepTypeMerge,
		Timeout: "invalid",
	}
	stepCtx := NewStepContext("/worktree", "bead", "wf")

	_, err := executor.Execute(context.Background(), step, stepCtx)
	if err == nil {
		t.Fatal("Expected error for invalid timeout")
	}
	if !strings.Contains(err.Error(), "invalid timeout") {
		t.Errorf("Error should mention invalid timeout, got: %q", err.Error())
	}
}

func TestMergeReview_Summary(t *testing.T) {
	tests := []struct {
		name     string
		review   *MergeReview
		contains string
	}{
		{
			name:     "no changes",
			review:   &MergeReview{},
			contains: "No changes",
		},
		{
			name: "single file",
			review: &MergeReview{
				FilesChanged: []string{"a.go"},
				Additions:    10,
				Deletions:    5,
			},
			contains: "1 file(s) changed",
		},
		{
			name: "with conflicts",
			review: &MergeReview{
				FilesChanged:  []string{"a.go", "b.go"},
				HasConflicts:  true,
				ConflictFiles: []string{"a.go"},
			},
			contains: "conflict",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			summary := generateMergeSummary(tt.review)
			if !strings.Contains(strings.ToLower(summary), strings.ToLower(tt.contains)) {
				t.Errorf("Summary = %q, want to contain %q", summary, tt.contains)
			}
		})
	}
}

func TestFormatReviewOutput(t *testing.T) {
	review := &MergeReview{
		Summary:      "2 file(s) changed, +50/-10 lines",
		FilesChanged: []string{"src/main.go", "src/util.go"},
		Additions:    50,
		Deletions:    10,
		Diff:         "diff content here",
	}

	output := formatReviewOutput(review)

	if !strings.Contains(output, "Merge Review") {
		t.Error("Output should contain 'Merge Review'")
	}
	if !strings.Contains(output, "Summary") {
		t.Error("Output should contain 'Summary'")
	}
	if !strings.Contains(output, "Files Changed") {
		t.Error("Output should contain 'Files Changed'")
	}
	if !strings.Contains(output, "src/main.go") {
		t.Error("Output should contain file name")
	}
	if !strings.Contains(output, "```diff") {
		t.Error("Output should contain diff block")
	}
}

func TestFormatReviewOutput_LargeDiff(t *testing.T) {
	// Create a diff larger than 10000 characters
	largeDiff := strings.Repeat("a", 10001)
	review := &MergeReview{
		Summary:      "test",
		FilesChanged: []string{"file.go"},
		Diff:         largeDiff,
	}

	output := formatReviewOutput(review)

	if strings.Contains(output, "```diff") {
		t.Error("Large diff should not be included in output")
	}
	if !strings.Contains(output, "too large") {
		t.Error("Output should mention diff is too large")
	}
}

func TestFormatReviewOutput_WithConflicts(t *testing.T) {
	review := &MergeReview{
		Summary:       "conflicts",
		FilesChanged:  []string{"file.go"},
		HasConflicts:  true,
		ConflictFiles: []string{"file.go"},
	}

	output := formatReviewOutput(review)

	if !strings.Contains(output, "Conflicts") {
		t.Error("Output should contain 'Conflicts' section")
	}
	if !strings.Contains(output, "file.go") {
		t.Error("Output should list conflict files")
	}
}

func TestDefaultMergeRunner(t *testing.T) {
	// Just verify the type implements the interface
	var _ MergeRunner = (*DefaultMergeRunner)(nil)
}

func TestDefaultMergeRunner_GetDiff(t *testing.T) {
	// Create a temp git repo
	tmpDir := t.TempDir()

	// Initialize git repo
	initCmd := exec.Command("git", "init")
	initCmd.Dir = tmpDir
	if err := initCmd.Run(); err != nil {
		t.Skipf("git init failed: %v", err)
	}

	// Configure git user
	configName := exec.Command("git", "config", "user.name", "Test")
	configName.Dir = tmpDir
	configName.Run()

	configEmail := exec.Command("git", "config", "user.email", "test@test.com")
	configEmail.Dir = tmpDir
	configEmail.Run()

	// Create initial commit
	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("initial"), 0644); err != nil {
		t.Fatalf("WriteFile error: %v", err)
	}

	addCmd := exec.Command("git", "add", ".")
	addCmd.Dir = tmpDir
	addCmd.Run()

	commitCmd := exec.Command("git", "commit", "-m", "initial")
	commitCmd.Dir = tmpDir
	commitCmd.Run()

	// Modify file
	if err := os.WriteFile(testFile, []byte("modified"), 0644); err != nil {
		t.Fatalf("WriteFile error: %v", err)
	}

	runner := &DefaultMergeRunner{}
	diff, err := runner.GetDiff(context.Background(), tmpDir)
	if err != nil {
		t.Fatalf("GetDiff() error: %v", err)
	}

	if !strings.Contains(diff, "initial") || !strings.Contains(diff, "modified") {
		t.Errorf("Diff should show changes, got: %s", diff)
	}
}

func TestDefaultMergeRunner_GetStatus(t *testing.T) {
	tmpDir := t.TempDir()

	// Initialize git repo
	initCmd := exec.Command("git", "init")
	initCmd.Dir = tmpDir
	if err := initCmd.Run(); err != nil {
		t.Skipf("git init failed: %v", err)
	}

	// Create a new file
	testFile := filepath.Join(tmpDir, "newfile.txt")
	if err := os.WriteFile(testFile, []byte("content"), 0644); err != nil {
		t.Fatalf("WriteFile error: %v", err)
	}

	runner := &DefaultMergeRunner{}
	files, err := runner.GetStatus(context.Background(), tmpDir)
	if err != nil {
		t.Fatalf("GetStatus() error: %v", err)
	}

	found := false
	for _, f := range files {
		if f == "newfile.txt" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("Status should include newfile.txt, got: %v", files)
	}
}

func TestDefaultMergeRunner_GetDiffStats(t *testing.T) {
	tmpDir := t.TempDir()

	// Initialize git repo
	initCmd := exec.Command("git", "init")
	initCmd.Dir = tmpDir
	if err := initCmd.Run(); err != nil {
		t.Skipf("git init failed: %v", err)
	}

	// Configure git user
	configName := exec.Command("git", "config", "user.name", "Test")
	configName.Dir = tmpDir
	configName.Run()

	configEmail := exec.Command("git", "config", "user.email", "test@test.com")
	configEmail.Dir = tmpDir
	configEmail.Run()

	// Create initial commit
	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("line1\nline2\n"), 0644); err != nil {
		t.Fatalf("WriteFile error: %v", err)
	}

	addCmd := exec.Command("git", "add", ".")
	addCmd.Dir = tmpDir
	addCmd.Run()

	commitCmd := exec.Command("git", "commit", "-m", "initial")
	commitCmd.Dir = tmpDir
	commitCmd.Run()

	// Modify file - add 2 lines, delete 1
	if err := os.WriteFile(testFile, []byte("line1\nnewline1\nnewline2\n"), 0644); err != nil {
		t.Fatalf("WriteFile error: %v", err)
	}

	runner := &DefaultMergeRunner{}
	additions, deletions, err := runner.GetDiffStats(context.Background(), tmpDir)
	if err != nil {
		t.Fatalf("GetDiffStats() error: %v", err)
	}

	// We added 2 lines and deleted 1
	if additions != 2 {
		t.Errorf("Additions = %d, want 2", additions)
	}
	if deletions != 1 {
		t.Errorf("Deletions = %d, want 1", deletions)
	}
}

func TestDefaultMergeRunner_HasConflicts(t *testing.T) {
	tmpDir := t.TempDir()

	// Initialize git repo
	initCmd := exec.Command("git", "init")
	initCmd.Dir = tmpDir
	if err := initCmd.Run(); err != nil {
		t.Skipf("git init failed: %v", err)
	}

	// Create a file with no conflicts
	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("no conflicts"), 0644); err != nil {
		t.Fatalf("WriteFile error: %v", err)
	}

	runner := &DefaultMergeRunner{}
	hasConflicts, files, err := runner.HasConflicts(context.Background(), tmpDir)
	if err != nil {
		t.Fatalf("HasConflicts() error: %v", err)
	}

	if hasConflicts {
		t.Error("Should not have conflicts")
	}
	if len(files) > 0 {
		t.Errorf("Should have no conflict files, got: %v", files)
	}
}

func TestDefaultMergeRunner_Merge(t *testing.T) {
	tmpDir := t.TempDir()

	// Initialize git repo
	initCmd := exec.Command("git", "init")
	initCmd.Dir = tmpDir
	if err := initCmd.Run(); err != nil {
		t.Skipf("git init failed: %v", err)
	}

	// Configure git user
	configName := exec.Command("git", "config", "user.name", "Test")
	configName.Dir = tmpDir
	configName.Run()

	configEmail := exec.Command("git", "config", "user.email", "test@test.com")
	configEmail.Dir = tmpDir
	configEmail.Run()

	// Create initial commit
	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("initial"), 0644); err != nil {
		t.Fatalf("WriteFile error: %v", err)
	}

	addCmd := exec.Command("git", "add", ".")
	addCmd.Dir = tmpDir
	addCmd.Run()

	commitCmd := exec.Command("git", "commit", "-m", "initial")
	commitCmd.Dir = tmpDir
	commitCmd.Run()

	// Create changes
	if err := os.WriteFile(testFile, []byte("modified"), 0644); err != nil {
		t.Fatalf("WriteFile error: %v", err)
	}

	runner := &DefaultMergeRunner{}
	err := runner.Merge(context.Background(), tmpDir)
	if err != nil {
		t.Fatalf("Merge() error: %v", err)
	}

	// Verify commit was created
	logCmd := exec.Command("git", "log", "--oneline", "-1")
	logCmd.Dir = tmpDir
	var stdout bytes.Buffer
	logCmd.Stdout = &stdout
	logCmd.Run()

	if !strings.Contains(stdout.String(), "Merge changes") {
		t.Errorf("Expected merge commit, got: %s", stdout.String())
	}
}
