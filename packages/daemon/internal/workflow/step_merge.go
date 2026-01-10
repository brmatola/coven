package workflow

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/coven/daemon/internal/grimoire"
)

// MergeReview contains information for human review of merge.
type MergeReview struct {
	// Diff is the unified diff of changes.
	Diff string `json:"diff"`

	// Summary is a brief description of changes.
	Summary string `json:"summary"`

	// FilesChanged is the list of modified files.
	FilesChanged []string `json:"files_changed"`

	// Additions is the number of lines added.
	Additions int `json:"additions"`

	// Deletions is the number of lines deleted.
	Deletions int `json:"deletions"`

	// HasConflicts indicates if there are merge conflicts.
	HasConflicts bool `json:"has_conflicts"`

	// ConflictFiles lists files with conflicts.
	ConflictFiles []string `json:"conflict_files,omitempty"`
}

// MergeResult contains the result of a merge-to-main operation.
type MergeResult struct {
	// Success indicates if the merge completed without conflicts.
	Success bool `json:"success"`

	// HasConflicts indicates if merge conflicts were detected.
	HasConflicts bool `json:"has_conflicts"`

	// ConflictFiles lists files with merge conflicts.
	ConflictFiles []string `json:"conflict_files,omitempty"`

	// MergeCommit is the SHA of the merge commit if successful.
	MergeCommit string `json:"merge_commit,omitempty"`
}

// MergeRunner handles git operations for merging.
type MergeRunner interface {
	// GetDiff returns the diff of uncommitted changes in the worktree.
	GetDiff(ctx context.Context, workDir string) (string, error)

	// GetStatus returns changed files in the worktree.
	GetStatus(ctx context.Context, workDir string) ([]string, error)

	// GetDiffStats returns additions and deletions count.
	GetDiffStats(ctx context.Context, workDir string) (additions, deletions int, err error)

	// HasConflicts checks if there are merge conflicts.
	HasConflicts(ctx context.Context, workDir string) (bool, []string, error)

	// CommitWorktree stages and commits all changes in the worktree.
	CommitWorktree(ctx context.Context, workDir string) error

	// MergeToMain merges the worktree branch into the main branch.
	// Returns MergeResult with conflict info if merge cannot proceed.
	MergeToMain(ctx context.Context, mainRepoDir, worktreeBranch, baseBranch string) (*MergeResult, error)
}

// DefaultMergeRunner is the default implementation using git commands.
type DefaultMergeRunner struct{}

// GetDiff returns the diff of changes.
func (r *DefaultMergeRunner) GetDiff(ctx context.Context, workDir string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", "diff", "HEAD")
	cmd.Dir = workDir

	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git diff failed: %w", err)
	}

	return stdout.String(), nil
}

// GetStatus returns changed files.
func (r *DefaultMergeRunner) GetStatus(ctx context.Context, workDir string) ([]string, error) {
	cmd := exec.CommandContext(ctx, "git", "status", "--porcelain")
	cmd.Dir = workDir

	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("git status failed: %w", err)
	}

	var files []string
	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")
	for _, line := range lines {
		if len(line) > 3 {
			files = append(files, strings.TrimSpace(line[3:]))
		}
	}

	return files, nil
}

// GetDiffStats returns additions and deletions count.
func (r *DefaultMergeRunner) GetDiffStats(ctx context.Context, workDir string) (additions, deletions int, err error) {
	cmd := exec.CommandContext(ctx, "git", "diff", "--numstat", "HEAD")
	cmd.Dir = workDir

	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	if err := cmd.Run(); err != nil {
		return 0, 0, fmt.Errorf("git diff --numstat failed: %w", err)
	}

	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) >= 2 {
			var add, del int
			if parts[0] != "-" {
				fmt.Sscanf(parts[0], "%d", &add)
			}
			if parts[1] != "-" {
				fmt.Sscanf(parts[1], "%d", &del)
			}
			additions += add
			deletions += del
		}
	}

	return additions, deletions, nil
}

// HasConflicts checks for merge conflicts.
func (r *DefaultMergeRunner) HasConflicts(ctx context.Context, workDir string) (bool, []string, error) {
	// Check for conflict markers in tracked files
	cmd := exec.CommandContext(ctx, "git", "diff", "--check")
	cmd.Dir = workDir

	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	// git diff --check exits with 2 if there are conflict markers
	err := cmd.Run()
	if err == nil {
		return false, nil, nil
	}

	// Parse conflict files from output
	var conflictFiles []string
	lines := strings.Split(stdout.String(), "\n")
	for _, line := range lines {
		if strings.Contains(line, ":") {
			parts := strings.SplitN(line, ":", 2)
			file := parts[0]
			// Deduplicate
			found := false
			for _, f := range conflictFiles {
				if f == file {
					found = true
					break
				}
			}
			if !found {
				conflictFiles = append(conflictFiles, file)
			}
		}
	}

	return len(conflictFiles) > 0, conflictFiles, nil
}

