import { EventEmitter } from 'events';
import { Task, TaskSource, TaskStatus, TaskPriority } from '../shared/types';
import { BeadsClient } from './BeadsClient';
import { DaemonClient } from '../daemon/client';
import { SSEClient, TaskStatus as DaemonTaskStatus } from '@coven/client-ts';
import type { SSEEvent, Task as DaemonTask } from '@coven/client-ts';
import { DaemonClientError } from '../daemon/types';
import { getLogger } from '../shared/logger';

/**
 * Configuration for BeadsTaskSource.
 */
export interface BeadsTaskSourceConfig {
  /** Polling interval for sync in milliseconds (default: 30000) */
  syncIntervalMs?: number;
  /** Whether to auto-start watching on initialize */
  autoWatch?: boolean;
}

const DEFAULT_CONFIG: Required<BeadsTaskSourceConfig> = {
  syncIntervalMs: 30000,
  autoWatch: true,
};

/**
 * SSE event data for task updates
 */
interface TaskEventData {
  task_id: string;
  status?: string;
  error?: string;
}

/**
 * TaskSource implementation for Beads - Thin Client.
 *
 * REQUIRES daemon for all read operations (fetching tasks, watching).
 * Uses BeadsClient (CLI) for write operations until daemon exposes those endpoints.
 */
export class BeadsTaskSource extends EventEmitter implements TaskSource {
  readonly id = 'beads';
  readonly name = 'Beads Tasks';

  private readonly daemonClient: DaemonClient;
  private readonly sseClient: SSEClient;
  private readonly beadsClient: BeadsClient;
  private readonly config: Required<BeadsTaskSourceConfig>;
  private readonly logger = getLogger();
  private watchInterval: ReturnType<typeof setInterval> | null = null;
  private cachedTasks: Map<string, Task> = new Map();
  private eventHandler: ((event: SSEEvent) => void) | null = null;

