/**
 * Beads CLI wrapper for E2E tests.
 * Creates and manages tasks for testing.
 */

import { execSync, ExecSyncOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface BeadsTask {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: number;
  type: string;
}

export interface CreateTaskOptions {
  title: string;
  description?: string;
  type?: 'task' | 'bug' | 'feature';
  priority?: number;
}

/**
 * Wrapper for beads CLI operations.
 */
export class BeadsClient {
  private workspacePath: string;
  private execOptions: ExecSyncOptions;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.execOptions = {
      cwd: workspacePath,
      encoding: 'utf-8' as BufferEncoding,
      timeout: 30000,
    };
  }

  /**
   * Check if beads is initialized in the workspace.
   */
  isInitialized(): boolean {
    const beadsDir = path.join(this.workspacePath, '.beads');
    return fs.existsSync(beadsDir);
  }

  /**
   * Initialize beads in the workspace.
   */
  initialize(): void {
    if (!this.isInitialized()) {
      execSync('bd init', this.execOptions);
    }
  }

  /**
   * Create a new task.
   * Returns the task ID.
   */
  createTask(options: CreateTaskOptions): string {
    const args = [
      `--title="${options.title}"`,
      `--type=${options.type || 'task'}`,
      `--priority=${options.priority ?? 2}`,
    ];

    if (options.description) {
      args.push(`--description="${options.description}"`);
    }

    const output = execSync(`bd create ${args.join(' ')}`, this.execOptions) as string;

    // Extract task ID from output - format is "Created issue: <prefix>-<hash>"
    // The prefix varies by project (e.g., beads-test-xxx, coven-e2e-xxx-yyy)
    const match = output.match(/Created issue: ([a-zA-Z0-9]+-[a-zA-Z0-9-]+)/);
    if (!match) {
      throw new Error(`Could not parse task ID from: ${output}`);
    }

    return match[1];
  }

  /**
   * Get a task by ID.
   */
  getTask(taskId: string): BeadsTask | null {
    try {
      const output = execSync(`bd show ${taskId} --json`, this.execOptions) as string;
      return JSON.parse(output);
    } catch {
      return null;
    }
  }

  /**
   * List all tasks.
   */
  listTasks(status?: string): BeadsTask[] {
    try {
      const args = status ? `--status=${status}` : '';
      const output = execSync(`bd list ${args} --json`, this.execOptions) as string;
      const result = JSON.parse(output);
      return result.issues || [];
    } catch {
      return [];
    }
  }

  /**
   * Close a task.
   */
  closeTask(taskId: string, reason?: string): void {
    const args = reason ? `--reason="${reason}"` : '';
    execSync(`bd close ${taskId} ${args}`, this.execOptions);
  }

  /**
   * Update task status.
   */
  updateTaskStatus(taskId: string, status: string): void {
    execSync(`bd update ${taskId} --status=${status}`, this.execOptions);
  }

  /**
   * Sync beads with git.
   */
  sync(): void {
    execSync('bd sync', this.execOptions);
  }

  /**
   * Get ready tasks (tasks that can be started).
   */
  getReadyTasks(): BeadsTask[] {
    try {
      const output = execSync('bd ready --json', this.execOptions) as string;
      const result = JSON.parse(output);
      return result.issues || [];
    } catch {
      return [];
    }
  }

  /**
   * Clean up test tasks (close all tasks with test prefix).
   */
  cleanupTestTasks(prefix: string = 'E2E Test'): void {
    const tasks = this.listTasks('open');
    for (const task of tasks) {
      if (task.title.startsWith(prefix)) {
        try {
          this.closeTask(task.id, 'E2E test cleanup');
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
}

/**
 * Check if beads CLI is available.
 */
export function isBeadsAvailable(): boolean {
  try {
    execSync('bd --version', { encoding: 'utf-8', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