// CommitWorktree stages and commits all changes in the worktree.
func (r *DefaultMergeRunner) CommitWorktree(ctx context.Context, workDir string) error {
	// Stage all changes
	stageCmd := exec.CommandContext(ctx, "git", "add", "-A")
	stageCmd.Dir = workDir
	if err := stageCmd.Run(); err != nil {
		return fmt.Errorf("git add failed: %w", err)
	}

	// Check if there are staged changes to commit
	statusCmd := exec.CommandContext(ctx, "git", "diff", "--cached", "--quiet")
	statusCmd.Dir = workDir
	if err := statusCmd.Run(); err == nil {
		// No error means no changes staged - nothing to commit
		return nil
	}

	// Create commit
	commitCmd := exec.CommandContext(ctx, "git", "commit", "-m", "Merge changes from worktree")
	commitCmd.Dir = workDir
	if err := commitCmd.Run(); err != nil {
		return fmt.Errorf("git commit failed: %w", err)
	}

	return nil
}

// MergeToMain merges the worktree branch into the main/base branch.
// This performs:
// 1. Checkout base branch in main repo
// 2. Attempt merge with --no-ff
// 3. If conflicts, abort and return conflict info
// 4. If success, return merge commit SHA
func (r *DefaultMergeRunner) MergeToMain(ctx context.Context, mainRepoDir, worktreeBranch, baseBranch string) (*MergeResult, error) {
	result := &MergeResult{}

	// First, checkout the base branch
	checkoutCmd := exec.CommandContext(ctx, "git", "checkout", baseBranch)
	checkoutCmd.Dir = mainRepoDir
	if output, err := checkoutCmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("failed to checkout %s: %s: %w", baseBranch, string(output), err)
	}

	// Pull latest changes from remote (if remote exists)
	pullCmd := exec.CommandContext(ctx, "git", "pull", "--ff-only")
	pullCmd.Dir = mainRepoDir
	// Ignore errors - may not have a remote configured
	_ = pullCmd.Run()

	// Attempt the merge
	mergeCmd := exec.CommandContext(ctx, "git", "merge", "--no-ff", "-m",
		fmt.Sprintf("Merge branch '%s'", worktreeBranch), worktreeBranch)
	mergeCmd.Dir = mainRepoDir

	var mergeOutput bytes.Buffer
	mergeCmd.Stdout = &mergeOutput
	mergeCmd.Stderr = &mergeOutput

	if err := mergeCmd.Run(); err != nil {
		// Merge failed - check if it's a conflict
		conflictFiles := r.getConflictFiles(ctx, mainRepoDir)
		if len(conflictFiles) > 0 {
			// Abort the merge
			abortCmd := exec.CommandContext(ctx, "git", "merge", "--abort")
			abortCmd.Dir = mainRepoDir
			_ = abortCmd.Run()

			result.Success = false
			result.HasConflicts = true
			result.ConflictFiles = conflictFiles
			return result, nil
		}

		// Not a conflict, some other error
		return nil, fmt.Errorf("merge failed: %s: %w", mergeOutput.String(), err)
	}

	// Merge succeeded - get the commit SHA
	revCmd := exec.CommandContext(ctx, "git", "rev-parse", "HEAD")
	revCmd.Dir = mainRepoDir
	revOutput, err := revCmd.Output()
	if err == nil {
		result.MergeCommit = strings.TrimSpace(string(revOutput))
	}

	result.Success = true
	return result, nil
}

// getConflictFiles returns files that have merge conflicts.
func (r *DefaultMergeRunner) getConflictFiles(ctx context.Context, repoDir string) []string {
	// Use git diff --name-only --diff-filter=U to get unmerged files
	cmd := exec.CommandContext(ctx, "git", "diff", "--name-only", "--diff-filter=U")
	cmd.Dir = repoDir

	output, err := cmd.Output()
	if err != nil {
		return nil
	}

	var files []string
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, line := range lines {
		if line != "" {
			files = append(files, line)
		}
	}
	return files
}

// MergeExecutor executes merge steps.
type MergeExecutor struct {
	runner MergeRunner
}

// NewMergeExecutor creates a new merge executor.
func NewMergeExecutor() *MergeExecutor {
	return &MergeExecutor{
		runner: &DefaultMergeRunner{},
	}
}

// NewMergeExecutorWithRunner creates a merge executor with a custom runner.
func NewMergeExecutorWithRunner(runner MergeRunner) *MergeExecutor {
	return &MergeExecutor{
		runner: runner,
	}
}

