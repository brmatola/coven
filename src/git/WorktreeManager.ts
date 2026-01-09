import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import { GitProvider, Worktree, MergeResult } from './types';
import { GitCLI } from './GitCLI';
import { getLogger } from '../shared/logger';

/**
 * Events emitted by WorktreeManager.
 */
export interface WorktreeManagerEvents {
  'worktree:created': { taskId: string; worktree: Worktree };
  'worktree:deleted': { taskId: string; path: string };
  'worktree:merged': { taskId: string; result: MergeResult };
  'worktree:conflict': { taskId: string; conflicts: MergeResult['conflicts'] };
  'worktree:orphan': { path: string; branch: string };
  error: Error;
}

/**
 * Manages git worktrees for agent task isolation.
 * Each agent gets its own worktree to work in, preventing conflicts.
 */
export class WorktreeManager extends EventEmitter {
  private gitProvider: GitProvider;
  private workspaceRoot: string;
  private worktreeBasePath: string;
  private sessionId: string;
  private activeWorktrees: Map<string, Worktree> = new Map();
  private logger = getLogger();

  constructor(
    workspaceRoot: string,
    worktreeBasePath: string,
    sessionId: string,
    gitProvider?: GitProvider
  ) {
    super();
    this.workspaceRoot = workspaceRoot;
    this.worktreeBasePath = worktreeBasePath;
    this.sessionId = sessionId;
    this.gitProvider = gitProvider ?? new GitCLI(workspaceRoot);
  }

  /**
   * Initialize the manager, detecting existing worktrees.
   */
  async initialize(): Promise<void> {
    await this.ensureBasePath();
    await this.detectExistingWorktrees();
  }

  /**
   * Create a worktree for a task.
   * @param taskId Unique task identifier
   * @param featureBranch The main feature branch to base the task branch on
   */
  async createForTask(taskId: string, featureBranch: string): Promise<Worktree> {
    if (this.activeWorktrees.has(taskId)) {
      throw new Error(`Worktree already exists for task: ${taskId}`);
    }

    // Validate feature branch exists
    const branchExists = await this.gitProvider.branchExists(featureBranch);
    if (!branchExists) {
      throw new Error(
        `Feature branch '${featureBranch}' does not exist. ` +
          `Please create the branch first or start a new session with an existing branch.`
      );
    }

    const worktreePath = this.getWorktreePath(taskId);
    const branchName = this.getTaskBranchName(taskId);

    this.logger.info('Creating worktree for task', { taskId, worktreePath, branchName, featureBranch });

    try {
      const worktree = await this.gitProvider.createWorktree(branchName, worktreePath, {
        baseBranch: featureBranch,
        createBranch: true,
      });

      this.activeWorktrees.set(taskId, worktree);
      this.emit('worktree:created', { taskId, worktree });

      return worktree;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Provide more helpful error messages for common issues
      if (errMsg.includes('already exists')) {
        throw new Error(
          `Cannot create worktree for task ${taskId}: branch or directory already exists. ` +
            `Try cleaning up orphaned worktrees with 'git worktree prune'.`
        );
      }
      throw err;
    }
  }

  /**
   * Get the worktree for a task if it exists.
   */
  getWorktree(taskId: string): Worktree | undefined {
    return this.activeWorktrees.get(taskId);
  }

  /**
   * Get all active worktrees.
   */
  getAllWorktrees(): Map<string, Worktree> {
    return new Map(this.activeWorktrees);
  }

  /**
   * Merge task branch back to the feature branch and clean up.
   * @param taskId Task identifier
   * @param featureBranch The feature branch to merge into
   */
  async mergeToFeature(taskId: string, featureBranch: string): Promise<MergeResult> {
    const worktree = this.activeWorktrees.get(taskId);
    if (!worktree) {
      throw new Error(`No worktree found for task: ${taskId}`);
    }

    const taskBranch = worktree.branch;
    this.logger.info('Merging task to feature branch', { taskId, taskBranch, featureBranch });

    // Perform merge in the main worktree (repo root)
    const result = await this.gitProvider.merge(taskBranch, {
      message: `Merge task ${taskId}: ${taskBranch}`,
      fastForward: false,
    });

    this.emit('worktree:merged', { taskId, result });

    if (!result.success && result.conflicts.length > 0) {
      this.emit('worktree:conflict', { taskId, conflicts: result.conflicts });
    }

    return result;
  }

