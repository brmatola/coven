import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import {
  Task,
  TaskStatus,
  TaskPriority,
  isValidTaskTransition,
  SessionEvents,
} from '../shared/types';

/**
 * Manages the lifecycle and state of tasks.
 * Provides CRUD operations, status transitions, dependency tracking, and persistence.
 */
export class TaskManager extends EventEmitter {
  private tasks: Map<string, Task> = new Map();
  private covenDir: string;
  private tasksFilePath: string;

  constructor(workspaceRoot: string) {
    super();
    this.covenDir = path.join(workspaceRoot, '.coven');
    this.tasksFilePath = path.join(this.covenDir, 'tasks.json');
  }

  /**
   * Initialize the TaskManager, loading persisted tasks if they exist.
   */
  async initialize(): Promise<void> {
    await this.ensureCovenDir();
    await this.loadTasks();
  }

  /**
   * Create a new task.
   */
  createTask(params: {
    title: string;
    description: string;
    priority?: TaskPriority;
    dependencies?: string[];
    acceptanceCriteria?: string;
    sourceId: string;
    externalId?: string;
  }): Task {
    const id = this.generateTaskId();
    const now = Date.now();

    const task: Task = {
      id,
      title: params.title,
      description: params.description,
      status: this.calculateInitialStatus(params.dependencies || []),
      priority: params.priority || 'medium',
      dependencies: params.dependencies || [],
      sourceId: params.sourceId,
      createdAt: now,
      updatedAt: now,
      ...(params.acceptanceCriteria !== undefined && { acceptanceCriteria: params.acceptanceCriteria }),
      ...(params.externalId !== undefined && { externalId: params.externalId }),
    };

    this.tasks.set(id, task);
    this.emit('task:created', { task } satisfies SessionEvents['task:created']);
    this.persistTasks();

    return task;
  }

  /**
   * Get a task by ID.
   */
  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  /**
   * Get all tasks.
   */
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Update a task's details (not status - use transitionStatus for that).
   */
  updateTask(
    id: string,
    updates: Partial<Pick<Task, 'title' | 'description' | 'priority' | 'acceptanceCriteria'>>
  ): Task {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    const updatedTask: Task = {
      ...task,
      ...updates,
      updatedAt: Date.now(),
    };

    this.tasks.set(id, updatedTask);
    this.emit('task:updated', { task: updatedTask } satisfies SessionEvents['task:updated']);
    this.persistTasks();

    return updatedTask;
  }

  /**
   * Delete a task (only allowed for ready or blocked tasks).
   */
  deleteTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    if (task.status === 'working' || task.status === 'review') {
      throw new Error(`Cannot delete task in '${task.status}' status`);
    }

    this.tasks.delete(id);
    this.emit('task:deleted', { taskId: id } satisfies SessionEvents['task:deleted']);
    this.persistTasks();

