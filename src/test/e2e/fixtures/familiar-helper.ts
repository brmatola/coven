import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Familiar status types matching FamiliarManager.
 */
export type FamiliarStatus = 'working' | 'waiting' | 'merging' | 'complete' | 'failed';

/**
 * Process information for agent tracking.
 */
export interface ProcessInfo {
  pid: number;
  startTime: number;
  command: string;
  worktreePath: string;
}

/**
 * Persisted familiar state structure (from .coven/familiars/<taskId>.json).
 */
export interface PersistedFamiliar {
  taskId: string;
  status: FamiliarStatus;
  processInfo: ProcessInfo;
  spawnedAt: number;
  outputBuffer: string[];
}

/**
 * Familiar state for test assertions.
 */
export interface FamiliarState {
  taskId: string;
  status: FamiliarStatus;
  pid: number;
  worktreePath: string;
  spawnedAt: number;
  isWorking: boolean;
  isComplete: boolean;
  isFailed: boolean;
  outputLines: number;
}

/**
 * Worktree information from git.
 */
export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

/**
 * Default timeout for operations (ms).
 */
const DEFAULT_TIMEOUT = 60000;

/**
 * Polling interval for status checks (ms).
 */
const POLL_INTERVAL = 500;

/**
 * Helper for familiar (agent) operations in E2E tests.
 * Reads actual state from .coven/familiars/*.json for verification.
 */
