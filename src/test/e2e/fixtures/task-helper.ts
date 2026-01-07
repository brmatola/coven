import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Options for creating a test task.
 */
export interface CreateTaskOptions {
  description?: string;
  priority?: number;
  type?: 'task' | 'bug' | 'epic' | 'story';
  labels?: string[];
}

/**
 * Basic task data from Beads.
 */
export interface TaskData {
  id: string;
  title: string;
  status: string;
  priority: number;
  description?: string;
}

/**
 * Helper for managing Beads tasks in E2E tests.
 * Tracks created tasks for automatic cleanup.
 */
export class TaskHelper {
  private workspacePath: string;
  private createdTaskIds: string[] = [];
  private beadsAvailable: boolean | null = null;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /**
   * Check if Beads CLI is available.
   * Caches result for performance.
   */
  async isBeadsAvailable(): Promise<boolean> {
    if (this.beadsAvailable !== null) {
      return this.beadsAvailable;
    }

    try {
      await execAsync('bd --version', { timeout: 5000 });
      // Also check if initialized in workspace
      await execAsync('bd list --limit 1', { cwd: this.workspacePath, timeout: 5000 });
      this.beadsAvailable = true;
    } catch {
      this.beadsAvailable = false;
    }

    return this.beadsAvailable;
  }

  /**
   * Create a task in Beads and track for cleanup.
   * Returns the task ID or null if Beads unavailable.
   */
  async createTask(title: string, options: CreateTaskOptions = {}): Promise<string | null> {
    if (!(await this.isBeadsAvailable())) {
      return null;
    }

    try {
      let cmd = `bd create "${title}" --json`;

      if (options.description) {
        cmd += ` --description "${options.description}"`;
      }
      if (options.priority !== undefined) {
        cmd += ` --priority ${options.priority}`;
      }
      if (options.type) {
        cmd += ` --type ${options.type}`;
      }
      if (options.labels?.length) {
        cmd += ` --labels "${options.labels.join(',')}"`;
      }

      const { stdout } = await execAsync(cmd, { cwd: this.workspacePath });
      const result = JSON.parse(stdout) as { id?: string };
      const taskId = result.id;

      if (taskId) {
        this.createdTaskIds.push(taskId);
        return taskId;
      }

      return null;
    } catch {
      // Failed to create task
      return null;
    }
  }

  /**
   * Get a task by ID.
   * Returns null if task doesn't exist or Beads unavailable.
   */
  async getTask(taskId: string): Promise<TaskData | null> {
    if (!(await this.isBeadsAvailable())) {
      return null;
    }

    try {
      const { stdout } = await execAsync(`bd show ${taskId} --json`, {
        cwd: this.workspacePath,
      });
      const result = JSON.parse(stdout) as TaskData[] | TaskData;

      // bd show returns an array
      if (Array.isArray(result) && result.length > 0) {
        return result[0];
      }
      if (!Array.isArray(result) && result.id) {
        return result;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * List all tasks in the workspace.
   */
  async listTasks(): Promise<TaskData[]> {
    if (!(await this.isBeadsAvailable())) {
      return [];
    }

    try {
      const { stdout } = await execAsync('bd list --json', { cwd: this.workspacePath });
      const tasks = JSON.parse(stdout) as TaskData[];
      return Array.isArray(tasks) ? tasks : [];
    } catch {
      return [];
    }
  }

  /**
   * Update a task's status.
   */
  async updateTaskStatus(taskId: string, status: string): Promise<boolean> {
    if (!(await this.isBeadsAvailable())) {
      return false;
    }

    try {
      await execAsync(`bd update ${taskId} --status ${status}`, {
        cwd: this.workspacePath,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Close a task.
   */
  async closeTask(taskId: string, reason?: string): Promise<boolean> {
    if (!(await this.isBeadsAvailable())) {
      return false;
    }

    try {
      let cmd = `bd close ${taskId}`;
      if (reason) {
        cmd += ` --reason "${reason}"`;
      }
      await execAsync(cmd, { cwd: this.workspacePath });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a task.
   */
  async deleteTask(taskId: string): Promise<boolean> {
    if (!(await this.isBeadsAvailable())) {
      return false;
    }

    try {
      await execAsync(`bd delete ${taskId} --yes`, { cwd: this.workspacePath });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up all tasks created by this helper.
   * Call this in test teardown.
   */
  async cleanup(): Promise<void> {
    if (!(await this.isBeadsAvailable())) {
      this.createdTaskIds = [];
      return;
    }

    for (const taskId of this.createdTaskIds) {
      try {
        await execAsync(`bd delete ${taskId} --yes`, { cwd: this.workspacePath });
      } catch {
        // Ignore errors - task may already be deleted
      }
    }

    this.createdTaskIds = [];
  }

  /**
   * Get the list of task IDs created by this helper.
   */
  getCreatedTaskIds(): string[] {
    return [...this.createdTaskIds];
  }

  /**
   * Reset Beads availability cache (useful if workspace changes).
   */
  resetCache(): void {
    this.beadsAvailable = null;
  }
}

/**
 * Create a TaskHelper for the given workspace.
 */
export function createTaskHelper(workspacePath: string): TaskHelper {
  return new TaskHelper(workspacePath);
}
