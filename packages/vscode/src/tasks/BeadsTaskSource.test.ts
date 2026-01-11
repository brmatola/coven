import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BeadsTaskSource } from './BeadsTaskSource';
import { BeadsClient } from './BeadsClient';
import { DaemonClient } from '../daemon/client';
import { DaemonClientError } from '../daemon/types';
import type { Task, SSEClient } from '@coven/client-ts';
import { TaskStatus, Task as TaskClass } from '@coven/client-ts';

vi.mock('./BeadsClient');
vi.mock('../daemon/client');

const MockBeadsClient = BeadsClient as unknown as ReturnType<typeof vi.fn>;
const MockDaemonClient = DaemonClient as unknown as ReturnType<typeof vi.fn>;

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'test-abc',
    title: 'Test Task',
    description: 'Test description',
    status: TaskStatus.OPEN,
    priority: 2,
    depends_on: [],
    type: TaskClass.type.TASK,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('BeadsTaskSource (Thin Client)', () => {
  let source: BeadsTaskSource;
  let mockDaemonClient: {
    getHealth: ReturnType<typeof vi.fn>;
    getTasks: ReturnType<typeof vi.fn>;
    getTask: ReturnType<typeof vi.fn>;
  };
  let mockSSEClient: {
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
  };
  let mockBeadsClient: {
    updateStatus: ReturnType<typeof vi.fn>;
    createTask: ReturnType<typeof vi.fn>;
    updateTask: ReturnType<typeof vi.fn>;
    closeTask: ReturnType<typeof vi.fn>;
  };
  let sseEventHandler: ((event: { type: string; data: unknown }) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDaemonClient = {
      getHealth: vi.fn().mockResolvedValue({ status: 'healthy' }),
      getTasks: vi.fn().mockResolvedValue([]),
      getTask: vi.fn().mockResolvedValue(null),
    };

    mockSSEClient = {
      on: vi.fn().mockImplementation((event: string, handler: typeof sseEventHandler) => {
        if (event === 'event') {
          sseEventHandler = handler;
        }
      }),
      off: vi.fn().mockImplementation((event: string, handler: typeof sseEventHandler) => {
        if (event === 'event' && sseEventHandler === handler) {
          sseEventHandler = null;
        }
      }),
    };

    mockBeadsClient = {
      updateStatus: vi.fn().mockResolvedValue({ success: true }),
      createTask: vi.fn().mockResolvedValue({ success: true, id: 'new-id' }),
      updateTask: vi.fn().mockResolvedValue({ success: true }),
      closeTask: vi.fn().mockResolvedValue({ success: true }),
    };

    MockDaemonClient.mockImplementation(() => mockDaemonClient);
    MockBeadsClient.mockImplementation(() => mockBeadsClient);

    source = new BeadsTaskSource(
      mockDaemonClient as unknown as DaemonClient,
      mockSSEClient as unknown as SSEClient,
      '/mock/workspace',
      { autoWatch: false }
    );
  });

  afterEach(() => {
    source.dispose();
    sseEventHandler = null;
  });

  describe('isAvailable', () => {
    it('returns true when daemon is healthy', async () => {
      mockDaemonClient.getHealth.mockResolvedValue({ status: 'healthy' });
      const result = await source.isAvailable();
      expect(result).toBe(true);
    });

    it('returns false when daemon is not available', async () => {
      mockDaemonClient.getHealth.mockRejectedValue(new Error('Connection refused'));
      const result = await source.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('fetchTasks', () => {
    it('returns empty array when no tasks', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([]);
      const tasks = await source.fetchTasks();
      expect(tasks).toEqual([]);
    });

    it('converts daemon tasks to Coven tasks', async () => {
      const daemonTasks = [
        createMockTask({ id: 'task-1', title: 'Task 1' }),
        createMockTask({ id: 'task-2', title: 'Task 2' }),
      ];
      mockDaemonClient.getTasks.mockResolvedValue(daemonTasks);

      const tasks = await source.fetchTasks();

      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe('task-1');
      expect(tasks[0].title).toBe('Task 1');
      expect(tasks[0].sourceId).toBe('beads');
    });

    it('maps daemon status correctly', async () => {
      const daemonTasks = [
        createMockTask({ id: 'task-1', status: TaskStatus.OPEN }),
        createMockTask({ id: 'task-2', status: TaskStatus.IN_PROGRESS }),
        createMockTask({ id: 'task-3', status: TaskStatus.CLOSED }),
        createMockTask({ id: 'task-4', status: TaskStatus.BLOCKED }),
        createMockTask({ id: 'task-5', status: TaskStatus.PENDING_MERGE }),
      ];
      mockDaemonClient.getTasks.mockResolvedValue(daemonTasks);

      const tasks = await source.fetchTasks();

      expect(tasks[0].status).toBe('ready');
      expect(tasks[1].status).toBe('working');
      expect(tasks[2].status).toBe('done');
      expect(tasks[3].status).toBe('blocked');
      expect(tasks[4].status).toBe('review');
    });

    it('maps daemon priority correctly', async () => {
      const daemonTasks = [
        createMockTask({ id: 'task-0', priority: 0 }),
        createMockTask({ id: 'task-1', priority: 1 }),
        createMockTask({ id: 'task-2', priority: 2 }),
        createMockTask({ id: 'task-3', priority: 3 }),
        createMockTask({ id: 'task-4', priority: 4 }),
      ];
      mockDaemonClient.getTasks.mockResolvedValue(daemonTasks);

      const tasks = await source.fetchTasks();

      expect(tasks[0].priority).toBe('critical');
      expect(tasks[1].priority).toBe('critical');
      expect(tasks[2].priority).toBe('high');
      expect(tasks[3].priority).toBe('medium');
      expect(tasks[4].priority).toBe('low');
    });

    it('marks tasks with dependencies as blocked', async () => {
      const daemonTasks = [
        createMockTask({
          id: 'task-1',
          status: TaskStatus.OPEN,
          depends_on: ['dep-1', 'dep-2'],
        }),
      ];
      mockDaemonClient.getTasks.mockResolvedValue(daemonTasks);

      const tasks = await source.fetchTasks();

      expect(tasks[0].status).toBe('blocked');
      expect(tasks[0].dependencies).toEqual(['dep-1', 'dep-2']);
    });

    it('throws and emits error on daemon failure', async () => {
      const error = new DaemonClientError('connection_refused', 'Daemon not available');
      mockDaemonClient.getTasks.mockRejectedValue(error);

      const errorHandler = vi.fn();
      source.on('error', errorHandler);

      await expect(source.fetchTasks()).rejects.toThrow();
      expect(errorHandler).toHaveBeenCalledWith({
        source: 'daemon',
        error: 'Daemon not available',
      });
    });
  });

  describe('sync', () => {
    it('detects added tasks', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([]);
      await source.fetchTasks();

      mockDaemonClient.getTasks.mockResolvedValue([createMockTask({ id: 'new-task' })]);
      const result = await source.sync();

      expect(result.added).toHaveLength(1);
      expect(result.added[0].id).toBe('new-task');
    });

    it('detects removed tasks', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([createMockTask({ id: 'old-task' })]);
      await source.fetchTasks();

      mockDaemonClient.getTasks.mockResolvedValue([]);
      const result = await source.sync();

      expect(result.removed).toEqual(['old-task']);
    });

    it('detects updated tasks', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([
        createMockTask({ id: 'task-1', title: 'Old Title' }),
      ]);
      await source.fetchTasks();

      mockDaemonClient.getTasks.mockResolvedValue([
        createMockTask({ id: 'task-1', title: 'New Title' }),
      ]);
      const result = await source.sync();

      expect(result.updated).toHaveLength(1);
      expect(result.updated[0].title).toBe('New Title');
    });

    it('emits sync event on changes', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([]);
      await source.fetchTasks();

      const syncHandler = vi.fn();
      source.on('sync', syncHandler);

      mockDaemonClient.getTasks.mockResolvedValue([createMockTask({ id: 'new-task' })]);
      await source.sync();

      expect(syncHandler).toHaveBeenCalledWith({
        added: [expect.objectContaining({ id: 'new-task' })],
        updated: [],
        removed: [],
      });
    });
  });

  describe('watch', () => {
    it('subscribes to SSE events', () => {
      source.watch();
      expect(mockSSEClient.on).toHaveBeenCalledWith('event', expect.any(Function));
    });

    it('handles task.created events', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([]);
      await source.fetchTasks();

      source.watch();

      mockDaemonClient.getTask.mockResolvedValue(createMockTask({ id: 'new-task' }));

      const syncHandler = vi.fn();
      source.on('sync', syncHandler);

      sseEventHandler?.({ type: 'task.created', data: { task_id: 'new-task' } });

      await vi.waitFor(() => {
        expect(mockDaemonClient.getTask).toHaveBeenCalledWith('new-task');
      });

      source.stopWatch();
    });

    it('handles task.updated events', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([createMockTask({ id: 'task-1' })]);
      await source.fetchTasks();

      source.watch();

      mockDaemonClient.getTask.mockResolvedValue(
        createMockTask({ id: 'task-1', title: 'Updated Title' })
      );

      const syncHandler = vi.fn();
      source.on('sync', syncHandler);

      sseEventHandler?.({ type: 'task.updated', data: { task_id: 'task-1' } });

      await vi.waitFor(() => {
        expect(syncHandler).toHaveBeenCalledWith({
          added: [],
          updated: [expect.objectContaining({ id: 'task-1', title: 'Updated Title' })],
          removed: [],
        });
      });

      source.stopWatch();
    });

    it('handles task removal when task not found', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([createMockTask({ id: 'task-1' })]);
      await source.fetchTasks();
      expect(source.getTask('task-1')).toBeDefined();

      source.watch();

      const error = new DaemonClientError('task_not_found', 'Task not found');
      mockDaemonClient.getTask.mockRejectedValue(error);

      const syncHandler = vi.fn();
      source.on('sync', syncHandler);

      sseEventHandler?.({ type: 'task.failed', data: { task_id: 'task-1' } });

      await vi.waitFor(() => {
        expect(source.getTask('task-1')).toBeUndefined();
      });

      expect(syncHandler).toHaveBeenCalledWith({
        added: [],
        updated: [],
        removed: ['task-1'],
      });

      source.stopWatch();
    });

    it('unsubscribes from SSE on stopWatch', () => {
      source.watch();
      source.stopWatch();
      expect(mockSSEClient.off).toHaveBeenCalledWith('event', expect.any(Function));
    });
  });

  describe('fetchTask', () => {
    it('fetches single task from daemon', async () => {
      mockDaemonClient.getTask.mockResolvedValue(
        createMockTask({ id: 'task-1', title: 'Single Task' })
      );

      const task = await source.fetchTask('task-1');

      expect(task).toBeDefined();
      expect(task?.id).toBe('task-1');
      expect(task?.title).toBe('Single Task');
      expect(mockDaemonClient.getTask).toHaveBeenCalledWith('task-1');
    });

    it('caches fetched task', async () => {
      mockDaemonClient.getTask.mockResolvedValue(createMockTask({ id: 'task-1' }));

      await source.fetchTask('task-1');

      const cached = source.getTask('task-1');
      expect(cached).toBeDefined();
    });

    it('returns null on error', async () => {
      mockDaemonClient.getTask.mockRejectedValue(new Error('Network error'));

      const task = await source.fetchTask('task-1');

      expect(task).toBeNull();
    });
  });

  describe('cache operations', () => {
    it('getTask returns cached task', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([createMockTask({ id: 'task-1' })]);
      await source.fetchTasks();

      const task = source.getTask('task-1');
      expect(task).toBeDefined();
      expect(task?.id).toBe('task-1');
    });

    it('getTask returns undefined for unknown task', () => {
      const task = source.getTask('unknown');
      expect(task).toBeUndefined();
    });

    it('getTasks returns all cached tasks', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([
        createMockTask({ id: 'task-1' }),
        createMockTask({ id: 'task-2' }),
      ]);
      await source.fetchTasks();

      const tasks = source.getTasks();
      expect(tasks).toHaveLength(2);
    });

    it('getTasksByStatus filters correctly', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([
        createMockTask({ id: 'task-1', status: TaskStatus.OPEN }),
        createMockTask({ id: 'task-2', status: TaskStatus.IN_PROGRESS }),
        createMockTask({ id: 'task-3', status: TaskStatus.OPEN }),
      ]);
      await source.fetchTasks();

      const readyTasks = source.getTasksByStatus('ready');
      expect(readyTasks).toHaveLength(2);

      const workingTasks = source.getTasksByStatus('working');
      expect(workingTasks).toHaveLength(1);
    });

    it('getTasksGroupedByStatus groups correctly', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([
        createMockTask({ id: 'task-1', status: TaskStatus.OPEN }),
        createMockTask({ id: 'task-2', status: TaskStatus.IN_PROGRESS }),
        createMockTask({ id: 'task-3', status: TaskStatus.CLOSED }),
      ]);
      await source.fetchTasks();

      const grouped = source.getTasksGroupedByStatus();
      expect(grouped.ready).toHaveLength(1);
      expect(grouped.working).toHaveLength(1);
      expect(grouped.done).toHaveLength(1);
    });

    it('getNextTask returns highest priority ready task', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([
        createMockTask({ id: 'task-1', status: TaskStatus.OPEN, priority: 3 }),
        createMockTask({ id: 'task-2', status: TaskStatus.OPEN, priority: 1 }),
        createMockTask({ id: 'task-3', status: TaskStatus.OPEN, priority: 2 }),
      ]);
      await source.fetchTasks();

      const next = source.getNextTask();
      expect(next?.id).toBe('task-2'); // priority 1 = critical
    });

    it('getNextTask returns undefined when no ready tasks', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([
        createMockTask({ id: 'task-1', status: TaskStatus.IN_PROGRESS }),
      ]);
      await source.fetchTasks();

      const next = source.getNextTask();
      expect(next).toBeUndefined();
    });
  });

  describe('write operations (via CLI)', () => {
    it('updateTaskStatus calls BeadsClient', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([createMockTask({ id: 'task-1' })]);
      await source.fetchTasks();

      await source.updateTaskStatus('task-1', 'working');

      expect(mockBeadsClient.updateStatus).toHaveBeenCalledWith('task-1', 'in_progress');
    });

    it('updateTaskStatus updates cache optimistically', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([
        createMockTask({ id: 'task-1', status: TaskStatus.OPEN }),
      ]);
      await source.fetchTasks();

      await source.updateTaskStatus('task-1', 'working');

      const task = source.getTask('task-1');
      expect(task?.status).toBe('working');
    });

    it('createTask calls BeadsClient and syncs from daemon', async () => {
      mockDaemonClient.getTask.mockResolvedValue(
        createMockTask({ id: 'new-id', title: 'New Task' })
      );

      const task = await source.createTask('New Task', 'Description');

      expect(mockBeadsClient.createTask).toHaveBeenCalled();
      expect(task?.title).toBe('New Task');
    });

    it('closeTask removes from cache and calls BeadsClient', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([createMockTask({ id: 'task-1' })]);
      await source.fetchTasks();

      await source.closeTask('task-1');

      expect(source.getTask('task-1')).toBeUndefined();
      expect(mockBeadsClient.closeTask).toHaveBeenCalledWith('task-1', undefined);
    });
  });

  describe('dispose', () => {
    it('clears cache and stops watch', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([createMockTask({ id: 'task-1' })]);
      await source.fetchTasks();
      source.watch();

      source.dispose();

      expect(source.getTasks()).toHaveLength(0);
      expect(mockSSEClient.off).toHaveBeenCalled();
    });
  });
});
