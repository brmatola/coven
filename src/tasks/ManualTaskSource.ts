import { Task, TaskSource, TaskStatus, TaskPriority } from '../shared/types';
import { TaskManager } from './TaskManager';

/**
 * Input for creating a manual task.
 */
export interface ManualTaskInput {
  title: string;
  description: string;
  priority?: TaskPriority;
  acceptanceCriteria?: string;
}

/**
 * A task source that allows manual task creation via UI.
 * Tasks are stored in the TaskManager with sourceId 'manual'.
 */
export class ManualTaskSource implements TaskSource {
  readonly id = 'manual';
  readonly name = 'Manual Tasks';
  private taskManager: TaskManager;

  constructor(taskManager: TaskManager) {
    this.taskManager = taskManager;
  }

  /**
   * Fetch all manual tasks from the TaskManager.
   */
  fetchTasks(): Promise<Task[]> {
    return Promise.resolve(this.taskManager.getTasksBySource(this.id));
  }

  /**
   * Create a new manual task.
   */
  createTask(input: ManualTaskInput): Task {
    return this.taskManager.createTask({
      title: input.title,
      description: input.description,
      priority: input.priority,
      acceptanceCriteria: input.acceptanceCriteria,
      sourceId: this.id,
    });
  }

  /**
   * Update an existing manual task.
   */
  updateTask(
    taskId: string,
    updates: Partial<Pick<Task, 'title' | 'description' | 'priority' | 'acceptanceCriteria'>>
  ): Task {
    const task = this.taskManager.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.sourceId !== this.id) {
      throw new Error(`Task ${taskId} is not a manual task`);
    }
    return this.taskManager.updateTask(taskId, updates);
  }

  /**
   * Delete a manual task.
   */
  deleteTask(taskId: string): void {
    const task = this.taskManager.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.sourceId !== this.id) {
      throw new Error(`Task ${taskId} is not a manual task`);
    }
    this.taskManager.deleteTask(taskId);
  }

  /**
   * Called when a task's status changes.
   * Manual tasks don't need external sync.
   */
  async onTaskStatusChanged(_taskId: string, _status: TaskStatus): Promise<void> {
    // No-op for manual tasks - status is already handled by TaskManager
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    // No resources to dispose
  }
}
