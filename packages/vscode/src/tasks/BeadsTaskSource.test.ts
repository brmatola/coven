import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BeadsTaskSource } from './BeadsTaskSource';
import { BeadsClient, BeadData } from './BeadsClient';
import { DaemonClient } from '../daemon/client';
import { SSEClient } from '../daemon/sse';
import { DaemonTask, DaemonClientError } from '../daemon/types';

vi.mock('./BeadsClient');
vi.mock('../daemon/client');
vi.mock('../daemon/sse');

const MockBeadsClient = BeadsClient as unknown as ReturnType<typeof vi.fn>;
const MockDaemonClient = DaemonClient as unknown as ReturnType<typeof vi.fn>;
const MockSSEClient = SSEClient as unknown as ReturnType<typeof vi.fn>;

function createMockBead(overrides: Partial<BeadData> = {}): BeadData {
  return {
    id: 'test-abc',
    title: 'Test Task',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: '2026-01-06T12:00:00Z',
    created_by: 'testuser',
    updated_at: '2026-01-06T12:00:00Z',
    ...overrides,
  };
}

function createMockDaemonTask(overrides: Partial<DaemonTask> = {}): DaemonTask {
  return {
    id: 'test-abc',
    title: 'Test Task',
    description: 'Test description',
    status: 'ready',
    priority: 2,
    dependencies: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('BeadsTaskSource', () => {
  let source: BeadsTaskSource;
  let mockClient: {
    isAvailable: ReturnType<typeof vi.fn>;
    isInitialized: ReturnType<typeof vi.fn>;
    listReady: ReturnType<typeof vi.fn>;
    getTask: ReturnType<typeof vi.fn>;
    createTask: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockClient = {
      isAvailable: vi.fn().mockResolvedValue(true),
      isInitialized: vi.fn().mockResolvedValue(true),
      listReady: vi.fn().mockResolvedValue([]),
      getTask: vi.fn().mockResolvedValue(null),
      createTask: vi.fn().mockResolvedValue({ success: true, id: 'new-id' }),
      updateStatus: vi.fn().mockResolvedValue({ success: true }),
    };

    MockBeadsClient.mockImplementation(() => mockClient);
    source = new BeadsTaskSource('/mock/workspace', { autoWatch: false });
  });

  afterEach(() => {
    source.dispose();
    vi.useRealTimers();
  });

  describe('id and name', () => {
    it('has correct id', () => {
      expect(source.id).toBe('beads');
    });

    it('has correct name', () => {
      expect(source.name).toBe('Beads Tasks');
    });
  });

  describe('isAvailable', () => {
    it('returns true when client is available and initialized', async () => {
      const result = await source.isAvailable();
      expect(result).toBe(true);
    });

    it('returns false when CLI is not available', async () => {
      mockClient.isAvailable.mockResolvedValue(false);
      const result = await source.isAvailable();
      expect(result).toBe(false);
    });

    it('returns false when not initialized', async () => {
      mockClient.isInitialized.mockResolvedValue(false);
      const result = await source.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('fetchTasks', () => {
    it('returns empty array when no tasks', async () => {
      mockClient.listReady.mockResolvedValue([]);
      const tasks = await source.fetchTasks();
      expect(tasks).toEqual([]);
    });

    it('converts beads to tasks', async () => {
      const beads = [
        createMockBead({ id: 'task-1', title: 'Task 1' }),
        createMockBead({ id: 'task-2', title: 'Task 2' }),
      ];
      mockClient.listReady.mockResolvedValue(beads);

      const tasks = await source.fetchTasks();

      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe('task-1');
      expect(tasks[0].title).toBe('Task 1');
      expect(tasks[0].sourceId).toBe('beads');
    });

    it('maps status correctly', async () => {
      const beads = [
        createMockBead({ id: 'task-1', status: 'open' }),
        createMockBead({ id: 'task-2', status: 'in_progress' }),
      ];
      mockClient.listReady.mockResolvedValue(beads);

      const tasks = await source.fetchTasks();

      expect(tasks[0].status).toBe('ready');
      expect(tasks[1].status).toBe('working');
    });

    it('maps priority correctly', async () => {
      const beads = [
        createMockBead({ id: 'task-1', priority: 1 }),
        createMockBead({ id: 'task-2', priority: 2 }),
        createMockBead({ id: 'task-3', priority: 3 }),
        createMockBead({ id: 'task-4', priority: 4 }),
      ];
      mockClient.listReady.mockResolvedValue(beads);

      const tasks = await source.fetchTasks();

      expect(tasks[0].priority).toBe('critical');
      expect(tasks[1].priority).toBe('high');
      expect(tasks[2].priority).toBe('medium');
      expect(tasks[3].priority).toBe('low');
    });

    it('extracts dependencies from blockers', async () => {
      const bead = createMockBead({
        id: 'task-1',
        dependencies: [
          { id: 'blocker-1', title: 'B1', status: 'open', dependency_type: 'blocked-by' },
          { id: 'blocker-2', title: 'B2', status: 'closed', dependency_type: 'blocked-by' },
        ],
      });
      mockClient.listReady.mockResolvedValue([bead]);

      const tasks = await source.fetchTasks();

      expect(tasks[0].dependencies).toEqual(['blocker-1']);
      expect(tasks[0].status).toBe('blocked');
    });
  });

  describe('sync', () => {
    it('detects added tasks', async () => {
      mockClient.listReady.mockResolvedValue([]);
      await source.fetchTasks(); // Initial fetch

      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'new-task' })]);
      const result = await source.sync();

      expect(result.added).toHaveLength(1);
      expect(result.added[0].id).toBe('new-task');
      expect(result.updated).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
    });

    it('detects removed tasks', async () => {
      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'old-task' })]);
      await source.fetchTasks();

      mockClient.listReady.mockResolvedValue([]);
      const result = await source.sync();

      expect(result.removed).toEqual(['old-task']);
      expect(result.added).toHaveLength(0);
    });

    it('detects updated tasks', async () => {
      mockClient.listReady.mockResolvedValue([
        createMockBead({ id: 'task-1', title: 'Original' }),
      ]);
      await source.fetchTasks();

      mockClient.listReady.mockResolvedValue([
        createMockBead({ id: 'task-1', title: 'Updated' }),
      ]);
      const result = await source.sync();

      expect(result.updated).toHaveLength(1);
      expect(result.updated[0].title).toBe('Updated');
    });

    it('emits sync event on changes', async () => {
      const syncHandler = vi.fn();
      source.on('sync', syncHandler);

      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'new-task' })]);
      await source.sync();

      expect(syncHandler).toHaveBeenCalledWith({
        added: expect.any(Array),
        updated: [],
        removed: [],
      });
    });
  });

  describe('watch', () => {
    it('starts polling', async () => {
      mockClient.listReady.mockResolvedValue([]);

      source.watch();

      // Advance time
      await vi.advanceTimersByTimeAsync(30000);

      expect(mockClient.listReady).toHaveBeenCalled();
    });

    it('does not duplicate watchers', () => {
      source.watch();
      source.watch();

      // Should only have one interval
      source.stopWatch();
      // No error means success
    });
  });

  describe('stopWatch', () => {
    it('stops polling', async () => {
      mockClient.listReady.mockResolvedValue([]);
      source.watch();
      source.stopWatch();

      await vi.advanceTimersByTimeAsync(60000);

      // Should not have been called after stop
      expect(mockClient.listReady).not.toHaveBeenCalled();
    });
  });

  describe('onTaskStatusChanged', () => {
    it('syncs ready status to open', async () => {
      await source.onTaskStatusChanged('task-1', 'ready');

      expect(mockClient.updateStatus).toHaveBeenCalledWith('task-1', 'open');
    });

    it('syncs working status to in_progress', async () => {
      await source.onTaskStatusChanged('task-1', 'working');

      expect(mockClient.updateStatus).toHaveBeenCalledWith('task-1', 'in_progress');
    });

    it('syncs done status to closed', async () => {
      await source.onTaskStatusChanged('task-1', 'done');

      expect(mockClient.updateStatus).toHaveBeenCalledWith('task-1', 'closed');
    });

    it('syncs blocked status to open', async () => {
      await source.onTaskStatusChanged('task-1', 'blocked');

      expect(mockClient.updateStatus).toHaveBeenCalledWith('task-1', 'open');
    });

    it('syncs review status to in_progress', async () => {
      await source.onTaskStatusChanged('task-1', 'review');

      expect(mockClient.updateStatus).toHaveBeenCalledWith('task-1', 'in_progress');
    });

    it('emits error on failure', async () => {
      mockClient.updateStatus.mockResolvedValue({ success: false, error: 'Failed' });
      const errorHandler = vi.fn();
      source.on('error', errorHandler);

      await source.onTaskStatusChanged('task-1', 'done');

      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('createTask', () => {
    it('creates task in Beads', async () => {
      const bead = createMockBead({ id: 'new-id', title: 'New Task' });
      mockClient.getTask.mockResolvedValue(bead);

      const task = await source.createTask('New Task', 'Description');

      expect(mockClient.createTask).toHaveBeenCalledWith({
        title: 'New Task',
        description: 'Description',
        type: 'task',
        priority: 2,
      });
      expect(task?.id).toBe('new-id');
    });

    it('returns null on failure', async () => {
      mockClient.createTask.mockResolvedValue({ success: false, error: 'Failed' });

      const task = await source.createTask('New Task');

      expect(task).toBeNull();
    });
  });

  describe('getTask and getTasks', () => {
    it('returns cached task', async () => {
      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'task-1' })]);
      await source.fetchTasks();

      const task = source.getTask('task-1');

      expect(task).toBeDefined();
      expect(task?.id).toBe('task-1');
    });

    it('returns undefined for unknown task', () => {
      const task = source.getTask('unknown');
      expect(task).toBeUndefined();
    });

    it('returns all cached tasks', async () => {
      mockClient.listReady.mockResolvedValue([
        createMockBead({ id: 'task-1' }),
        createMockBead({ id: 'task-2' }),
      ]);
      await source.fetchTasks();

      const tasks = source.getTasks();

      expect(tasks).toHaveLength(2);
    });
  });

  describe('fetchTask', () => {
    it('fetches a single task from Beads and caches it', async () => {
      const mockBead = createMockBead({ id: 'task-1', title: 'Test Task' });
      mockClient.getTask.mockResolvedValue(mockBead);

      const task = await source.fetchTask('task-1');

      expect(task).toBeDefined();
      expect(task?.id).toBe('task-1');
      expect(task?.title).toBe('Test Task');
      expect(mockClient.getTask).toHaveBeenCalledWith('task-1');

      // Should be cached now
      const cachedTask = source.getTask('task-1');
      expect(cachedTask).toBeDefined();
      expect(cachedTask?.id).toBe('task-1');
    });

    it('returns null when task not found', async () => {
      mockClient.getTask.mockResolvedValue(null);

      const task = await source.fetchTask('unknown');

      expect(task).toBeNull();
    });

    it('returns null and logs error on failure', async () => {
      mockClient.getTask.mockRejectedValue(new Error('Network error'));

      const task = await source.fetchTask('task-1');

      expect(task).toBeNull();
    });
  });

  describe('dispose', () => {
    it('clears cache and stops watching', async () => {
      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'task-1' })]);
      await source.fetchTasks();
      source.watch();

      source.dispose();

      expect(source.getTasks()).toHaveLength(0);
    });
  });

  describe('acceptance criteria parsing', () => {
    it('extracts acceptance criteria from description', async () => {
      const bead = createMockBead({
        id: 'task-1',
        description: 'Main description\n\n## Acceptance Criteria\n- Item 1\n- Item 2',
      });
      mockClient.listReady.mockResolvedValue([bead]);

      const tasks = await source.fetchTasks();

      expect(tasks[0].description).toBe('Main description');
      expect(tasks[0].acceptanceCriteria).toBe('- Item 1\n- Item 2');
    });

    it('handles no acceptance criteria', async () => {
      const bead = createMockBead({
        id: 'task-1',
        description: 'Just a description',
      });
      mockClient.listReady.mockResolvedValue([bead]);

      const tasks = await source.fetchTasks();

      expect(tasks[0].description).toBe('Just a description');
      expect(tasks[0].acceptanceCriteria).toBeUndefined();
    });
  });

  describe('closeTask', () => {
    beforeEach(() => {
      // Add closeTask to mock
      (mockClient as ReturnType<typeof vi.fn> & { closeTask: ReturnType<typeof vi.fn> }).closeTask = vi.fn().mockResolvedValue({ success: true });
    });

    it('optimistically removes task from cache', async () => {
      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'task-1' })]);
      await source.fetchTasks();
      expect(source.getTask('task-1')).toBeDefined();

      const syncHandler = vi.fn();
      source.on('sync', syncHandler);

      await source.closeTask('task-1');

      // Task should be removed immediately
      expect(source.getTask('task-1')).toBeUndefined();
      expect(syncHandler).toHaveBeenCalledWith({
        added: [],
        updated: [],
        removed: ['task-1'],
      });
    });

    it('restores task on CLI failure', async () => {
      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'task-1', title: 'Test' })]);
      await source.fetchTasks();

      (mockClient as ReturnType<typeof vi.fn> & { closeTask: ReturnType<typeof vi.fn> }).closeTask = vi.fn().mockResolvedValue({ success: false, error: 'CLI failed' });

      const errorHandler = vi.fn();
      source.on('error', errorHandler);

      await source.closeTask('task-1');

      // Wait for the background promise to resolve
      await vi.runAllTimersAsync();

      // Task should be restored
      expect(source.getTask('task-1')).toBeDefined();
      expect(errorHandler).toHaveBeenCalled();
    });

    it('restores task on CLI error', async () => {
      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'task-1', title: 'Test' })]);
      await source.fetchTasks();

      (mockClient as ReturnType<typeof vi.fn> & { closeTask: ReturnType<typeof vi.fn> }).closeTask = vi.fn().mockRejectedValue(new Error('Network error'));

      const errorHandler = vi.fn();
      source.on('error', errorHandler);

      await source.closeTask('task-1');

      // Wait for the background promise to resolve
      await vi.runAllTimersAsync();

      // Task should be restored
      expect(source.getTask('task-1')).toBeDefined();
      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('updateTaskStatus', () => {
    it('optimistically updates status in cache', async () => {
      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'task-1', status: 'open' })]);
      await source.fetchTasks();
      expect(source.getTask('task-1')?.status).toBe('ready');

      const syncHandler = vi.fn();
      source.on('sync', syncHandler);

      await source.updateTaskStatus('task-1', 'working');

      // Status should be updated immediately
      expect(source.getTask('task-1')?.status).toBe('working');
      expect(syncHandler).toHaveBeenCalledWith({
        added: [],
        updated: [expect.objectContaining({ id: 'task-1', status: 'working' })],
        removed: [],
      });
    });

    it('returns updated task from cache', async () => {
      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'task-1', status: 'open' })]);
      await source.fetchTasks();

      const result = await source.updateTaskStatus('task-1', 'working');

      expect(result).toBeDefined();
      expect(result?.status).toBe('working');
    });

    it('returns null for unknown status mapping', async () => {
      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'task-1' })]);
      await source.fetchTasks();

      // Use type assertion to test invalid status
      const result = await source.updateTaskStatus('task-1', 'invalid' as 'ready');

      expect(result).toBeNull();
    });
  });

  describe('updateTask', () => {
    beforeEach(() => {
      (mockClient as ReturnType<typeof vi.fn> & { updateTask: ReturnType<typeof vi.fn> }).updateTask = vi.fn().mockResolvedValue({ success: true });
    });

    it('updates task title and description', async () => {
      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'task-1' })]);
      await source.fetchTasks();

      const result = await source.updateTask('task-1', {
        title: 'New Title',
        description: 'New Description',
      });

      expect(result).toBe(true);
      expect((mockClient as ReturnType<typeof vi.fn> & { updateTask: ReturnType<typeof vi.fn> }).updateTask).toHaveBeenCalled();
    });

    it('returns false on failure', async () => {
      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'task-1' })]);
      await source.fetchTasks();

      (mockClient as ReturnType<typeof vi.fn> & { updateTask: ReturnType<typeof vi.fn> }).updateTask = vi.fn().mockResolvedValue({ success: false, error: 'Failed' });

      const errorHandler = vi.fn();
      source.on('error', errorHandler);

      const result = await source.updateTask('task-1', { title: 'New' });

      expect(result).toBe(false);
      expect(errorHandler).toHaveBeenCalled();
    });

    it('appends acceptance criteria to description', async () => {
      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'task-1', description: 'Original' })]);
      await source.fetchTasks();

      await source.updateTask('task-1', {
        acceptanceCriteria: '- Test AC',
      });

      expect((mockClient as ReturnType<typeof vi.fn> & { updateTask: ReturnType<typeof vi.fn> }).updateTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          description: expect.stringContaining('## Acceptance Criteria'),
        })
      );
    });
  });

  describe('getTasksByStatus', () => {
    it('filters tasks by status', async () => {
      mockClient.listReady.mockResolvedValue([
        createMockBead({ id: 'task-1', status: 'open' }),
        createMockBead({ id: 'task-2', status: 'in_progress' }),
        createMockBead({ id: 'task-3', status: 'open' }),
      ]);
      await source.fetchTasks();

      const readyTasks = source.getTasksByStatus('ready');
      const workingTasks = source.getTasksByStatus('working');

      expect(readyTasks).toHaveLength(2);
      expect(workingTasks).toHaveLength(1);
    });
  });

  describe('getTasksGroupedByStatus', () => {
    it('groups tasks by status', async () => {
      mockClient.listReady.mockResolvedValue([
        createMockBead({ id: 'task-1', status: 'open' }),
        createMockBead({ id: 'task-2', status: 'in_progress' }),
        createMockBead({ id: 'task-3', status: 'closed' }),
      ]);
      await source.fetchTasks();

      const grouped = source.getTasksGroupedByStatus();

      expect(grouped.ready).toHaveLength(1);
      expect(grouped.working).toHaveLength(1);
      expect(grouped.done).toHaveLength(1);
      expect(grouped.blocked).toHaveLength(0);
      expect(grouped.review).toHaveLength(0);
    });
  });

  describe('getNextTask', () => {
    it('returns highest priority ready task', async () => {
      mockClient.listReady.mockResolvedValue([
        createMockBead({ id: 'low', priority: 4, status: 'open' }),
        createMockBead({ id: 'critical', priority: 1, status: 'open' }),
        createMockBead({ id: 'high', priority: 2, status: 'open' }),
      ]);
      await source.fetchTasks();

      const next = source.getNextTask();

      expect(next?.id).toBe('critical');
    });

    it('returns undefined when no ready tasks', async () => {
      mockClient.listReady.mockResolvedValue([
        createMockBead({ id: 'task-1', status: 'in_progress' }),
      ]);
      await source.fetchTasks();

      const next = source.getNextTask();

      expect(next).toBeUndefined();
    });

    it('returns oldest task at same priority', async () => {
      const older = '2026-01-01T00:00:00Z';
      const newer = '2026-01-02T00:00:00Z';
      mockClient.listReady.mockResolvedValue([
        createMockBead({ id: 'newer', priority: 2, status: 'open', created_at: newer }),
        createMockBead({ id: 'older', priority: 2, status: 'open', created_at: older }),
      ]);
      await source.fetchTasks();

      const next = source.getNextTask();

      expect(next?.id).toBe('older');
    });
  });

  describe('priority edge cases', () => {
    it('maps priority 0 to critical', async () => {
      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'task-1', priority: 0 })]);
      const tasks = await source.fetchTasks();
      expect(tasks[0].priority).toBe('critical');
    });

    it('maps unknown priority to low', async () => {
      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'task-1', priority: 99 })]);
      const tasks = await source.fetchTasks();
      expect(tasks[0].priority).toBe('low');
    });
  });

  describe('sync change detection', () => {
    it('detects status changes', async () => {
      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'task-1', status: 'open' })]);
      await source.fetchTasks();

      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'task-1', status: 'in_progress' })]);
      const result = await source.sync();

      expect(result.updated).toHaveLength(1);
      expect(result.updated[0].status).toBe('working');
    });

    it('detects priority changes', async () => {
      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'task-1', priority: 2 })]);
      await source.fetchTasks();

      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'task-1', priority: 1 })]);
      const result = await source.sync();

      expect(result.updated).toHaveLength(1);
      expect(result.updated[0].priority).toBe('critical');
    });

    it('detects dependency changes', async () => {
      mockClient.listReady.mockResolvedValue([createMockBead({ id: 'task-1' })]);
      await source.fetchTasks();

      mockClient.listReady.mockResolvedValue([
        createMockBead({
          id: 'task-1',
          dependencies: [{ id: 'dep-1', title: 'Dep', status: 'open', dependency_type: 'blocked-by' }],
        }),
      ]);
      const result = await source.sync();

      expect(result.updated).toHaveLength(1);
      expect(result.updated[0].dependencies).toContain('dep-1');
    });
  });
});

