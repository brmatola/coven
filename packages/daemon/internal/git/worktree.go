// Package git provides git worktree management for agent tasks.
package git

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/coven/daemon/internal/logging"
)

// WorktreeManager manages git worktrees for agent tasks.
type WorktreeManager struct {
	repoPath     string
	worktreesDir string
	logger       *logging.Logger
}

// WorktreeInfo contains information about a worktree.
type WorktreeInfo struct {
	Path   string
	Branch string
	TaskID string
}

// NewWorktreeManager creates a new worktree manager.
func NewWorktreeManager(repoPath string, logger *logging.Logger) *WorktreeManager {
	return &WorktreeManager{
		repoPath:     repoPath,
		worktreesDir: filepath.Join(repoPath, ".coven", "worktrees"),
		logger:       logger,
	}
}

// Create creates a new worktree for a task.
func (m *WorktreeManager) Create(ctx context.Context, taskID string) (*WorktreeInfo, error) {
	// Ensure worktrees directory exists
	if err := os.MkdirAll(m.worktreesDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create worktrees dir: %w", err)
	}

	// Sanitize task ID for branch name
	branchName := sanitizeBranchName(taskID)
	worktreePath := filepath.Join(m.worktreesDir, taskID)

	// Check if worktree already exists
	if _, err := os.Stat(worktreePath); err == nil {
		return nil, fmt.Errorf("worktree already exists for task %s", taskID)
	}

	// Get current branch to base off
	baseBranch, err := m.getCurrentBranch(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get current branch: %w", err)
	}

	// Create the worktree with a new branch
	args := []string{"worktree", "add", "-b", branchName, worktreePath, baseBranch}
	if err := m.runGit(ctx, args...); err != nil {
		return nil, fmt.Errorf("failed to create worktree: %w", err)
	}

	m.logger.Info("created worktree", "task_id", taskID, "path", worktreePath, "branch", branchName)

	return &WorktreeInfo{
		Path:   worktreePath,
		Branch: branchName,
		TaskID: taskID,
	}, nil
}

// Remove removes a worktree for a task.
func (m *WorktreeManager) Remove(ctx context.Context, taskID string) error {
	worktreePath := filepath.Join(m.worktreesDir, taskID)

	// Check if worktree exists
	if _, err := os.Stat(worktreePath); os.IsNotExist(err) {
		return nil // Already removed
	}

	// Remove the worktree
	if err := m.runGit(ctx, "worktree", "remove", "--force", worktreePath); err != nil {
		// Try to clean up manually if git command fails
		if removeErr := os.RemoveAll(worktreePath); removeErr != nil {
			return fmt.Errorf("failed to remove worktree: %w", err)
		}
	}

	// Prune worktree list
	_ = m.runGit(ctx, "worktree", "prune")

	m.logger.Info("removed worktree", "task_id", taskID, "path", worktreePath)

	return nil
}

// Get returns information about a worktree for a task.
func (m *WorktreeManager) Get(taskID string) (*WorktreeInfo, error) {
	worktreePath := filepath.Join(m.worktreesDir, taskID)

	if _, err := os.Stat(worktreePath); os.IsNotExist(err) {
		return nil, fmt.Errorf("worktree not found for task %s", taskID)
	}

	branchName := sanitizeBranchName(taskID)

	return &WorktreeInfo{
		Path:   worktreePath,
		Branch: branchName,
		TaskID: taskID,
	}, nil
}

// List returns all coven-managed worktrees.
func (m *WorktreeManager) List() ([]WorktreeInfo, error) {
	if _, err := os.Stat(m.worktreesDir); os.IsNotExist(err) {
		return []WorktreeInfo{}, nil
	}

	entries, err := os.ReadDir(m.worktreesDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read worktrees dir: %w", err)
	}

	var worktrees []WorktreeInfo
	for _, entry := range entries {
		if entry.IsDir() {
			taskID := entry.Name()
			worktrees = append(worktrees, WorktreeInfo{
				Path:   filepath.Join(m.worktreesDir, taskID),
				Branch: sanitizeBranchName(taskID),
				TaskID: taskID,
			})
		}
	}

	return worktrees, nil
}