  /**
   * Create a new BeadsTaskSource.
   * @param daemonClient Required daemon client for task operations
   * @param sseClient Required SSE client for real-time updates
   * @param workspaceRoot Workspace root for CLI write operations
   * @param config Optional configuration
   */
  constructor(
    daemonClient: DaemonClient,
    sseClient: SSEClient,
    workspaceRoot: string,
    config: BeadsTaskSourceConfig = {}
  ) {
    super();
    this.daemonClient = daemonClient;
    this.sseClient = sseClient;
    this.beadsClient = new BeadsClient(workspaceRoot);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if daemon is available.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.daemonClient.getHealth();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetch all tasks from daemon.
   */
  async fetchTasks(): Promise<Task[]> {
    try {
      const daemonTasks = await this.daemonClient.getTasks();
      const tasks = daemonTasks.map((dt) => this.daemonTaskToTask(dt));

      // Update cache
      this.cachedTasks.clear();
      for (const task of tasks) {
        this.cachedTasks.set(task.id, task);
      }

      return tasks;
    } catch (err) {
      this.logger.error('Failed to fetch tasks from daemon', { error: String(err) });
      if (err instanceof DaemonClientError) {
        this.emit('error', { source: 'daemon', error: err.message });
      }
      throw err;
    }
  }

  /**
   * Sync tasks from daemon, detecting changes.
   */
  async sync(): Promise<{
    added: Task[];
    updated: Task[];
    removed: string[];
  }> {
    const previousIds = new Set(this.cachedTasks.keys());
    const daemonTasks = await this.daemonClient.getTasks();
    const tasks = daemonTasks.map((dt) => this.daemonTaskToTask(dt));

    const added: Task[] = [];
    const updated: Task[] = [];
    const currentIds = new Set<string>();

    for (const task of tasks) {
      currentIds.add(task.id);

      const existing = this.cachedTasks.get(task.id);
      if (!existing) {
        added.push(task);
      } else if (this.hasTaskChanged(existing, task)) {
        updated.push(task);
      }

      this.cachedTasks.set(task.id, task);
    }

    // Find removed tasks
    const removed: string[] = [];
    for (const id of previousIds) {
      if (!currentIds.has(id)) {
        removed.push(id);
        this.cachedTasks.delete(id);
      }
    }

    if (added.length > 0 || updated.length > 0 || removed.length > 0) {
      this.emit('sync', { added, updated, removed });
    }

    return { added, updated, removed };
  }

  /**
   * Start watching for changes via SSE events.
   */
  watch(): void {
    if (this.watchInterval || this.eventHandler) {
      return; // Already watching
    }

    // Subscribe to SSE events
    this.subscribeToSSEEvents();
    this.logger.info('Started Beads watch via SSE');

    // Polling as backup (catches any missed SSE events)
    this.watchInterval = setInterval(() => {
      void this.sync().catch((err) => {
        this.logger.warn('Beads sync failed', { error: String(err) });
      });
    }, this.config.syncIntervalMs);
  }

  /**
   * Stop watching for changes.
   */
  stopWatch(): void {
    if (this.eventHandler) {
      this.sseClient.off('event', this.eventHandler);
      this.eventHandler = null;
    }
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
    this.logger.info('Stopped Beads watch');
  }

  /**
   * Subscribe to SSE events for real-time task updates.
   */
  private subscribeToSSEEvents(): void {
    this.eventHandler = (event: SSEEvent) => {
      switch (event.type) {
        case 'task.created':
        case 'task.updated':
        case 'task.started':
        case 'task.completed':
        case 'task.failed':
          this.handleTaskEvent(event.data as TaskEventData);
          break;
      }
    };

    this.sseClient.on('event', this.eventHandler);
  }

  /**
   * Handle SSE task events by refreshing the affected task.
   */
  private handleTaskEvent(data: TaskEventData): void {
    void this.refreshTask(data.task_id).catch((err) => {
      this.logger.warn('Failed to refresh task after SSE event', {
        taskId: data.task_id,
        error: String(err),
      });
    });
  }

  /**
   * Refresh a single task from the daemon.
   */
  private async refreshTask(taskId: string): Promise<void> {
    try {
      const daemonTask = await this.daemonClient.getTask(taskId);
      const task = this.daemonTaskToTask(daemonTask);
      const existing = this.cachedTasks.get(taskId);

      if (!existing) {
        this.cachedTasks.set(taskId, task);
        this.emit('sync', { added: [task], updated: [], removed: [] });
      } else if (this.hasTaskChanged(existing, task)) {
        this.cachedTasks.set(taskId, task);
        this.emit('sync', { added: [], updated: [task], removed: [] });
      }
    } catch (err) {
      // Task might have been removed
      if (err instanceof DaemonClientError && err.code === 'task_not_found') {
        const existed = this.cachedTasks.has(taskId);
        this.cachedTasks.delete(taskId);
        if (existed) {
          this.emit('sync', { added: [], updated: [], removed: [taskId] });
        }
      } else {
        throw err;
      }
    }
  }

  // ============================================================================
  // Write Operations (via CLI until daemon supports them)
  // ============================================================================

  /**
   * Called when a task's status changes in Coven.
   * Syncs the status back to Beads via CLI.
   */
  async onTaskStatusChanged(taskId: string, status: TaskStatus): Promise<void> {
    const beadStatus = this.covenStatusToBeadStatus(status);
    if (!beadStatus) {
      return;
    }

    const result = await this.beadsClient.updateStatus(taskId, beadStatus);
    if (!result.success) {
      this.logger.error('Failed to sync status to Beads', {
        taskId,
        status,
        error: result.error,
      });
      this.emit('error', { source: 'beads', error: `Failed to update status: ${result.error}` });
    } else {
      this.logger.info('Synced status to Beads', { taskId, status, beadStatus });
    }
  }

  /**
   * Create a new task in Beads via CLI.
   */
  async createTask(title: string, description?: string): Promise<Task | null> {
    const options: { title: string; description?: string; type: 'task'; priority: number } = {
      title,
      type: 'task',
      priority: 2,
    };
    if (description !== undefined) {
      options.description = description;
    }
    const result = await this.beadsClient.createTask(options);

    if (!result.success || !result.id) {
      this.logger.error('Failed to create task in Beads', { title, error: result.error });
      return null;
    }

    // Refresh from daemon to get the task
    try {
      const daemonTask = await this.daemonClient.getTask(result.id);
      const task = this.daemonTaskToTask(daemonTask);
      this.cachedTasks.set(task.id, task);
      return task;
    } catch {
      // Daemon might not have synced yet, trigger a full sync
      await this.sync();
      return this.cachedTasks.get(result.id) ?? null;
    }
  }

  /**
   * Update a task's status in Beads via CLI.
   */
  async updateTaskStatus(taskId: string, status: TaskStatus): Promise<Task | null> {
    const beadStatus = this.covenStatusToBeadStatus(status);
    if (!beadStatus) {
      this.logger.warn('No Beads status mapping for', { status });
      return null;
    }

    const result = await this.beadsClient.updateStatus(taskId, beadStatus);
    if (!result.success) {
      this.logger.error('Failed to update task status in Beads', {
        taskId,
        status,
        error: result.error,
      });
      this.emit('error', { source: 'beads', error: `Failed to update status: ${result.error}` });
      return null;
    }

    // Optimistically update cache
    const existingTask = this.cachedTasks.get(taskId);
    if (existingTask) {
      const updatedTask: Task = { ...existingTask, status, updatedAt: Date.now() };
      this.cachedTasks.set(taskId, updatedTask);
      this.emit('sync', { added: [], updated: [updatedTask], removed: [] });
    }

    // Background sync
    void this.sync().catch((err) => {
      this.logger.warn('Background sync after status update failed', { error: String(err) });
    });

    return this.cachedTasks.get(taskId) ?? null;
  }

  /**
   * Update a task's title, description, and/or acceptance criteria via CLI.
   */
  async updateTask(
    taskId: string,
    updates: { title?: string; description?: string; acceptanceCriteria?: string }
  ): Promise<boolean> {
    let fullDescription: string | undefined;
    if (updates.description !== undefined || updates.acceptanceCriteria !== undefined) {
      const existingTask = this.cachedTasks.get(taskId);
      const desc = updates.description ?? existingTask?.description ?? '';
      const ac = updates.acceptanceCriteria ?? existingTask?.acceptanceCriteria;

      fullDescription = desc;
      if (ac && ac.trim()) {
        fullDescription = `${desc}\n\n## Acceptance Criteria\n${ac}`;
      }
    }

    const result = await this.beadsClient.updateTask(taskId, {
      title: updates.title,
      description: fullDescription,
    });

    if (!result.success) {
      this.logger.error('Failed to update task in Beads', {
        taskId,
        error: result.error,
      });
      this.emit('error', { source: 'beads', error: `Failed to update task: ${result.error}` });
      return false;
    }

    await this.sync();
    return true;
  }

  /**
   * Close a task in Beads (mark as done) via CLI.
   */
  closeTask(taskId: string, reason?: string): Promise<boolean> {
    const taskToRemove = this.cachedTasks.get(taskId);

    // Optimistically remove from cache
    if (taskToRemove) {
      this.cachedTasks.delete(taskId);
      this.emit('sync', { added: [], updated: [], removed: [taskId] });
    }

    this.beadsClient.closeTask(taskId, reason).then((result) => {
      if (!result.success) {
        this.logger.error('Failed to close task in Beads', { taskId, error: result.error });
        // Restore on failure
        if (taskToRemove) {
          this.cachedTasks.set(taskId, taskToRemove);
          this.emit('sync', { added: [taskToRemove], updated: [], removed: [] });
        }
        this.emit('error', { source: 'beads', error: `Failed to close task: ${result.error}` });
      } else {
        void this.sync().catch((err) => {
          this.logger.warn('Background sync after close failed', { error: String(err) });
        });
      }
    }).catch((err) => {
      this.logger.error('Failed to close task in Beads', { taskId, error: String(err) });
      if (taskToRemove) {
        this.cachedTasks.set(taskId, taskToRemove);
        this.emit('sync', { added: [taskToRemove], updated: [], removed: [] });
      }
      this.emit('error', { source: 'beads', error: `Failed to close task: ${String(err)}` });
    });

    return Promise.resolve(true);
  }

  // ============================================================================
  // Read Operations (from cache)
  // ============================================================================

  /**
   * Get a cached task by ID.
   */
  getTask(id: string): Task | undefined {
    return this.cachedTasks.get(id);
  }

  /**
   * Fetch a single task directly from daemon.
   */
  async fetchTask(id: string): Promise<Task | null> {
    try {
      const daemonTask = await this.daemonClient.getTask(id);
      const task = this.daemonTaskToTask(daemonTask);
      this.cachedTasks.set(task.id, task);
      return task;
    } catch (err) {
      this.logger.error('Failed to fetch task from daemon', { id, error: String(err) });
      return null;
    }
  }

  /**
   * Get all cached tasks.
   */
  getTasks(): Task[] {
    return Array.from(this.cachedTasks.values());
  }

  /**
   * Get tasks filtered by status.
   */
  getTasksByStatus(status: TaskStatus): Task[] {
    return this.getTasks().filter((t) => t.status === status);
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
   * Get the next task to work on (highest priority ready task).
   */
  getNextTask(): Task | undefined {
    const priorityOrder: TaskPriority[] = ['critical', 'high', 'medium', 'low'];
    const readyTasks = this.getTasksByStatus('ready');

    for (const priority of priorityOrder) {
      const tasksAtPriority = readyTasks
        .filter((t) => t.priority === priority)
        .sort((a, b) => a.created_at - b.created_at);

      if (tasksAtPriority.length > 0) {
        return tasksAtPriority[0];
      }
    }

    return undefined;
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.stopWatch();
    this.cachedTasks.clear();
    this.removeAllListeners();
  }

  // ============================================================================
  // Conversion Methods
  // ============================================================================

  /**
   * Convert a daemon task to a Coven Task.
   */
  private daemonTaskToTask(dt: DaemonTask): Task {
    const hasDeps = (dt.depends_on?.length ?? 0) > 0;
    return {
      id: dt.id,
      title: dt.title,
      description: dt.description ?? '',
      status: this.daemonStatusToCovenStatus(dt.status, hasDeps),
      priority: this.daemonPriorityToCovenPriority(dt.priority),
      dependencies: dt.depends_on ?? [],
      sourceId: this.id,
      externalId: dt.id,
      createdAt: dt.created_at ? new Date(dt.created_at).getTime() : Date.now(),
      updatedAt: dt.updated_at ? new Date(dt.updated_at).getTime() : Date.now(),
    };
  }

  /**
   * Map daemon status to Coven TaskStatus.
   */
  private daemonStatusToCovenStatus(
    daemonStatus: DaemonTask['status'],
    hasBlockers: boolean
  ): TaskStatus {
    if (hasBlockers) {
      return 'blocked';
    }

    switch (daemonStatus) {
      case DaemonTaskStatus.OPEN:
        return 'ready';
      case DaemonTaskStatus.IN_PROGRESS:
        return 'working';
      case DaemonTaskStatus.CLOSED:
        return 'done';
      case DaemonTaskStatus.BLOCKED:
        return 'blocked';
      case DaemonTaskStatus.PENDING_MERGE:
        return 'review';
      default:
        return 'ready';
    }
  }

  /**
   * Map Coven TaskStatus to Beads status (for CLI writes).
   */
  private covenStatusToBeadStatus(
    status: TaskStatus
  ): 'open' | 'in_progress' | 'closed' | null {
    switch (status) {
      case 'ready':
      case 'blocked':
        return 'open';
      case 'working':
        return 'in_progress';
      case 'done':
        return 'closed';
      case 'review':
        return 'in_progress';
      default:
        return null;
    }
  }

  /**
   * Map daemon priority (0-4) to Coven TaskPriority.
   */
  private daemonPriorityToCovenPriority(priority: number): TaskPriority {
    switch (priority) {
      case 0:
      case 1:
        return 'critical';
      case 2:
        return 'high';
      case 3:
        return 'medium';
      case 4:
      default:
        return 'low';
    }
  }

  /**
   * Check if a task has changed.
   */
  private hasTaskChanged(oldTask: Task, newTask: Task): boolean {
    return (
      oldTask.title !== newTask.title ||
      oldTask.description !== newTask.description ||
      oldTask.status !== newTask.status ||
      oldTask.priority !== newTask.priority ||
      JSON.stringify(oldTask.dependencies) !== JSON.stringify(newTask.dependencies)
    );
  }
}