  /**
   * Clean up a worktree after task completion.
   * @param taskId Task identifier
   * @param deleteBranch Whether to also delete the task branch
   */
  async cleanupForTask(taskId: string, deleteBranch = true): Promise<void> {
    const worktree = this.activeWorktrees.get(taskId);
    if (!worktree) {
      this.logger.warn('No worktree to cleanup for task', { taskId });
      return;
    }

    const branchName = worktree.branch;
    const worktreePath = worktree.path;

    this.logger.info('Cleaning up worktree', { taskId, worktreePath, branchName });

    // Delete worktree
    await this.gitProvider.deleteWorktree(worktreePath, true);

    // Delete branch if requested
    if (deleteBranch) {
      try {
        await this.gitProvider.deleteBranch(branchName, true);
      } catch (err) {
        // Branch might not exist or be protected
        this.logger.warn('Failed to delete branch', { branchName, error: String(err) });
      }
    }

    this.activeWorktrees.delete(taskId);
    this.emit('worktree:deleted', { taskId, path: worktreePath });
  }

  /**
   * Detect and handle orphaned worktrees from previous sessions.
   * Returns list of orphaned worktrees found.
   */
  async detectOrphans(): Promise<Worktree[]> {
    const worktrees = await this.gitProvider.listWorktrees();
    const sessionPrefix = this.getWorktreePrefix();
    const orphans: Worktree[] = [];

    for (const worktree of worktrees) {
      // Skip main worktree
      if (worktree.isMain) continue;

      // Check if this is a coven worktree from a previous session
      if (worktree.path.includes(this.worktreeBasePath) && !worktree.path.includes(sessionPrefix)) {
        orphans.push(worktree);
        this.emit('worktree:orphan', { path: worktree.path, branch: worktree.branch });
      }
    }

    return orphans;
  }

  /**
   * Clean up all orphaned worktrees.
   */
  async cleanupOrphans(): Promise<number> {
    const orphans = await this.detectOrphans();
    let cleaned = 0;

    for (const orphan of orphans) {
      try {
        await this.gitProvider.deleteWorktree(orphan.path, true);
        // Also try to delete the branch
        try {
          await this.gitProvider.deleteBranch(orphan.branch, true);
        } catch {
          // Branch might be in use elsewhere
        }
        cleaned++;
      } catch (err) {
        this.logger.error('Failed to cleanup orphan worktree', {
          path: orphan.path,
          error: String(err),
        });
      }
    }

    return cleaned;
  }

  /**
   * Get the status of a task's worktree.
   */
  async getTaskStatus(taskId: string): Promise<{
    hasChanges: boolean;
    staged: number;
    modified: number;
    untracked: number;
  } | null> {
    const worktree = this.activeWorktrees.get(taskId);
    if (!worktree) return null;

    const status = await this.gitProvider.getStatus(worktree.path);

    return {
      hasChanges: status.staged.length > 0 || status.modified.length > 0 || status.untracked.length > 0,
      staged: status.staged.length,
      modified: status.modified.length,
      untracked: status.untracked.length,
    };
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.removeAllListeners();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async ensureBasePath(): Promise<void> {
    const fullBasePath = path.join(this.workspaceRoot, this.worktreeBasePath);
    await fs.promises.mkdir(fullBasePath, { recursive: true });
  }

  private async detectExistingWorktrees(): Promise<void> {
    const worktrees = await this.gitProvider.listWorktrees();
    const sessionPrefix = this.getWorktreePrefix();

    for (const worktree of worktrees) {
      if (worktree.path.startsWith(sessionPrefix)) {
        // Extract task ID from path
        const taskId = this.extractTaskIdFromPath(worktree.path);
        if (taskId) {
          this.activeWorktrees.set(taskId, worktree);
          this.logger.info('Detected existing worktree', { taskId, path: worktree.path });
        }
      }
    }
  }

  private getWorktreePrefix(): string {
    return path.join(this.workspaceRoot, this.worktreeBasePath, this.sessionId);
  }

  private getWorktreePath(taskId: string): string {
    // Sanitize task ID for filesystem
    const safeTaskId = taskId.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(this.getWorktreePrefix(), safeTaskId);
  }

  private getTaskBranchName(taskId: string): string {
    // Sanitize task ID for git branch name
    const safeTaskId = taskId.replace(/[^a-zA-Z0-9-_]/g, '-');
    return `coven/${this.sessionId}/${safeTaskId}`;
  }

  private extractTaskIdFromPath(worktreePath: string): string | null {
    const prefix = this.getWorktreePrefix();
    if (!worktreePath.startsWith(prefix)) return null;

    const relativePath = worktreePath.substring(prefix.length);
    const taskId = relativePath.replace(/^\//, '');
    return taskId || null;
  }
}