    // Check if any blocked tasks can now be unblocked
    this.checkUnblockedTasks();
  }

  /**
   * Transition a task to a new status.
   */
  transitionStatus(id: string, newStatus: TaskStatus): Task {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    if (!isValidTaskTransition(task.status, newStatus)) {
      throw new Error(`Invalid transition from '${task.status}' to '${newStatus}'`);
    }

    const previousStatus = task.status;
    const updatedTask: Task = {
      ...task,
      status: newStatus,
      updatedAt: Date.now(),
    };

    this.tasks.set(id, updatedTask);
    this.emit('task:updated', {
      task: updatedTask,
      previousStatus,
    } satisfies SessionEvents['task:updated']);
    this.persistTasks();

    // If task completed, check for unblocked tasks
    if (newStatus === 'done') {
      this.checkUnblockedTasks();
    }

    return updatedTask;
  }

  /**
   * Add a dependency between tasks.
   */
  addDependency(taskId: string, dependsOnId: string): void {
    const task = this.tasks.get(taskId);
    const dependsOn = this.tasks.get(dependsOnId);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (!dependsOn) {
      throw new Error(`Dependency task not found: ${dependsOnId}`);
    }

    if (task.dependencies.includes(dependsOnId)) {
      return; // Already a dependency
    }

    // Check for circular dependency
    if (this.wouldCreateCycle(taskId, dependsOnId)) {
      throw new Error('Adding this dependency would create a cycle');
    }

    const updatedTask: Task = {
      ...task,
      dependencies: [...task.dependencies, dependsOnId],
      updatedAt: Date.now(),
    };

    // If the dependency isn't done, block the task
    if (dependsOn.status !== 'done' && updatedTask.status === 'ready') {
      updatedTask.status = 'blocked';
    }

    this.tasks.set(taskId, updatedTask);
    this.emit('task:updated', { task: updatedTask } satisfies SessionEvents['task:updated']);
    this.persistTasks();
  }

  /**
   * Remove a dependency between tasks.
   */
  removeDependency(taskId: string, dependsOnId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const updatedTask: Task = {
      ...task,
      dependencies: task.dependencies.filter((d) => d !== dependsOnId),
      updatedAt: Date.now(),
    };

    this.tasks.set(taskId, updatedTask);
    this.emit('task:updated', { task: updatedTask } satisfies SessionEvents['task:updated']);
    this.persistTasks();

    // Check if task can be unblocked
    this.checkUnblockedTasks();
  }

  /**
   * Get tasks filtered by status.
   */
  getTasksByStatus(status: TaskStatus): Task[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === status);
  }

  /**
   * Get tasks filtered by source.
   */
  getTasksBySource(sourceId: string): Task[] {
    return Array.from(this.tasks.values()).filter((t) => t.sourceId === sourceId);
  }

  /**
   * Get the next task to work on (highest priority ready task).
   */
  getNextTask(): Task | undefined {
    const priorityOrder: TaskPriority[] = ['critical', 'high', 'medium', 'low'];
    const readyTasks = this.getTasksByStatus('ready');

    for (const priority of priorityOrder) {
      const tasksAtPriority = readyTasks
        .filter((t) => t.priority === priority)
        .sort((a, b) => a.createdAt - b.createdAt);

      if (tasksAtPriority.length > 0) {
        return tasksAtPriority[0];
      }
    }

    return undefined;
  }

  /**
   * Get tasks grouped by status.
   */
  getTasksGroupedByStatus(): Record<TaskStatus, Task[]> {
    return {
      ready: this.getTasksByStatus('ready'),
      working: this.getTasksByStatus('working'),
      review: this.getTasksByStatus('review'),
      done: this.getTasksByStatus('done'),
      blocked: this.getTasksByStatus('blocked'),
    };
  }

  /**
   * Clear all tasks.
   */
  clear(): void {
    this.tasks.clear();
    this.persistTasks();
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

  private generateTaskId(): string {
    return `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private calculateInitialStatus(dependencies: string[]): TaskStatus {
    if (dependencies.length === 0) {
      return 'ready';
    }

    // Check if all dependencies are done
    const allDone = dependencies.every((depId) => {
      const dep = this.tasks.get(depId);
      return dep && dep.status === 'done';
    });

    return allDone ? 'ready' : 'blocked';
  }

  private checkUnblockedTasks(): void {
    const blockedTasks = this.getTasksByStatus('blocked');

    for (const task of blockedTasks) {
      const allDepsComplete = task.dependencies.every((depId) => {
        const dep = this.tasks.get(depId);
        return dep && dep.status === 'done';
      });

      if (allDepsComplete) {
        const updatedTask: Task = {
          ...task,
          status: 'ready',
          updatedAt: Date.now(),
        };
        this.tasks.set(task.id, updatedTask);
        this.emit('task:unblocked', { task: updatedTask } satisfies SessionEvents['task:unblocked']);
      }
    }

    this.persistTasks();
  }

  private wouldCreateCycle(taskId: string, dependsOnId: string): boolean {
    // Check if dependsOnId transitively depends on taskId
    const visited = new Set<string>();
    const queue = [dependsOnId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (currentId === taskId) {
        return true;
      }
      if (visited.has(currentId)) {
        continue;
      }
      visited.add(currentId);

      const current = this.tasks.get(currentId);
      if (current) {
        queue.push(...current.dependencies);
      }
    }

    return false;
  }

  private async ensureCovenDir(): Promise<void> {
    try {
      await fs.promises.mkdir(this.covenDir, { recursive: true });
    } catch {
      // Directory might already exist, which is fine
    }
  }

  private async loadTasks(): Promise<void> {
    try {
      const data = await fs.promises.readFile(this.tasksFilePath, 'utf-8');
      const tasksArray = JSON.parse(data) as Task[];
      this.tasks.clear();
      for (const task of tasksArray) {
        this.tasks.set(task.id, task);
      }
    } catch {
      // File doesn't exist or is invalid, start with empty tasks
      this.tasks.clear();
    }
  }

  private persistTasks(): void {
    const tasksArray = Array.from(this.tasks.values());
    try {
      fs.writeFileSync(this.tasksFilePath, JSON.stringify(tasksArray, null, 2));
    } catch (error) {
      this.emit('error', error);
    }
  }
}
