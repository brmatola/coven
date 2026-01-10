import { EventEmitter } from 'events';
import { Task, TaskSource, TaskStatus, TaskPriority } from '../shared/types';
import { BeadsClient, BeadData, BeadsClientError } from './BeadsClient';
import { DaemonClient } from '../daemon/client';
import { SSEClient, SSEEvent } from '../daemon/sse';
import { DaemonTask, DaemonClientError } from '../daemon/types';
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
  taskId: string;
  status?: string;
  error?: string;
}

/**
 * TaskSource implementation for Beads.
 * Uses DaemonClient for reading tasks and SSE for real-time updates.
 * Uses BeadsClient (CLI) for write operations until daemon exposes those endpoints.
 */
export class BeadsTaskSource extends EventEmitter implements TaskSource {
  readonly id = 'beads';
  readonly name = 'Beads Tasks';

  private beadsClient: BeadsClient;
  private daemonClient: DaemonClient | null = null;
  private sseClient: SSEClient | null = null;
  private config: Required<BeadsTaskSourceConfig>;
  private logger = getLogger();
  private workspaceRoot: string;
  private watchInterval: ReturnType<typeof setInterval> | null = null;
  private cachedTasks: Map<string, Task> = new Map();
  private beadMetadata: Map<string, BeadData> = new Map();
  private eventHandler: ((event: SSEEvent) => void) | null = null;
  private useDaemon = false;

  constructor(workspaceRoot: string, config: BeadsTaskSourceConfig = {}) {
    super();
    this.workspaceRoot = workspaceRoot;
    this.beadsClient = new BeadsClient(workspaceRoot);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set daemon clients for real-time updates.
   * When set, the task source will use daemon for fetching and SSE for watching.
   */
  setDaemonClients(daemonClient: DaemonClient, sseClient: SSEClient): void {
    this.daemonClient = daemonClient;
    this.sseClient = sseClient;
    this.useDaemon = true;
  }

  /**
   * Check if Beads is available and initialized.
   */
  async isAvailable(): Promise<boolean> {
    const cliAvailable = await this.beadsClient.isAvailable();
    if (!cliAvailable) {
      return false;
    }
    return this.beadsClient.isInitialized();
  }

  /**
   * Fetch all ready tasks.
   * Uses daemon if available, falls back to CLI.
   */
  async fetchTasks(): Promise<Task[]> {
    try {
      let tasks: Task[];

      if (this.useDaemon && this.daemonClient) {
        // Use daemon API
        const daemonTasks = await this.daemonClient.getTasks();
        tasks = daemonTasks.map((dt) => this.daemonTaskToTask(dt));
      } else {
        // Fall back to CLI
        const beads = await this.beadsClient.listReady();
        tasks = beads.map((bead) => this.beadToTask(bead));
      }

      // Update cache
      this.cachedTasks.clear();
      for (const task of tasks) {
        this.cachedTasks.set(task.id, task);
      }

      return tasks;
    } catch (err) {
      this.logger.error('Failed to fetch tasks', { error: String(err) });
      if (err instanceof BeadsClientError || err instanceof DaemonClientError) {
        this.emit('error', { source: 'beads', error: err.message });
      }
      throw err;
    }
  }

  /**
   * Sync tasks, detecting changes.
   * Returns added, updated, and removed tasks.
   */
  async sync(): Promise<{
    added: Task[];
    updated: Task[];
    removed: string[];
  }> {
    const previousIds = new Set(this.cachedTasks.keys());
    let tasks: Task[];

    if (this.useDaemon && this.daemonClient) {
      const daemonTasks = await this.daemonClient.getTasks();
      tasks = daemonTasks.map((dt) => this.daemonTaskToTask(dt));
    } else {
      const beads = await this.beadsClient.listReady();
      tasks = beads.map((bead) => this.beadToTask(bead));
    }

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
        this.beadMetadata.delete(id);
      }
    }

    if (added.length > 0 || updated.length > 0 || removed.length > 0) {
      this.emit('sync', { added, updated, removed });
    }

