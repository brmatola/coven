import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { Task, TaskSource, TaskStatus, TaskPriority } from '../shared/types';
import { BeadsClient, BeadData, BeadsClientError } from './BeadsClient';
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
 * TaskSource implementation for Beads.
 * Beads is the single source of truth - this class provides:
 * - Read: Fetch and cache tasks from Beads
 * - Write: Mutations go through Beads CLI directly
 * - Watch: Periodic polling to keep cache in sync
 */
export class BeadsTaskSource extends EventEmitter implements TaskSource {
  readonly id = 'beads';
  readonly name = 'Beads Tasks';

  private client: BeadsClient;
  private config: Required<BeadsTaskSourceConfig>;
  private logger = getLogger();
  private workspaceRoot: string;
  private watchInterval: ReturnType<typeof setInterval> | null = null;
  private fileWatcher: fs.FSWatcher | null = null;
  private syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private cachedTasks: Map<string, Task> = new Map();
  private beadMetadata: Map<string, BeadData> = new Map(); // Preserve for round-trip

  constructor(workspaceRoot: string, config: BeadsTaskSourceConfig = {}) {
    super();
    this.workspaceRoot = workspaceRoot;
    this.client = new BeadsClient(workspaceRoot);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if Beads is available and initialized.
   */
  async isAvailable(): Promise<boolean> {
    const cliAvailable = await this.client.isAvailable();
    if (!cliAvailable) {
      return false;
    }
    return this.client.isInitialized();
  }

  /**
   * Fetch all ready tasks from Beads.
   */
  async fetchTasks(): Promise<Task[]> {
    try {
      const beads = await this.client.listReady();
      const tasks = beads.map((bead) => this.beadToTask(bead));

      // Update cache
      this.cachedTasks.clear();
      for (const task of tasks) {
        this.cachedTasks.set(task.id, task);
      }

      return tasks;
    } catch (err) {
      this.logger.error('Failed to fetch tasks from Beads', { error: String(err) });
      if (err instanceof BeadsClientError) {
        this.emit('error', { source: 'beads', error: err.message });
      }
      throw err;
    }
  }

  /**
   * Sync tasks from Beads, detecting changes.
   * Returns added, updated, and removed tasks.
   */
  async sync(): Promise<{
    added: Task[];
    updated: Task[];
    removed: string[];
  }> {
    const previousIds = new Set(this.cachedTasks.keys());
    const beads = await this.client.listReady();

    const added: Task[] = [];
    const updated: Task[] = [];
    const currentIds = new Set<string>();

    for (const bead of beads) {
      const task = this.beadToTask(bead);
      currentIds.add(task.id);

      const existing = this.cachedTasks.get(task.id);
      if (!existing) {
        added.push(task);
      } else if (this.hasTaskChanged(existing, task)) {
        updated.push(task);
      }

      this.cachedTasks.set(task.id, task);
      this.beadMetadata.set(task.id, bead);
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
   * Start watching for changes via file watching and polling fallback.
   */
  watch(): void {
    if (this.watchInterval || this.fileWatcher) {
      return; // Already watching
    }

    // Watch .beads directory for changes (primary - fast)
    const beadsDir = path.join(this.workspaceRoot, '.beads');
    try {
      this.fileWatcher = fs.watch(beadsDir, { persistent: false }, (eventType, filename) => {
        // Debounce rapid changes (e.g., multiple file writes)
        if (this.syncDebounceTimer) {
          clearTimeout(this.syncDebounceTimer);
        }
        this.syncDebounceTimer = setTimeout(() => {
          this.syncDebounceTimer = null;
          this.logger.debug('Beads file change detected', { eventType, filename });
          void this.sync().catch((err) => {
            this.logger.warn('Beads sync failed after file change', { error: String(err) });
          });
        }, 300); // 300ms debounce
      });
      this.logger.info('Started Beads file watcher', { path: beadsDir });
    } catch (err) {
      this.logger.warn('Failed to start file watcher, falling back to polling only', {
        error: String(err),
      });
    }

    // Polling fallback (slower - catches changes file watcher might miss)
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
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer);
      this.syncDebounceTimer = null;
    }
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
    this.logger.info('Stopped Beads watch');
  }

  /**
   * Called when a task's status changes in Coven.
   * Syncs the status back to Beads.
   */
  async onTaskStatusChanged(taskId: string, status: TaskStatus): Promise<void> {
    // Map Coven status to Beads status
    const beadStatus = this.covenStatusToBeadStatus(status);
    if (!beadStatus) {
      return; // No corresponding Beads status
    }

    const result = await this.client.updateStatus(taskId, beadStatus);
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
   * Create a new task in Beads.
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
    const result = await this.client.createTask(options);

    if (!result.success || !result.id) {
      this.logger.error('Failed to create task in Beads', { title, error: result.error });
      return null;
    }

    // Fetch the created task to get full data
    const bead = await this.client.getTask(result.id);
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
   * Update a task's status in Beads.
   * Returns the updated task from cache after refresh.
   */
  async updateTaskStatus(taskId: string, status: TaskStatus): Promise<Task | null> {
    const beadStatus = this.covenStatusToBeadStatus(status);
    if (!beadStatus) {
      this.logger.warn('No Beads status mapping for', { status });
      return null;
    }

    const result = await this.client.updateStatus(taskId, beadStatus);
    if (!result.success) {
      this.logger.error('Failed to update task status in Beads', {
        taskId,
        status,
        error: result.error,
      });
      this.emit('error', { source: 'beads', error: `Failed to update status: ${result.error}` });
      return null;
    }

    // Optimistically update cache immediately for instant UI feedback
    const existingTask = this.cachedTasks.get(taskId);
    if (existingTask) {
      const updatedTask: Task = { ...existingTask, status, updatedAt: Date.now() };
      this.cachedTasks.set(taskId, updatedTask);
      this.emit('sync', { added: [], updated: [updatedTask], removed: [] });
    }

    // Background sync to ensure consistency (don't await)
    void this.sync().catch((err) => {
      this.logger.warn('Background sync after status update failed', { error: String(err) });
    });

    return this.cachedTasks.get(taskId) ?? null;
  }

  /**
   * Update a task's title, description, and/or acceptance criteria.
   * Acceptance criteria is appended to the description for Beads storage.
   */
  async updateTask(
    taskId: string,
    updates: { title?: string; description?: string; acceptanceCriteria?: string }
  ): Promise<boolean> {
    // Build the full description with acceptance criteria
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

    const result = await this.client.updateTask(taskId, {
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

    // Refresh cache
    await this.sync();
    return true;
  }

  /**
   * Close a task in Beads (mark as done).
   * Uses optimistic updates for instant UI feedback.
   */
  closeTask(taskId: string, reason?: string): Promise<boolean> {
    // Store task data in case we need to restore on failure
    const taskToRemove = this.cachedTasks.get(taskId);
    const metadataToRemove = this.beadMetadata.get(taskId);

    // Optimistically remove from cache immediately for instant UI feedback
    if (taskToRemove) {
      this.cachedTasks.delete(taskId);
      this.beadMetadata.delete(taskId);
      this.emit('sync', { added: [], updated: [], removed: [taskId] });
    }

    // Run CLI command in background
    this.client.closeTask(taskId, reason).then((result) => {
      if (!result.success) {
        this.logger.error('Failed to close task in Beads', { taskId, error: result.error });
        // Restore task to cache on failure
        if (taskToRemove) {
          this.cachedTasks.set(taskId, taskToRemove);
          if (metadataToRemove) {
            this.beadMetadata.set(taskId, metadataToRemove);
          }
          this.emit('sync', { added: [taskToRemove], updated: [], removed: [] });
        }
        this.emit('error', { source: 'beads', error: `Failed to close task: ${result.error}` });
      } else {
        // Sync to ensure consistency
        void this.sync().catch((err) => {
          this.logger.warn('Background sync after close failed', { error: String(err) });
        });
      }
    }).catch((err) => {
      this.logger.error('Failed to close task in Beads', { taskId, error: String(err) });
      // Restore task to cache on error
      if (taskToRemove) {
        this.cachedTasks.set(taskId, taskToRemove);
        if (metadataToRemove) {
          this.beadMetadata.set(taskId, metadataToRemove);
        }
        this.emit('sync', { added: [taskToRemove], updated: [], removed: [] });
      }
      this.emit('error', { source: 'beads', error: `Failed to close task: ${String(err)}` });
    });

    // Return immediately - UI updates are optimistic
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

  /**
   * Convert a Beads bead to a Coven Task.
   */
  private beadToTask(bead: BeadData): Task {
    // Store metadata for round-trip
    this.beadMetadata.set(bead.id, bead);

    // Extract acceptance criteria from description if present
    const { description, acceptanceCriteria } = this.parseDescription(bead.description ?? '');

    // Map blockers to dependencies
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
   * Looks for "## Acceptance Criteria" or similar patterns.
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
        // Review doesn't map directly to Beads, keep as in_progress
        return 'in_progress';
      default:
        return null;
    }
  }

  /**
   * Map Beads priority (1-4) to Coven TaskPriority.
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
