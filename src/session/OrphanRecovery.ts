import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Familiar, ProcessInfo } from '../shared/types';
import { FamiliarManager } from '../agents/FamiliarManager';
import { TaskManager } from '../tasks/TaskManager';

const execAsync = promisify(exec);

/**
 * Represents the state of an orphaned worktree.
 */
export interface OrphanState {
  taskId: string;
  worktreePath: string;
  processInfo: ProcessInfo | null;
  processAlive: boolean;
  hasUncommittedChanges: boolean;
  hasUnmergedCommits: boolean;
}

/**
 * Handles recovery of orphaned familiars from crashed or restarted sessions.
 */
export class OrphanRecovery extends EventEmitter {
  private workspaceRoot: string;
  private worktreeBasePath: string;
  private familiarManager: FamiliarManager;
  private taskManager: TaskManager;

  constructor(
    workspaceRoot: string,
    worktreeBasePath: string,
    familiarManager: FamiliarManager,
    taskManager: TaskManager
  ) {
    super();
    this.workspaceRoot = workspaceRoot;
    this.worktreeBasePath = path.join(workspaceRoot, worktreeBasePath);
    this.familiarManager = familiarManager;
    this.taskManager = taskManager;
  }

  /**
   * Perform orphan recovery for all persisted familiars.
   */
  async recover(): Promise<OrphanState[]> {
    const orphanStates: OrphanState[] = [];
    const familiarIds = await this.familiarManager.getPersistedFamiliarIds();

    for (const taskId of familiarIds) {
      const familiarInfo = await this.familiarManager.getPersistedFamiliarInfo(taskId);
      if (!familiarInfo) continue;

      const orphanState = await this.analyzeOrphan(taskId, familiarInfo);
      orphanStates.push(orphanState);

      await this.handleOrphan(orphanState, familiarInfo);
    }

    return orphanStates;
  }

  /**
   * Analyze the state of an orphaned familiar.
   */
  private async analyzeOrphan(taskId: string, familiar: Familiar): Promise<OrphanState> {
    const processAlive = await this.isProcessAlive(familiar.processInfo);
    const hasUncommittedChanges = await this.hasUncommittedChanges(familiar.processInfo.worktreePath);
    const hasUnmergedCommits = await this.hasUnmergedCommits(familiar.processInfo.worktreePath);

    return {
      taskId,
      worktreePath: familiar.processInfo.worktreePath,
      processInfo: familiar.processInfo,
      processAlive,
      hasUncommittedChanges,
      hasUnmergedCommits,
    };
  }

  /**
   * Handle an orphaned familiar based on its state.
   */
  private async handleOrphan(state: OrphanState, familiar: Familiar): Promise<void> {
    if (state.processAlive) {
      // Process is still running - reconnect to it
      this.emit('orphan:reconnecting', { taskId: state.taskId });
      this.familiarManager.registerRecoveredFamiliar({
        ...familiar,
        status: 'working',
      });
      this.emit('orphan:reconnected', { taskId: state.taskId });
      return;
    }

    // Process is dead
    if (state.hasUnmergedCommits) {
      // Has completed work that needs review
      this.emit('orphan:needsReview', { taskId: state.taskId });
      const task = this.taskManager.getTask(state.taskId);
      if (task && task.status === 'working') {
        this.taskManager.transitionStatus(state.taskId, 'review');
      }
      return;
    }

    if (state.hasUncommittedChanges) {
      // Has uncommitted work - user can continue
      this.emit('orphan:uncommittedChanges', {
        taskId: state.taskId,
        worktreePath: state.worktreePath,
      });
      const task = this.taskManager.getTask(state.taskId);
      if (task && task.status === 'working') {
        this.taskManager.transitionStatus(state.taskId, 'ready');
      }
      return;
    }

    // No recoverable work - clean up
    await this.cleanupWorktree(state.worktreePath);
    this.emit('orphan:cleanedUp', { taskId: state.taskId });
  }

  /**
   * Check if a process is still alive and is the expected claude process.
   */
  async isProcessAlive(processInfo: ProcessInfo): Promise<boolean> {
    try {
      // Check if process exists
      process.kill(processInfo.pid, 0);

      // Verify it's the right process by checking start time and command
      const isMatch = await this.verifyProcess(processInfo);
      return isMatch;
    } catch {
      return false;
    }
  }

  /**
   * Verify that a running process matches our expected process.
   */
  private async verifyProcess(processInfo: ProcessInfo): Promise<boolean> {
    try {
      // On macOS/Linux, use ps to get process info
      const { stdout } = await execAsync(
        `ps -p ${processInfo.pid} -o lstart=,command=`
      );

      // Check if command contains "claude"
      if (!stdout.toLowerCase().includes('claude')) {
        return false;
      }

      // Note: Full start time verification would require parsing the ps output
      // For now, command matching is sufficient as a heuristic
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a worktree has uncommitted changes.
   */
  async hasUncommittedChanges(worktreePath: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync('git status --porcelain', {
        cwd: worktreePath,
      });
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Check if a worktree has commits not merged to the feature branch.
   */
  async hasUnmergedCommits(worktreePath: string): Promise<boolean> {
    try {
      // Get the current branch
      const { stdout: currentBranch } = await execAsync(
        'git rev-parse --abbrev-ref HEAD',
        { cwd: worktreePath }
      );

      // Check if there are commits ahead of origin
      const { stdout } = await execAsync(
        `git log origin/${currentBranch.trim()}..HEAD --oneline`,
        { cwd: worktreePath }
      );
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Clean up a worktree with no recoverable work.
   */
  async cleanupWorktree(worktreePath: string): Promise<void> {
    try {
      // Remove the git worktree
      await execAsync(`git worktree remove "${worktreePath}" --force`, {
        cwd: this.workspaceRoot,
      });
    } catch {
      // If git worktree remove fails, try to manually remove the directory
      try {
        await fs.promises.rm(worktreePath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Enumerate all worktrees in the workspace.
   */
  async enumerateWorktrees(): Promise<string[]> {
    try {
      const entries = await fs.promises.readdir(this.worktreeBasePath, {
        withFileTypes: true,
      });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => path.join(this.worktreeBasePath, e.name));
    } catch {
      return [];
    }
  }
}