export class FamiliarHelper {
  private workspacePath: string;
  private familiarsDir: string;
  private worktreesDir: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.familiarsDir = path.join(workspacePath, '.coven', 'familiars');
    this.worktreesDir = path.join(workspacePath, '.coven', 'worktrees');
  }

  /**
   * Get familiar state for a specific task by reading .coven/familiars/<taskId>.json.
   * Returns null if file doesn't exist or can't be read.
   */
  getFamiliarState(taskId: string): FamiliarState | null {
    try {
      const filePath = path.join(this.familiarsDir, `${taskId}.json`);
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const persisted = JSON.parse(content) as PersistedFamiliar;

      return this.toFamiliarState(persisted);
    } catch {
      return null;
    }
  }

  /**
   * Get familiar state asynchronously.
   */
  async getFamiliarStateAsync(taskId: string): Promise<FamiliarState | null> {
    try {
      const filePath = path.join(this.familiarsDir, `${taskId}.json`);
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const persisted = JSON.parse(content) as PersistedFamiliar;

      return this.toFamiliarState(persisted);
    } catch {
      return null;
    }
  }

  /**
   * Get all familiar states.
   */
  async getAllFamiliarStates(): Promise<FamiliarState[]> {
    const states: FamiliarState[] = [];

    try {
      if (!fs.existsSync(this.familiarsDir)) {
        return states;
      }

      const files = await fs.promises.readdir(this.familiarsDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const taskId = file.replace('.json', '');
          const state = await this.getFamiliarStateAsync(taskId);
          if (state) {
            states.push(state);
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return states;
  }

  /**
   * Check if a familiar exists for a task.
   */
  familiarExists(taskId: string): boolean {
    const filePath = path.join(this.familiarsDir, `${taskId}.json`);
    return fs.existsSync(filePath);
  }

  /**
   * Wait for a familiar to be created for a task.
   */
  async waitForFamiliar(taskId: string, timeoutMs = DEFAULT_TIMEOUT): Promise<FamiliarState> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const state = this.getFamiliarState(taskId);
      if (state) {
        return state;
      }
      await this.sleep(POLL_INTERVAL);
    }

    throw new Error(`Timeout waiting for familiar for task '${taskId}' after ${timeoutMs}ms`);
  }

  /**
   * Wait for familiar to reach a specific status.
   */
  async waitForFamiliarStatus(
    taskId: string,
    status: FamiliarStatus,
    timeoutMs = DEFAULT_TIMEOUT
  ): Promise<FamiliarState> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const state = this.getFamiliarState(taskId);
      if (state?.status === status) {
        return state;
      }
      await this.sleep(POLL_INTERVAL);
    }

    const currentState = this.getFamiliarState(taskId);
    throw new Error(
      `Timeout waiting for familiar status '${status}' for task '${taskId}' after ${timeoutMs}ms. ` +
      `Current status: ${currentState?.status ?? 'no familiar'}`
    );
  }

  /**
   * Wait for familiar to complete (status = 'complete' or 'failed').
   */
  async waitForFamiliarComplete(taskId: string, timeoutMs = DEFAULT_TIMEOUT): Promise<FamiliarState> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const state = this.getFamiliarState(taskId);
      if (state?.status === 'complete' || state?.status === 'failed') {
        return state;
      }
      await this.sleep(POLL_INTERVAL);
    }

    const currentState = this.getFamiliarState(taskId);
    throw new Error(
      `Timeout waiting for familiar to complete for task '${taskId}' after ${timeoutMs}ms. ` +
      `Current status: ${currentState?.status ?? 'no familiar'}`
    );
  }

  /**
   * Check if process is still alive.
   */
  isProcessAlive(pid: number): boolean {
    try {
      // Sending signal 0 checks if process exists
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if familiar's process is still alive.
   */
  isFamiliarProcessAlive(taskId: string): boolean {
    const state = this.getFamiliarState(taskId);
    if (!state) {
      return false;
    }
    return this.isProcessAlive(state.pid);
  }

  /**
   * List all git worktrees in the workspace.
   */
  async listWorktrees(): Promise<WorktreeInfo[]> {
    try {
      const { stdout } = await execAsync('git worktree list --porcelain', {
        cwd: this.workspacePath,
      });

      const worktrees: WorktreeInfo[] = [];
      let current: Partial<WorktreeInfo> = {};

      for (const line of stdout.split('\n')) {
        if (line.startsWith('worktree ')) {
          if (current.path) {
            worktrees.push(current as WorktreeInfo);
          }
          current = { path: line.substring('worktree '.length) };
        } else if (line.startsWith('HEAD ')) {
          current.head = line.substring('HEAD '.length);
        } else if (line.startsWith('branch ')) {
          current.branch = line.substring('branch '.length);
        }
      }

      if (current.path) {
        worktrees.push(current as WorktreeInfo);
      }

      return worktrees;
    } catch {
      return [];
    }
  }

  /**
   * Find worktree for a specific task.
   * Worktree paths follow the pattern: .coven/worktrees/<sessionId>/<taskId>
   */
  async findWorktreeForTask(taskId: string): Promise<WorktreeInfo | null> {
    const worktrees = await this.listWorktrees();

    for (const worktree of worktrees) {
      // Check if path ends with taskId
      if (worktree.path.endsWith(taskId) || worktree.path.includes(`/${taskId}`)) {
        return worktree;
      }

      // Also check if branch contains taskId
      if (worktree.branch?.includes(taskId)) {
        return worktree;
      }
    }

    return null;
  }

  /**
   * Check if worktree exists for a task.
   */
  async worktreeExistsForTask(taskId: string): Promise<boolean> {
    const worktree = await this.findWorktreeForTask(taskId);
    return worktree !== null;
  }

  /**
   * Wait for worktree to be created for a task.
   */
  async waitForWorktree(taskId: string, timeoutMs = DEFAULT_TIMEOUT): Promise<WorktreeInfo> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const worktree = await this.findWorktreeForTask(taskId);
      if (worktree) {
        return worktree;
      }
      await this.sleep(POLL_INTERVAL);
    }

    throw new Error(`Timeout waiting for worktree for task '${taskId}' after ${timeoutMs}ms`);
  }

  /**
   * Get the number of active familiars (status = 'working' or 'waiting').
   */
  async getActiveFamiliarCount(): Promise<number> {
    const states = await this.getAllFamiliarStates();
    return states.filter((s) => s.status === 'working' || s.status === 'waiting').length;
  }

  /**
   * Delete familiar state file.
   * Use this for test cleanup.
   */
  async deleteFamiliar(taskId: string): Promise<void> {
    try {
      const filePath = path.join(this.familiarsDir, `${taskId}.json`);
      await fs.promises.unlink(filePath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Clean up all familiar state files.
   */
  async cleanup(): Promise<void> {
    try {
      if (!fs.existsSync(this.familiarsDir)) {
        return;
      }

      const files = await fs.promises.readdir(this.familiarsDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          await fs.promises.unlink(path.join(this.familiarsDir, file));
        }
      }
    } catch {
      // Ignore errors
    }
  }

  private toFamiliarState(persisted: PersistedFamiliar): FamiliarState {
    return {
      taskId: persisted.taskId,
      status: persisted.status,
      pid: persisted.processInfo.pid,
      worktreePath: persisted.processInfo.worktreePath,
      spawnedAt: persisted.spawnedAt,
      isWorking: persisted.status === 'working',
      isComplete: persisted.status === 'complete',
      isFailed: persisted.status === 'failed',
      outputLines: persisted.outputBuffer.length,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a FamiliarHelper for the given workspace.
 */
export function createFamiliarHelper(workspacePath: string): FamiliarHelper {
  return new FamiliarHelper(workspacePath);
}
