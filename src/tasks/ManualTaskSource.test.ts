import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ManualTaskSource } from './ManualTaskSource';
import { TaskManager } from './TaskManager';

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe('ManualTaskSource', () => {
  let manualTaskSource: ManualTaskSource;
  let taskManager: TaskManager;
  const workspaceRoot = '/test/workspace';

  beforeEach(async () => {
    vi.clearAllMocks();
    taskManager = new TaskManager(workspaceRoot);
    await taskManager.initialize();
    manualTaskSource = new ManualTaskSource(taskManager);
  });

  afterEach(() => {
    taskManager.dispose();
    manualTaskSource.dispose();
  });

  describe('properties', () => {
    it('should have id "manual"', () => {
      expect(manualTaskSource.id).toBe('manual');
    });

    it('should have name "Manual Tasks"', () => {
      expect(manualTaskSource.name).toBe('Manual Tasks');
    });
  });

  describe('createTask', () => {
    it('should create a task with sourceId "manual"', () => {
      const task = manualTaskSource.createTask({
        title: 'Test Task',
        description: 'Test description',
      });

      expect(task.sourceId).toBe('manual');
      expect(task.title).toBe('Test Task');
      expect(task.description).toBe('Test description');
      expect(task.status).toBe('ready');
    });

    it('should create task with priority', () => {
      const task = manualTaskSource.createTask({
        title: 'High Priority Task',
        description: 'Urgent',
        priority: 'high',
      });

      expect(task.priority).toBe('high');
    });

    it('should create task with acceptance criteria', () => {
      const task = manualTaskSource.createTask({
        title: 'Task with AC',
        description: 'Has criteria',
        acceptanceCriteria: 'All tests pass',
      });

      expect(task.acceptanceCriteria).toBe('All tests pass');
    });
  });

  describe('fetchTasks', () => {
    it('should return only manual tasks', async () => {
      // Create manual tasks
      manualTaskSource.createTask({
        title: 'Manual 1',
        description: 'Manual task',
      });
      manualTaskSource.createTask({
        title: 'Manual 2',
        description: 'Manual task',
      });

      // Create a non-manual task directly via TaskManager
      taskManager.createTask({
        title: 'Beads Task',
        description: 'From beads',
        sourceId: 'beads',
      });

      const tasks = await manualTaskSource.fetchTasks();
      expect(tasks).toHaveLength(2);
      expect(tasks.every((t) => t.sourceId === 'manual')).toBe(true);
    });
  });

  describe('updateTask', () => {
    it('should update a manual task', () => {
      const task = manualTaskSource.createTask({
        title: 'Original',
        description: 'Original desc',
      });

      const updated = manualTaskSource.updateTask(task.id, {
        title: 'Updated',
        description: 'Updated desc',
      });

      expect(updated.title).toBe('Updated');
      expect(updated.description).toBe('Updated desc');
    });

    it('should throw for non-existent task', () => {
      expect(() => manualTaskSource.updateTask('non-existent', { title: 'New' })).toThrow(
        'Task not found'
      );
    });

    it('should throw for non-manual task', () => {
      const task = taskManager.createTask({
        title: 'Beads Task',
        description: 'From beads',
        sourceId: 'beads',
      });

      expect(() => manualTaskSource.updateTask(task.id, { title: 'New' })).toThrow(
        'is not a manual task'
      );
    });
  });

  describe('deleteTask', () => {
    it('should delete a manual task', () => {
      const task = manualTaskSource.createTask({
        title: 'To Delete',
        description: 'Will be deleted',
      });

      manualTaskSource.deleteTask(task.id);

      expect(taskManager.getTask(task.id)).toBeUndefined();
    });

    it('should throw for non-existent task', () => {
      expect(() => manualTaskSource.deleteTask('non-existent')).toThrow('Task not found');
    });

    it('should throw for non-manual task', () => {
      const task = taskManager.createTask({
        title: 'Beads Task',
        description: 'From beads',
        sourceId: 'beads',
      });

      expect(() => manualTaskSource.deleteTask(task.id)).toThrow('is not a manual task');
    });
  });

  describe('onTaskStatusChanged', () => {
    it('should be a no-op', async () => {
      // Should complete without error
      await expect(
        manualTaskSource.onTaskStatusChanged('task-1', 'working')
      ).resolves.toBeUndefined();
    });
  });
});