// DetectOrphans returns worktrees that exist but aren't associated with active tasks.
func (m *WorktreeManager) DetectOrphans(activeTasks map[string]bool) ([]WorktreeInfo, error) {
	worktrees, err := m.List()
	if err != nil {
		return nil, err
	}

	var orphans []WorktreeInfo
	for _, wt := range worktrees {
		if !activeTasks[wt.TaskID] {
			orphans = append(orphans, wt)
		}
	}

	return orphans, nil
}

// CleanupOrphans removes all orphan worktrees.
func (m *WorktreeManager) CleanupOrphans(ctx context.Context, orphans []WorktreeInfo) error {
	for _, orphan := range orphans {
		if err := m.Remove(ctx, orphan.TaskID); err != nil {
			m.logger.Error("failed to remove orphan worktree", "task_id", orphan.TaskID, "error", err)
		} else {
			m.logger.Info("removed orphan worktree", "task_id", orphan.TaskID)
		}
	}
	return nil
}

// Exists checks if a worktree exists for a task.
func (m *WorktreeManager) Exists(taskID string) bool {
	worktreePath := filepath.Join(m.worktreesDir, taskID)
	_, err := os.Stat(worktreePath)
	return err == nil
}

// DeleteBranch deletes a branch from the repository.
// This should be called after the worktree has been removed and the branch merged.
func (m *WorktreeManager) DeleteBranch(ctx context.Context, branchName string) error {
	// Force delete since we might be on a different branch
	if err := m.runGit(ctx, "branch", "-D", branchName); err != nil {
		return fmt.Errorf("failed to delete branch %s: %w", branchName, err)
	}
	m.logger.Info("deleted branch", "branch", branchName)
	return nil
}

// GetBaseBranch returns the base branch that worktrees are created from.
// This is typically 'main' or 'master'.
func (m *WorktreeManager) GetBaseBranch(ctx context.Context) (string, error) {
	// Check for 'main' first, then 'master'
	for _, branch := range []string{"main", "master"} {
		cmd := exec.CommandContext(ctx, "git", "show-ref", "--verify", "--quiet", "refs/heads/"+branch)
		cmd.Dir = m.repoPath
		if err := cmd.Run(); err == nil {
			return branch, nil
		}
	}

	// Fall back to current branch
	return m.getCurrentBranch(ctx)
}

// GetPath returns the path for a task's worktree.
func (m *WorktreeManager) GetPath(taskID string) string {
	return filepath.Join(m.worktreesDir, taskID)
}

// RepoPath returns the path to the main repository.
func (m *WorktreeManager) RepoPath() string {
	return m.repoPath
}

// getCurrentBranch returns the current branch name.
func (m *WorktreeManager) getCurrentBranch(ctx context.Context) (string, error) {
	cmd := exec.CommandContext(ctx, "git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = m.repoPath
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

// runGit runs a git command in the repo.
func (m *WorktreeManager) runGit(ctx context.Context, args ...string) error {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = m.repoPath
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %s", err, string(output))
	}
	return nil
}

// sanitizeBranchName converts a task ID to a valid git branch name.
func sanitizeBranchName(taskID string) string {
	// Replace invalid characters with dashes
	name := strings.ReplaceAll(taskID, " ", "-")
	name = strings.ReplaceAll(name, "..", "-")
	name = strings.ReplaceAll(name, "~", "-")
	name = strings.ReplaceAll(name, "^", "-")
	name = strings.ReplaceAll(name, ":", "-")
	name = strings.ReplaceAll(name, "?", "-")
	name = strings.ReplaceAll(name, "*", "-")
	name = strings.ReplaceAll(name, "[", "-")
	name = strings.ReplaceAll(name, "\\", "-")

	// Prefix with coven/
	return "coven/" + name
}