describe('BeadsTaskSource with Daemon Integration', () => {
  let source: BeadsTaskSource;
  let mockBeadsClient: {
    isAvailable: ReturnType<typeof vi.fn>;
    isInitialized: ReturnType<typeof vi.fn>;
    listReady: ReturnType<typeof vi.fn>;
    getTask: ReturnType<typeof vi.fn>;
    createTask: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
  };
  let mockDaemonClient: {
    getTasks: ReturnType<typeof vi.fn>;
    getTask: ReturnType<typeof vi.fn>;
  };
  let mockSSEClient: {
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
  };
  let sseEventHandler: ((event: { type: string; data: unknown }) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockBeadsClient = {
      isAvailable: vi.fn().mockResolvedValue(true),
      isInitialized: vi.fn().mockResolvedValue(true),
      listReady: vi.fn().mockResolvedValue([]),
      getTask: vi.fn().mockResolvedValue(null),
      createTask: vi.fn().mockResolvedValue({ success: true, id: 'new-id' }),
      updateStatus: vi.fn().mockResolvedValue({ success: true }),
    };

    mockDaemonClient = {
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

    MockBeadsClient.mockImplementation(() => mockBeadsClient);
    MockDaemonClient.mockImplementation(() => mockDaemonClient);
    MockSSEClient.mockImplementation(() => mockSSEClient);

    source = new BeadsTaskSource('/mock/workspace', { autoWatch: false });
  });

  afterEach(() => {
    source.dispose();
    sseEventHandler = null;
    vi.useRealTimers();
  });

  describe('setDaemonClients', () => {
    it('enables daemon mode', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([createMockDaemonTask({ id: 'daemon-task' })]);

      source.setDaemonClients(
        mockDaemonClient as unknown as DaemonClient,
        mockSSEClient as unknown as SSEClient
      );

      const tasks = await source.fetchTasks();

      expect(mockDaemonClient.getTasks).toHaveBeenCalled();
      expect(mockBeadsClient.listReady).not.toHaveBeenCalled();
      expect(tasks[0].id).toBe('daemon-task');
    });
  });

  describe('fetchTasks with daemon', () => {
    beforeEach(() => {
      source.setDaemonClients(
        mockDaemonClient as unknown as DaemonClient,
        mockSSEClient as unknown as SSEClient
      );
    });

    it('returns empty array when no tasks', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([]);
      const tasks = await source.fetchTasks();
      expect(tasks).toEqual([]);
    });

    it('converts daemon tasks to Coven tasks', async () => {
      const daemonTasks = [
        createMockDaemonTask({ id: 'task-1', title: 'Task 1' }),
        createMockDaemonTask({ id: 'task-2', title: 'Task 2' }),
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
        createMockDaemonTask({ id: 'task-1', status: 'ready' }),
        createMockDaemonTask({ id: 'task-2', status: 'running' }),
        createMockDaemonTask({ id: 'task-3', status: 'complete' }),
        createMockDaemonTask({ id: 'task-4', status: 'failed' }),
        createMockDaemonTask({ id: 'task-5', status: 'pending' }),
        createMockDaemonTask({ id: 'task-6', status: 'blocked' }),
      ];
      mockDaemonClient.getTasks.mockResolvedValue(daemonTasks);

      const tasks = await source.fetchTasks();

      expect(tasks[0].status).toBe('ready');
      expect(tasks[1].status).toBe('working');
      expect(tasks[2].status).toBe('done');
      expect(tasks[3].status).toBe('blocked'); // failed maps to blocked
      expect(tasks[4].status).toBe('ready'); // pending maps to ready
      expect(tasks[5].status).toBe('blocked');
    });

    it('maps daemon priority correctly', async () => {
      const daemonTasks = [
        createMockDaemonTask({ id: 'task-0', priority: 0 }),
        createMockDaemonTask({ id: 'task-1', priority: 1 }),
        createMockDaemonTask({ id: 'task-2', priority: 2 }),
        createMockDaemonTask({ id: 'task-3', priority: 3 }),
        createMockDaemonTask({ id: 'task-4', priority: 4 }),
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
        createMockDaemonTask({
          id: 'task-1',
          status: 'ready',
          dependencies: ['dep-1', 'dep-2'],
        }),
      ];
      mockDaemonClient.getTasks.mockResolvedValue(daemonTasks);

      const tasks = await source.fetchTasks();

      expect(tasks[0].status).toBe('blocked');
      expect(tasks[0].dependencies).toEqual(['dep-1', 'dep-2']);
    });
  });

  describe('sync with daemon', () => {
    beforeEach(() => {
      source.setDaemonClients(
        mockDaemonClient as unknown as DaemonClient,
        mockSSEClient as unknown as SSEClient
      );
    });

    it('detects added tasks via daemon', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([]);
      await source.fetchTasks();

      mockDaemonClient.getTasks.mockResolvedValue([createMockDaemonTask({ id: 'new-task' })]);
      const result = await source.sync();

      expect(result.added).toHaveLength(1);
      expect(result.added[0].id).toBe('new-task');
    });

    it('detects removed tasks via daemon', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([createMockDaemonTask({ id: 'old-task' })]);
      await source.fetchTasks();

      mockDaemonClient.getTasks.mockResolvedValue([]);
      const result = await source.sync();

      expect(result.removed).toEqual(['old-task']);
    });
  });

  describe('watch with SSE', () => {
    beforeEach(() => {
      source.setDaemonClients(
        mockDaemonClient as unknown as DaemonClient,
        mockSSEClient as unknown as SSEClient
      );
    });

    it('subscribes to SSE events', () => {
      source.watch();

      expect(mockSSEClient.on).toHaveBeenCalledWith('event', expect.any(Function));
    });

    it('handles task.created events', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([]);
      await source.fetchTasks();

      source.watch();

      mockDaemonClient.getTask.mockResolvedValue(createMockDaemonTask({ id: 'new-task' }));

      const syncHandler = vi.fn();
      source.on('sync', syncHandler);

      // Simulate SSE event
      sseEventHandler?.({ type: 'task.created', data: { taskId: 'new-task' } });

      // Wait for async operations - use waitFor to avoid infinite timer loop
      await vi.waitFor(() => {
        expect(mockDaemonClient.getTask).toHaveBeenCalledWith('new-task');
      });

      source.stopWatch();
    });

    it('handles task.updated events', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([createMockDaemonTask({ id: 'task-1' })]);
      await source.fetchTasks();

      source.watch();

      mockDaemonClient.getTask.mockResolvedValue(
        createMockDaemonTask({ id: 'task-1', title: 'Updated Title' })
      );

      const syncHandler = vi.fn();
      source.on('sync', syncHandler);

      sseEventHandler?.({ type: 'task.updated', data: { taskId: 'task-1' } });

      await vi.waitFor(() => {
        expect(syncHandler).toHaveBeenCalledWith({
          added: [],
          updated: [expect.objectContaining({ id: 'task-1', title: 'Updated Title' })],
          removed: [],
        });
      });

      source.stopWatch();
    });

    it('handles task.completed events', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([createMockDaemonTask({ id: 'task-1' })]);
      await source.fetchTasks();

      source.watch();

      mockDaemonClient.getTask.mockResolvedValue(
        createMockDaemonTask({ id: 'task-1', status: 'complete' })
      );

      sseEventHandler?.({ type: 'task.completed', data: { taskId: 'task-1' } });

      await vi.waitFor(() => {
        expect(mockDaemonClient.getTask).toHaveBeenCalledWith('task-1');
      });

      source.stopWatch();
    });

    it('handles task removal when task not found', async () => {
      mockDaemonClient.getTasks.mockResolvedValue([createMockDaemonTask({ id: 'task-1' })]);
      await source.fetchTasks();
      expect(source.getTask('task-1')).toBeDefined();

      source.watch();

      const error = new DaemonClientError('task_not_found', 'Task not found');
      mockDaemonClient.getTask.mockRejectedValue(error);

      const syncHandler = vi.fn();
      source.on('sync', syncHandler);

      sseEventHandler?.({ type: 'task.failed', data: { taskId: 'task-1' } });

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

  describe('fetchTask with daemon', () => {
    beforeEach(() => {
      source.setDaemonClients(
        mockDaemonClient as unknown as DaemonClient,
        mockSSEClient as unknown as SSEClient
      );
    });

    it('fetches single task from daemon', async () => {
      mockDaemonClient.getTask.mockResolvedValue(
        createMockDaemonTask({ id: 'task-1', title: 'Single Task' })
      );

      const task = await source.fetchTask('task-1');

      expect(task).toBeDefined();
      expect(task?.id).toBe('task-1');
      expect(task?.title).toBe('Single Task');
      expect(mockDaemonClient.getTask).toHaveBeenCalledWith('task-1');
    });

    it('caches fetched task', async () => {
      mockDaemonClient.getTask.mockResolvedValue(
        createMockDaemonTask({ id: 'task-1' })
      );

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
});