    return { added, updated, removed };
  }

  /**
   * Start watching for changes.
   * Uses SSE events if daemon is available, falls back to polling.
   */
  watch(): void {
    if (this.watchInterval || this.eventHandler) {
      return; // Already watching
    }

    // Use SSE events if daemon is available
    if (this.useDaemon && this.sseClient) {
      this.subscribeToSSEEvents();
      this.logger.info('Started Beads watch via SSE');
    }

    // Polling fallback (catches changes SSE might miss or when daemon unavailable)
    this.watchInterval = setInterval(() => {
      void this.sync().catch((err) => {
        this.logger.warn('Beads sync failed', { error: String(err) });
      });
    }, this.config.syncIntervalMs);

    this.logger.info('Started Beads watch', { intervalMs: this.config.syncIntervalMs });
  }

  /**
   * Stop watching for changes.
   */
  stopWatch(): void {
    if (this.eventHandler && this.sseClient) {
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
    if (!this.sseClient) return;

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
    // Refresh the task from daemon
    void this.refreshTask(data.taskId).catch((err) => {
      this.logger.warn('Failed to refresh task after SSE event', {
        taskId: data.taskId,
        error: String(err),
      });
    });
  }

  /**
   * Refresh a single task from the daemon.
   */
  private async refreshTask(taskId: string): Promise<void> {
    if (!this.useDaemon || !this.daemonClient) {
      await this.sync();
      return;
    }

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
        this.beadMetadata.delete(taskId);
        if (existed) {
          this.emit('sync', { added: [], updated: [], removed: [taskId] });
        }
      } else {
        throw err;
      }
    }
  }

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

    // Fetch the created task
    const bead = await this.beadsClient.getTask(result.id);
    if (!bead) {
      return null;
    }

    const task = this.beadToTask(bead);
    this.cachedTasks.set(task.id, task);
    this.beadMetadata.set(task.id, bead);

    return task;
  }

  /**
   * Get a cached task by ID.
   */
  getTask(id: string): Task | undefined {
    return this.cachedTasks.get(id);
  }

  /**
   * Fetch a single task directly.
   */
  async fetchTask(id: string): Promise<Task | null> {
    try {
      if (this.useDaemon && this.daemonClient) {
        const daemonTask = await this.daemonClient.getTask(id);
        const task = this.daemonTaskToTask(daemonTask);
        this.cachedTasks.set(task.id, task);
        return task;
      } else {
        const bead = await this.beadsClient.getTask(id);
        if (!bead) return null;
        const task = this.beadToTask(bead);
        this.cachedTasks.set(task.id, task);
        return task;
      }
    } catch (err) {
      this.logger.error('Failed to fetch task', { id, error: String(err) });
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
        .sort((a, b) => a.createdAt - b.createdAt);

      if (tasksAtPriority.length > 0) {
        return tasksAtPriority[0];
      }
    }

    return undefined;
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
    const metadataToRemove = this.beadMetadata.get(taskId);

    // Optimistically remove from cache
    if (taskToRemove) {
      this.cachedTasks.delete(taskId);
      this.beadMetadata.delete(taskId);
      this.emit('sync', { added: [], updated: [], removed: [taskId] });
    }

    this.beadsClient.closeTask(taskId, reason).then((result) => {
      if (!result.success) {
        this.logger.error('Failed to close task in Beads', { taskId, error: result.error });
        // Restore on failure
        if (taskToRemove) {
          this.cachedTasks.set(taskId, taskToRemove);
          if (metadataToRemove) {
            this.beadMetadata.set(taskId, metadataToRemove);
          }
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
        if (metadataToRemove) {
          this.beadMetadata.set(taskId, metadataToRemove);
        }
        this.emit('sync', { added: [taskToRemove], updated: [], removed: [] });
      }
      this.emit('error', { source: 'beads', error: `Failed to close task: ${String(err)}` });
    });

    return Promise.resolve(true);
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.stopWatch();
    this.cachedTasks.clear();
    this.beadMetadata.clear();
    this.removeAllListeners();
  }

  // ============================================================================
  // Conversion Methods
  // ============================================================================

  /**
   * Convert a daemon task to a Coven Task.
   */
  private daemonTaskToTask(dt: DaemonTask): Task {
    return {
      id: dt.id,
      title: dt.title,
      description: dt.description,
      status: this.daemonStatusToCovenStatus(dt.status, dt.dependencies.length > 0),
      priority: this.daemonPriorityToCovenPriority(dt.priority),
      dependencies: dt.dependencies,
      sourceId: this.id,
      externalId: dt.id,
      createdAt: dt.createdAt,
      updatedAt: dt.updatedAt,
    };
  }

  /**
   * Convert a Beads bead to a Coven Task.
   */
  private beadToTask(bead: BeadData): Task {
    this.beadMetadata.set(bead.id, bead);

    const { description, acceptanceCriteria } = this.parseDescription(bead.description ?? '');
    const dependencies = bead.dependencies
      ?.filter((d) => d.dependency_type === 'blocked-by' && d.status !== 'closed')
      .map((d) => d.id) ?? [];

    const task: Task = {
      id: bead.id,
      title: bead.title,
      description,
      status: this.beadStatusToCovenStatus(bead.status, dependencies.length > 0),
      priority: this.beadPriorityToCovenPriority(bead.priority),
      dependencies,
      sourceId: this.id,
      externalId: bead.id,
      createdAt: new Date(bead.created_at).getTime(),
      updatedAt: new Date(bead.updated_at).getTime(),
    };

    if (acceptanceCriteria !== undefined) {
      task.acceptanceCriteria = acceptanceCriteria;
    }

    return task;
  }

  /**
   * Parse description to extract acceptance criteria.
   */
  private parseDescription(rawDescription: string): {
    description: string;
    acceptanceCriteria?: string;
  } {
    const patterns = [
      /^##\s*Acceptance\s*Criteria\s*$/im,
      /^##\s*AC\s*$/im,
      /^Acceptance\s*Criteria:\s*$/im,
    ];

    for (const pattern of patterns) {
      const match = rawDescription.match(pattern);
      if (match && match.index !== undefined) {
        const description = rawDescription.slice(0, match.index).trim();
        const acceptanceCriteria = rawDescription.slice(match.index + match[0].length).trim();
        return { description, acceptanceCriteria };
      }
    }

    return { description: rawDescription };
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
      case 'pending':
      case 'ready':
        return 'ready';
      case 'running':
        return 'working';
      case 'complete':
        return 'done';
      case 'failed':
        return 'blocked';
      case 'blocked':
        return 'blocked';
      default:
        return 'ready';
    }
  }

  /**
   * Map Beads status to Coven TaskStatus.
   */
  private beadStatusToCovenStatus(beadStatus: string, hasBlockers: boolean): TaskStatus {
    if (hasBlockers) {
      return 'blocked';
    }

    switch (beadStatus) {
      case 'open':
        return 'ready';
      case 'in_progress':
        return 'working';
      case 'closed':
        return 'done';
      default:
        return 'ready';
    }
  }

  /**
   * Map Coven TaskStatus to Beads status.
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
   * Map Beads priority (0-4) to Coven TaskPriority.
   */
  private beadPriorityToCovenPriority(priority: number): TaskPriority {
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