// Execute runs a merge step and returns the result.
func (e *MergeExecutor) Execute(ctx context.Context, step *grimoire.Step, stepCtx *StepContext) (*StepResult, error) {
	if step.Type != grimoire.StepTypeMerge {
		return nil, fmt.Errorf("expected merge step, got %s", step.Type)
	}

	// Get timeout
	timeout, err := step.GetTimeout()
	if err != nil {
		return nil, fmt.Errorf("invalid timeout: %w", err)
	}

	// Create context with timeout
	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	start := time.Now()

	// Generate review information
	review, err := e.generateReview(execCtx, stepCtx.WorktreePath)
	if err != nil {
		duration := time.Since(start)
		return &StepResult{
			Success:  false,
			Error:    fmt.Sprintf("failed to generate review: %v", err),
			Duration: duration,
			Action:   ActionFail,
		}, nil
	}

	// Check for conflicts
	if review.HasConflicts {
		duration := time.Since(start)
		return &StepResult{
			Success:  false,
			Output:   formatReviewOutput(review),
			Error:    fmt.Sprintf("merge conflicts in: %s", strings.Join(review.ConflictFiles, ", ")),
			Duration: duration,
			Action:   ActionBlock, // Block for manual conflict resolution
		}, nil
	}

	// Check if review is required (default: true)
	requireReview := step.RequiresReview()

	if requireReview {
		// Return block action to pause for human review
		duration := time.Since(start)

		// Store review info in context for orchestrator
		stepCtx.SetVariable("merge_review", review)

		return &StepResult{
			Success:  true, // Merge preparation successful
			Output:   formatReviewOutput(review),
			Duration: duration,
			Action:   ActionBlock, // Block for human review
		}, nil
	}

	// Auto-merge (require_review: false)
	if err := e.runner.CommitWorktree(execCtx, stepCtx.WorktreePath); err != nil {
		duration := time.Since(start)
		return &StepResult{
			Success:  false,
			Output:   formatReviewOutput(review),
			Error:    fmt.Sprintf("merge failed: %v", err),
			Duration: duration,
			Action:   ActionFail,
		}, nil
	}

	duration := time.Since(start)
	return &StepResult{
		Success:  true,
		Output:   formatReviewOutput(review),
		Duration: duration,
		Action:   ActionContinue,
	}, nil
}

// generateReview creates the review information for the merge.
func (e *MergeExecutor) generateReview(ctx context.Context, workDir string) (*MergeReview, error) {
	review := &MergeReview{}

	// Get diff
	diff, err := e.runner.GetDiff(ctx, workDir)
	if err != nil {
		return nil, fmt.Errorf("failed to get diff: %w", err)
	}
	review.Diff = diff

	// Get changed files
	files, err := e.runner.GetStatus(ctx, workDir)
	if err != nil {
		return nil, fmt.Errorf("failed to get status: %w", err)
	}
	review.FilesChanged = files

	// Get stats
	additions, deletions, err := e.runner.GetDiffStats(ctx, workDir)
	if err != nil {
		return nil, fmt.Errorf("failed to get diff stats: %w", err)
	}
	review.Additions = additions
	review.Deletions = deletions

	// Check for conflicts
	hasConflicts, conflictFiles, err := e.runner.HasConflicts(ctx, workDir)
	if err != nil {
		return nil, fmt.Errorf("failed to check conflicts: %w", err)
	}
	review.HasConflicts = hasConflicts
	review.ConflictFiles = conflictFiles

	// Generate summary
	review.Summary = generateMergeSummary(review)

	return review, nil
}

// generateMergeSummary creates a human-readable summary of the merge.
func generateMergeSummary(review *MergeReview) string {
	if len(review.FilesChanged) == 0 {
		return "No changes to merge"
	}

	var parts []string
	parts = append(parts, fmt.Sprintf("%d file(s) changed", len(review.FilesChanged)))

	if review.Additions > 0 || review.Deletions > 0 {
		parts = append(parts, fmt.Sprintf("+%d/-%d lines", review.Additions, review.Deletions))
	}

	if review.HasConflicts {
		parts = append(parts, fmt.Sprintf("%d conflict(s)", len(review.ConflictFiles)))
	}

	return strings.Join(parts, ", ")
}

// formatReviewOutput formats the review for output.
func formatReviewOutput(review *MergeReview) string {
	var sb strings.Builder

	sb.WriteString("## Merge Review\n\n")
	sb.WriteString(fmt.Sprintf("**Summary:** %s\n\n", review.Summary))

	if len(review.FilesChanged) > 0 {
		sb.WriteString("### Files Changed\n")
		for _, file := range review.FilesChanged {
			sb.WriteString(fmt.Sprintf("- %s\n", file))
		}
		sb.WriteString("\n")
	}

	if review.HasConflicts {
		sb.WriteString("### Conflicts\n")
		for _, file := range review.ConflictFiles {
			sb.WriteString(fmt.Sprintf("- %s\n", file))
		}
		sb.WriteString("\n")
	}

	if review.Diff != "" && len(review.Diff) <= 10000 {
		sb.WriteString("### Diff\n```diff\n")
		sb.WriteString(review.Diff)
		sb.WriteString("\n```\n")
	} else if len(review.Diff) > 10000 {
		sb.WriteString("### Diff\n")
		sb.WriteString("(diff too large to display, use git diff to view)\n")
	}

	return sb.String()
}
