/**
 * ReviewManager handles the business logic for reviewing agent work.
 * Coordinates between git operations, task state, and the review UI.
 */

import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';
import { WorktreeManager } from '../git/WorktreeManager';
import { GitCLI } from '../git/GitCLI';
import { BeadsTaskSource } from '../tasks/BeadsTaskSource';
import { getLogger } from '../shared/logger';
import {
  ReviewStatus,
  ChangedFile,
  CheckResult,
} from './types';

const execAsync = promisify(exec);

const CHECK_TIMEOUT_MS = 300000; // 5 minute timeout for checks

interface ReviewConfig {
  preMergeChecks: {
    enabled: boolean;
    commands: string[];
  };
}

/**
 * Events emitted by ReviewManager.
 */
export interface ReviewManagerEvents {
  'review:started': { taskId: string };
  'review:approved': { taskId: string; feedback?: string };
  'review:reverted': { taskId: string; reason?: string };
  'check:started': { taskId: string; command: string };
  'check:completed': { taskId: string; result: CheckResult };
  'error': { taskId: string; error: string };
}

/**
 * Information about a review in progress.
 */
export interface ReviewInfo {
  taskId: string;
  status: ReviewStatus;
  changedFiles: ChangedFile[];
  checkResults: CheckResult[];
  startedAt: number;
}

/**
 * Manages the review workflow for completed agent tasks.
 */
export class ReviewManager extends EventEmitter {
  private worktreeManager: WorktreeManager;
  private beadsTaskSource: BeadsTaskSource;
  private gitProvider: GitCLI;
  private getConfig: () => ReviewConfig;
  private logger = getLogger();
  private activeReviews: Map<string, ReviewInfo> = new Map();

  constructor(
    workspaceRoot: string,
    worktreeManager: WorktreeManager,
    beadsTaskSource: BeadsTaskSource,
    getConfig: () => ReviewConfig
  ) {
    super();
    this.worktreeManager = worktreeManager;
    this.beadsTaskSource = beadsTaskSource;
    this.getConfig = getConfig;
    this.gitProvider = new GitCLI(workspaceRoot);
  }

  /**
   * Start a review for a task.
   * @param taskId The task to review
   */
  async startReview(taskId: string): Promise<ReviewInfo> {
    const existing = this.activeReviews.get(taskId);
    if (existing) {
      return existing;
    }

    this.logger.info('Starting review for task', { taskId });

    const changedFiles = await this.getChangedFiles(taskId);

    const review: ReviewInfo = {
      taskId,
      status: 'pending',
      changedFiles,
      checkResults: [],
      startedAt: Date.now(),
    };

    this.activeReviews.set(taskId, review);
    this.emit('review:started', { taskId });

    return review;
  }

