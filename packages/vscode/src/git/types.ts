/**
 * Git operations types for worktree management and merging.
 */

/**
 * Represents a git worktree.
 */
export interface Worktree {
  /** Absolute path to the worktree directory */
  path: string;
  /** Branch checked out in this worktree */
  branch: string;
  /** HEAD commit hash */
  head: string;
  /** Whether this is the main worktree */
  isMain: boolean;
  /** Whether this worktree is bare (no working tree) */
  isBare: boolean;
}

/**
 * Result of a merge operation.
 */
export interface MergeResult {
  /** Whether the merge succeeded without conflicts */
  success: boolean;
  /** List of conflicting files if merge failed */
  conflicts: ConflictFile[];
  /** List of successfully merged files */
  mergedFiles: string[];
  /** Merge commit hash if successful */
  commitHash?: string | undefined;
}

/**
 * Represents a file with merge conflicts.
 */
export interface ConflictFile {
  /** Path to the conflicting file relative to repo root */
  path: string;
  /** Content from the current branch (ours) */
  ourContent: string;
  /** Content from the incoming branch (theirs) */
  theirContent: string;
  /** Common ancestor content if available */
  baseContent?: string | undefined;
}

/**
 * Git working directory status.
 */
export interface GitStatus {
  /** Files staged for commit */
  staged: string[];
  /** Modified files not staged */
  modified: string[];
  /** Untracked files */
  untracked: string[];
  /** Deleted files */
  deleted: string[];
  /** Current branch name */
  branch: string;
  /** Commits ahead of tracking branch */
  ahead: number;
  /** Commits behind tracking branch */
  behind: number;
}

/**
 * Summary of changes between two commits/branches.
 */
export interface DiffSummary {
  /** Files added */
  added: string[];
  /** Files modified */
  modified: string[];
  /** Files deleted */
  deleted: string[];
  /** Total lines added */
  linesAdded: number;
  /** Total lines deleted */
  linesDeleted: number;
}

/**
 * Options for creating a worktree.
 */
export interface CreateWorktreeOptions {
  /** Base branch to create the new branch from (defaults to current branch) */
  baseBranch?: string;
  /** Whether to create a new branch (defaults to true) */
  createBranch?: boolean;
}

/**
 * Options for merging branches.
 */
export interface MergeOptions {
  /** Commit message for merge commit */
  message?: string;
  /** Whether to squash commits (defaults to false) */
  squash?: boolean;
  /** Whether to allow fast-forward (defaults to true) */
  fastForward?: boolean;
}

/**
 * Interface for git operations.
 * Abstracts git commands to allow different implementations (CLI, libgit2, etc.).
 */
export interface GitProvider {
  // Worktree operations
  /**
   * Create a new worktree with an optional new branch.
   * @param branch Branch name to checkout or create
   * @param path Absolute path for the worktree
   * @param options Additional options
   */
  createWorktree(branch: string, path: string, options?: CreateWorktreeOptions): Promise<Worktree>;

  /**
   * Remove a worktree.
   * @param path Path to the worktree to remove
   * @param force Whether to force removal even with uncommitted changes
   */
  deleteWorktree(path: string, force?: boolean): Promise<void>;

  /**
   * List all worktrees in the repository.
   */
  listWorktrees(): Promise<Worktree[]>;

  /**
   * Check if a path is a valid worktree.
   */
  isWorktree(path: string): Promise<boolean>;

  // Branch operations
  /**
   * Create a new branch.
   * @param name Branch name
   * @param base Base branch or commit (defaults to HEAD)
   */
  createBranch(name: string, base?: string): Promise<void>;

  /**
   * Delete a branch.
   * @param name Branch name
   * @param force Whether to force deletion
   */
  deleteBranch(name: string, force?: boolean): Promise<void>;

  /**
   * Check if a branch exists.
   */
  branchExists(name: string): Promise<boolean>;

  /**
   * Get the current branch name.
   * @param workingDir Optional working directory (defaults to repo root)
   */
  getCurrentBranch(workingDir?: string): Promise<string>;

  // Merge operations
  /**
   * Merge a branch into the current branch.
   * @param source Source branch to merge from
   * @param options Merge options
   * @param workingDir Working directory for the merge
   */
  merge(source: string, options?: MergeOptions, workingDir?: string): Promise<MergeResult>;

  /**
   * Abort an in-progress merge.
   * @param workingDir Working directory
   */
  abortMerge(workingDir?: string): Promise<void>;

  // Status and diff
  /**
   * Get the status of the working directory.
   * @param workingDir Working directory to check
   */
  getStatus(workingDir?: string): Promise<GitStatus>;

  /**
   * Get a summary of changes between two refs.
   * @param base Base ref
   * @param head Head ref
   * @param workingDir Working directory
   */
  getDiff(base: string, head: string, workingDir?: string): Promise<DiffSummary>;

  // Commit operations
  /**
   * Stage files for commit.
   * @param files Files to stage (use '.' for all)
   * @param workingDir Working directory
   */
  add(files: string | string[], workingDir?: string): Promise<void>;

  /**
   * Create a commit.
   * @param message Commit message
   * @param workingDir Working directory
   */
  commit(message: string, workingDir?: string): Promise<string>;

  // Repository info
  /**
   * Get the repository root directory.
   * @param fromDir Directory to start search from
   */
  getRepoRoot(fromDir?: string): Promise<string>;

  /**
   * Check if git is available.
   */
  isAvailable(): Promise<boolean>;
}
