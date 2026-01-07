import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { TaskManager } from './TaskManager';

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
    },
    writeFileSync: vi.fn(),
  };
});

describe('TaskManager', () => {
  let taskManager: TaskManager;
  const workspaceRoot = '/test/workspace';

  beforeEach(async () => {
    vi.clearAllMocks();
    taskManager = new TaskManager(workspaceRoot);
    await taskManager.initialize();
  });

  afterEach(() => {
    taskManager.dispose();
  });

  describe('createTask', () => {
    it('should create a task with default values', () => {
      const task = taskManager.createTask({
        title: 'Test Task',
        description: 'Test description',
        sourceId: 'manual',
      });

      expect(task.id).toBeDefined();
      expect(task.title).toBe('Test Task');
      expect(task.description).toBe('Test description');
      expect(task.status).toBe('ready');
      expect(task.priority).toBe('medium');
      expect(task.dependencies).toEqual([]);
      expect(task.sourceId).toBe('manual');
    });

    it('should emit task:created event', () => {
      const handler = vi.fn();
      taskManager.on('task:created', handler);

      const task = taskManager.createTask({
        title: 'Test Task',
        description: 'Test description',
        sourceId: 'manual',
      });

      expect(handler).toHaveBeenCalledWith({ task });
    });

    it('should set status to blocked if dependencies are not done', () => {
      const dep = taskManager.createTask({
        title: 'Dependency',
        description: 'Dep',
        sourceId: 'manual',
      });

      const task = taskManager.createTask({
        title: 'Dependent Task',
        description: 'Depends on dep',
        dependencies: [dep.id],
        sourceId: 'manual',
      });

      expect(task.status).toBe('blocked');
    });

    it('should set status to ready if all dependencies are done', () => {
      const dep = taskManager.createTask({
        title: 'Dependency',
        description: 'Dep',
        sourceId: 'manual',
      });

      taskManager.transitionStatus(dep.id, 'working');
      taskManager.transitionStatus(dep.id, 'review');
      taskManager.transitionStatus(dep.id, 'done');

      const task = taskManager.createTask({
        title: 'Dependent Task',
        description: 'Depends on done dep',
        dependencies: [dep.id],
        sourceId: 'manual',
      });

      expect(task.status).toBe('ready');
    });
  });

  describe('getTask', () => {
    it('should return task by id', () => {
      const created = taskManager.createTask({
        title: 'Test',
        description: 'Test',
        sourceId: 'manual',
      });

      const retrieved = taskManager.getTask(created.id);
      expect(retrieved).toEqual(created);
    });

    it('should return undefined for non-existent task', () => {
      expect(taskManager.getTask('non-existent')).toBeUndefined();
    });
  });

  describe('updateTask', () => {
    it('should update task fields', () => {
      const task = taskManager.createTask({
        title: 'Original',
        description: 'Original desc',
        sourceId: 'manual',
      });

      const updated = taskManager.updateTask(task.id, {
        title: 'Updated',
        description: 'Updated desc',
        priority: 'high',
      });

      expect(updated.title).toBe('Updated');
      expect(updated.description).toBe('Updated desc');
      expect(updated.priority).toBe('high');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(task.createdAt);
    });

    it('should throw for non-existent task', () => {
      expect(() => taskManager.updateTask('non-existent', { title: 'New' })).toThrow(
        'Task not found'
      );
    });

    it('should emit task:updated event', () => {
      const task = taskManager.createTask({
        title: 'Test',
        description: 'Test',
        sourceId: 'manual',
      });

      const handler = vi.fn();
      taskManager.on('task:updated', handler);

      taskManager.updateTask(task.id, { title: 'Updated' });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('deleteTask', () => {
    it('should delete a ready task', () => {
      const task = taskManager.createTask({
        title: 'Test',
        description: 'Test',
        sourceId: 'manual',
      });

      taskManager.deleteTask(task.id);
      expect(taskManager.getTask(task.id)).toBeUndefined();
    });

    it('should delete a blocked task', () => {
      const dep = taskManager.createTask({
        title: 'Dep',
        description: 'Dep',
        sourceId: 'manual',
      });

      const task = taskManager.createTask({
        title: 'Blocked',
        description: 'Blocked',
        dependencies: [dep.id],
        sourceId: 'manual',
      });

      expect(task.status).toBe('blocked');
      taskManager.deleteTask(task.id);
      expect(taskManager.getTask(task.id)).toBeUndefined();
    });

    it('should not delete a working task', () => {
      const task = taskManager.createTask({
        title: 'Test',
        description: 'Test',
        sourceId: 'manual',
      });

      taskManager.transitionStatus(task.id, 'working');

      expect(() => taskManager.deleteTask(task.id)).toThrow(
        "Cannot delete task in 'working' status"
      );
    });

    it('should not delete a review task', () => {
      const task = taskManager.createTask({
        title: 'Test',
        description: 'Test',
        sourceId: 'manual',
      });

      taskManager.transitionStatus(task.id, 'working');
      taskManager.transitionStatus(task.id, 'review');

      expect(() => taskManager.deleteTask(task.id)).toThrow(
        "Cannot delete task in 'review' status"
      );
    });

    it('should emit task:deleted event', () => {
      const task = taskManager.createTask({
        title: 'Test',
        description: 'Test',
        sourceId: 'manual',
      });

      const handler = vi.fn();
      taskManager.on('task:deleted', handler);

      taskManager.deleteTask(task.id);
      expect(handler).toHaveBeenCalledWith({ taskId: task.id });
    });
  });

  describe('transitionStatus', () => {
    it('should transition ready to working', () => {
      const task = taskManager.createTask({
        title: 'Test',
        description: 'Test',
        sourceId: 'manual',
      });

      const updated = taskManager.transitionStatus(task.id, 'working');
      expect(updated.status).toBe('working');
    });

    it('should transition working to review', () => {
      const task = taskManager.createTask({
        title: 'Test',
        description: 'Test',
        sourceId: 'manual',
      });

      taskManager.transitionStatus(task.id, 'working');
      const updated = taskManager.transitionStatus(task.id, 'review');
      expect(updated.status).toBe('review');
    });

    it('should transition review to done', () => {
      const task = taskManager.createTask({
        title: 'Test',
        description: 'Test',
        sourceId: 'manual',
      });

      taskManager.transitionStatus(task.id, 'working');
      taskManager.transitionStatus(task.id, 'review');
      const updated = taskManager.transitionStatus(task.id, 'done');
      expect(updated.status).toBe('done');
    });

    it('should reject invalid transition ready to done', () => {
      const task = taskManager.createTask({
        title: 'Test',
        description: 'Test',
        sourceId: 'manual',
      });

      expect(() => taskManager.transitionStatus(task.id, 'done')).toThrow(
        "Invalid transition from 'ready' to 'done'"
      );
    });

    it('should reject invalid transition working to done', () => {
      const task = taskManager.createTask({
        title: 'Test',
        description: 'Test',
        sourceId: 'manual',
      });

      taskManager.transitionStatus(task.id, 'working');

      expect(() => taskManager.transitionStatus(task.id, 'done')).toThrow(
        "Invalid transition from 'working' to 'done'"
      );
    });

    it('should allow review to working (changes requested)', () => {
      const task = taskManager.createTask({
        title: 'Test',
        description: 'Test',
        sourceId: 'manual',
      });

      taskManager.transitionStatus(task.id, 'working');
      taskManager.transitionStatus(task.id, 'review');
      const updated = taskManager.transitionStatus(task.id, 'working');
      expect(updated.status).toBe('working');
    });

    it('should unblock dependent tasks when dependency completes', () => {
      const dep = taskManager.createTask({
        title: 'Dependency',
        description: 'Dep',
        sourceId: 'manual',
      });

      const task = taskManager.createTask({
        title: 'Dependent',
        description: 'Depends on dep',
        dependencies: [dep.id],
        sourceId: 'manual',
      });

      expect(task.status).toBe('blocked');

      const handler = vi.fn();
      taskManager.on('task:unblocked', handler);

      taskManager.transitionStatus(dep.id, 'working');
      taskManager.transitionStatus(dep.id, 'review');
      taskManager.transitionStatus(dep.id, 'done');

      const updatedTask = taskManager.getTask(task.id);
      expect(updatedTask?.status).toBe('ready');
      expect(handler).toHaveBeenCalledWith({ task: expect.objectContaining({ id: task.id }) });
    });
  });

  describe('dependency tracking', () => {
    it('should add dependency', () => {
      const dep = taskManager.createTask({
        title: 'Dep',
        description: 'Dep',
        sourceId: 'manual',
      });

      const task = taskManager.createTask({
        title: 'Task',
        description: 'Task',
        sourceId: 'manual',
      });

      taskManager.addDependency(task.id, dep.id);

      const updated = taskManager.getTask(task.id);
      expect(updated?.dependencies).toContain(dep.id);
      expect(updated?.status).toBe('blocked');
    });

    it('should remove dependency', () => {
      const dep = taskManager.createTask({
        title: 'Dep',
        description: 'Dep',
        sourceId: 'manual',
      });

      const task = taskManager.createTask({
        title: 'Task',
        description: 'Task',
        dependencies: [dep.id],
        sourceId: 'manual',
      });

      taskManager.removeDependency(task.id, dep.id);

      const updated = taskManager.getTask(task.id);
      expect(updated?.dependencies).not.toContain(dep.id);
    });

    it('should reject circular dependencies', () => {
      const a = taskManager.createTask({
        title: 'A',
        description: 'A',
        sourceId: 'manual',
      });

      const b = taskManager.createTask({
        title: 'B',
        description: 'B',
        dependencies: [a.id],
        sourceId: 'manual',
      });

      expect(() => taskManager.addDependency(a.id, b.id)).toThrow('cycle');
    });
  });

  describe('filtering and querying', () => {
    it('should get tasks by status', () => {
      taskManager.createTask({
        title: 'Ready 1',
        description: 'Ready',
        sourceId: 'manual',
      });
      taskManager.createTask({
        title: 'Ready 2',
        description: 'Ready',
        sourceId: 'manual',
      });
      const working = taskManager.createTask({
        title: 'Working',
        description: 'Working',
        sourceId: 'manual',
      });
      taskManager.transitionStatus(working.id, 'working');

      const readyTasks = taskManager.getTasksByStatus('ready');
      expect(readyTasks).toHaveLength(2);

      const workingTasks = taskManager.getTasksByStatus('working');
      expect(workingTasks).toHaveLength(1);
    });

    it('should get tasks by source', () => {
      taskManager.createTask({
        title: 'Manual 1',
        description: 'Manual',
        sourceId: 'manual',
      });
      taskManager.createTask({
        title: 'Beads 1',
        description: 'Beads',
        sourceId: 'beads',
      });
      taskManager.createTask({
        title: 'Manual 2',
        description: 'Manual',
        sourceId: 'manual',
      });

      const manualTasks = taskManager.getTasksBySource('manual');
      expect(manualTasks).toHaveLength(2);

      const beadsTasks = taskManager.getTasksBySource('beads');
      expect(beadsTasks).toHaveLength(1);
    });

    it('should get next task by priority', () => {
      taskManager.createTask({
        title: 'Low',
        description: 'Low',
        priority: 'low',
        sourceId: 'manual',
      });
      const high = taskManager.createTask({
        title: 'High',
        description: 'High',
        priority: 'high',
        sourceId: 'manual',
      });
      taskManager.createTask({
        title: 'Medium',
        description: 'Medium',
        priority: 'medium',
        sourceId: 'manual',
      });

      const next = taskManager.getNextTask();
      expect(next?.id).toBe(high.id);
    });

    it('should get next task by creation time within same priority', () => {
      const first = taskManager.createTask({
        title: 'First',
        description: 'First',
        priority: 'high',
        sourceId: 'manual',
      });

      // Create second task to ensure ordering works
      taskManager.createTask({
        title: 'Second',
        description: 'Second',
        priority: 'high',
        sourceId: 'manual',
      });

      const next = taskManager.getNextTask();
      expect(next?.id).toBe(first.id);
    });

    it('should return undefined when no ready tasks', () => {
      const task = taskManager.createTask({
        title: 'Test',
        description: 'Test',
        sourceId: 'manual',
      });
      taskManager.transitionStatus(task.id, 'working');

      expect(taskManager.getNextTask()).toBeUndefined();
    });

    it('should get tasks grouped by status', () => {
      taskManager.createTask({
        title: 'Ready',
        description: 'Ready',
        sourceId: 'manual',
      });
      const working = taskManager.createTask({
        title: 'Working',
        description: 'Working',
        sourceId: 'manual',
      });
      taskManager.transitionStatus(working.id, 'working');

      const grouped = taskManager.getTasksGroupedByStatus();
      expect(grouped.ready).toHaveLength(1);
      expect(grouped.working).toHaveLength(1);
      expect(grouped.review).toHaveLength(0);
      expect(grouped.done).toHaveLength(0);
      expect(grouped.blocked).toHaveLength(0);
    });
  });

  describe('persistence', () => {
    it('should call writeFileSync on task creation', () => {
      taskManager.createTask({
        title: 'Test',
        description: 'Test',
        sourceId: 'manual',
      });

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join(workspaceRoot, '.coven', 'tasks.json'),
        expect.any(String)
      );
    });
  });
});