  /**
   * Get the changed files for a task.
   * @param taskId The task to get changes for
   */
  async getChangedFiles(taskId: string): Promise<ChangedFile[]> {
    const worktree = this.worktreeManager.getWorktree(taskId);
    if (!worktree) {
      this.logger.warn('No worktree found for task', { taskId });
      return [];
    }

    try {
      // Get the feature branch from the worktree
      const featureBranch = await this.getFeatureBranchFromWorktree(worktree.path);

      // Get diff between feature branch and task branch
      const diffSummary = await this.gitProvider.getDiff(
        featureBranch,
        worktree.branch,
        worktree.path
      );

      const changedFiles: ChangedFile[] = [];

      for (const file of diffSummary.added) {
        changedFiles.push({
          path: file,
          linesAdded: 0, // Will be filled from numstat
          linesDeleted: 0,
          changeType: 'added',
        });
      }

      for (const file of diffSummary.modified) {
        changedFiles.push({
          path: file,
          linesAdded: 0,
          linesDeleted: 0,
          changeType: 'modified',
        });
      }

      for (const file of diffSummary.deleted) {
        changedFiles.push({
          path: file,
          linesAdded: 0,
          linesDeleted: 0,
          changeType: 'deleted',
        });
      }

      // Get detailed line counts
      const { stdout } = await this.execInWorktree(
        `git diff --numstat ${featureBranch}...HEAD`,
        worktree.path
      );

      for (const line of stdout.split('\n')) {
        const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
        if (match) {
          const [, addStr, delStr, filePath] = match;
          const linesAdded = addStr === '-' ? 0 : parseInt(addStr ?? '0', 10);
          const linesDeleted = delStr === '-' ? 0 : parseInt(delStr ?? '0', 10);

          const existing = changedFiles.find((f) => f.path === filePath);
          if (existing) {
            existing.linesAdded = linesAdded;
            existing.linesDeleted = linesDeleted;
          } else {
            changedFiles.push({
              path: filePath ?? '',
              linesAdded,
              linesDeleted,
              changeType: 'modified',
            });
          }
        }
      }

      return changedFiles;
    } catch (err) {
      this.logger.error('Failed to get changed files', {
        taskId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * Run pre-merge checks for a task.
   * @param taskId The task to run checks for
   */
  async runPreMergeChecks(taskId: string): Promise<CheckResult[]> {
    const review = this.activeReviews.get(taskId);
    if (!review) {
      throw new Error(`No active review for task: ${taskId}`);
    }

    const config = this.getConfig();
    if (!config.preMergeChecks.enabled || config.preMergeChecks.commands.length === 0) {
      return [];
    }

    const worktree = this.worktreeManager.getWorktree(taskId);
    if (!worktree) {
      throw new Error(`No worktree found for task: ${taskId}`);
    }

    review.status = 'checking';
    review.checkResults = [];

    const results: CheckResult[] = [];

    for (const command of config.preMergeChecks.commands) {
      const result: CheckResult = {
        command,
        status: 'running',
      };

      this.emit('check:started', { taskId, command });

      const startTime = Date.now();

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: worktree.path,
          timeout: CHECK_TIMEOUT_MS,
        });

        result.status = 'passed';
        result.exitCode = 0;
        result.stdout = stdout;
        result.stderr = stderr;
        result.durationMs = Date.now() - startTime;
      } catch (err) {
        const execErr = err as { code?: number; stdout?: string; stderr?: string };
        result.status = 'failed';
        result.exitCode = execErr.code ?? 1;
        result.stdout = execErr.stdout ?? '';
        result.stderr = execErr.stderr ?? (err instanceof Error ? err.message : String(err));
        result.durationMs = Date.now() - startTime;
      }

      results.push(result);
      review.checkResults.push(result);
      this.emit('check:completed', { taskId, result });

      // Stop on first failure
      if (result.status === 'failed') {
        break;
      }
    }

    review.status = results.every((r) => r.status === 'passed') ? 'pending' : 'pending';
    return results;
  }

  /**
   * Approve the task, merging changes to feature branch.
   * @param taskId The task to approve
   * @param feedback Optional feedback from reviewer
   */
  async approve(taskId: string, feedback?: string): Promise<void> {
    const review = this.activeReviews.get(taskId);
    if (!review) {
      throw new Error(`No active review for task: ${taskId}`);
    }

    this.logger.info('Approving task', { taskId, feedback });

    try {
      // Get the feature branch
      const featureBranch = await this.getFeatureBranchForTask(taskId);
      if (!featureBranch) {
        throw new Error('Cannot determine feature branch');
      }

      // Merge the task branch to feature branch
      const result = await this.worktreeManager.mergeToFeature(taskId, featureBranch);

      if (!result.success) {
        throw new Error(`Merge failed with conflicts in: ${result.conflicts.map((c) => c.path).join(', ')}`);
      }

      // Update task status to done
      await this.beadsTaskSource.updateTaskStatus(taskId, 'done');

      review.status = 'approved';
      this.activeReviews.delete(taskId);

      this.emit('review:approved', { taskId, feedback });

      this.logger.info('Task approved and merged', { taskId });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error('Failed to approve task', { taskId, error: errMsg });
      this.emit('error', { taskId, error: errMsg });
      throw err;
    }
  }

  /**
   * Revert the task, discarding changes and returning to ready.
   * @param taskId The task to revert
   * @param reason Optional reason for reverting
   */
  async revert(taskId: string, reason?: string): Promise<void> {
    const review = this.activeReviews.get(taskId);
    if (!review) {
      throw new Error(`No active review for task: ${taskId}`);
    }

    this.logger.info('Reverting task', { taskId, reason });

    try {
      // Delete the worktree without merging
      await this.worktreeManager.cleanupForTask(taskId);

      // Update task status back to ready
      await this.beadsTaskSource.updateTaskStatus(taskId, 'ready');

      review.status = 'reverted';
      this.activeReviews.delete(taskId);

      this.emit('review:reverted', { taskId, reason });

      this.logger.info('Task reverted', { taskId });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error('Failed to revert task', { taskId, error: errMsg });
      this.emit('error', { taskId, error: errMsg });
      throw err;
    }
  }

  /**
   * Get the active review for a task.
   */
  getReview(taskId: string): ReviewInfo | undefined {
    return this.activeReviews.get(taskId);
  }

  /**
   * Check if a task has an active review.
   */
  hasReview(taskId: string): boolean {
    return this.activeReviews.has(taskId);
  }

  /**
   * Get all active reviews.
   */
  getAllReviews(): ReviewInfo[] {
    return Array.from(this.activeReviews.values());
  }

  /**
   * Get the pre-merge check configuration.
   */
  getPreMergeChecksConfig(): { enabled: boolean; commands: string[] } {
    const config = this.getConfig();
    return config.preMergeChecks;
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.activeReviews.clear();
    this.removeAllListeners();
  }

  private async getFeatureBranchFromWorktree(worktreePath: string): Promise<string> {
    try {
      // Try to get the upstream branch
      const { stdout } = await this.execInWorktree(
        'git rev-parse --abbrev-ref @{upstream} 2>/dev/null || git rev-parse --abbrev-ref HEAD~1 2>/dev/null || echo main',
        worktreePath
      );
      return stdout.trim().replace('origin/', '') || 'main';
    } catch {
      return 'main';
    }
  }

  private async getFeatureBranchForTask(taskId: string): Promise<string | null> {
    const worktree = this.worktreeManager.getWorktree(taskId);
    if (!worktree) {
      return null;
    }
    return this.getFeatureBranchFromWorktree(worktree.path);
  }

  private async execInWorktree(
    command: string,
    worktreePath: string
  ): Promise<{ stdout: string; stderr: string }> {
    return execAsync(command, {
      cwd: worktreePath,
      timeout: 30000,
    });
  }
}
