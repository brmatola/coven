import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BeadsClient, BeadData, BeadsClientError } from './BeadsClient';

// Store the mock result
let mockResult: { stdout: string; stderr: string } | null = null;
let mockError: Error | null = null;

// Mock child_process.exec
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

// Mock util.promisify to return our controlled mock
vi.mock('util', async (importOriginal) => {
  const original = await importOriginal<typeof import('util')>();
  return {
    ...original,
    promisify: vi.fn(() => {
      return () => {
        if (mockError) {
          return Promise.reject(mockError);
        }
        return Promise.resolve(mockResult ?? { stdout: '', stderr: '' });
      };
    }),
  };
});

function mockExecSuccess(stdout: string, stderr = ''): void {
  mockResult = { stdout, stderr };
  mockError = null;
}

function mockExecError(error: Error): void {
  mockError = error;
  mockResult = null;
}

function createMockBeadData(overrides: Partial<BeadData> = {}): BeadData {
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

describe('BeadsClient', () => {
  let client: BeadsClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResult = null;
    mockError = null;
    client = new BeadsClient('/mock/workspace');
  });

  describe('isAvailable', () => {
    it('returns true when bd command exists', async () => {
      mockExecSuccess('bd version 1.0.0');
      const result = await client.isAvailable();
      expect(result).toBe(true);
    });

    it('returns false when bd command fails', async () => {
      mockExecError(new Error('command not found'));
      const result = await client.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('isInitialized', () => {
    it('returns true when bd list works', async () => {
      mockExecSuccess('[]');
      const result = await client.isInitialized();
      expect(result).toBe(true);
    });

    it('returns false when bd list fails', async () => {
      mockExecError(new Error('not initialized'));
      const result = await client.isInitialized();
      expect(result).toBe(false);
    });
  });

  describe('listReady', () => {
    it('returns ready tasks', async () => {
      const beads = [
        createMockBeadData({ id: 'task-1', title: 'Task 1' }),
        createMockBeadData({ id: 'task-2', title: 'Task 2' }),
      ];
      mockExecSuccess(JSON.stringify(beads));

      const result = await client.listReady();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('task-1');
      expect(result[1].id).toBe('task-2');
    });

    it('includes all issue types (task, bug, feature, epic, story)', async () => {
      const beads = [
        createMockBeadData({ id: 'task-1', issue_type: 'task' }),
        createMockBeadData({ id: 'epic-1', issue_type: 'epic' }),
        createMockBeadData({ id: 'feature-1', issue_type: 'feature' }),
        createMockBeadData({ id: 'bug-1', issue_type: 'bug' }),
      ];
      mockExecSuccess(JSON.stringify(beads));

      const result = await client.listReady();

      expect(result).toHaveLength(4);
      expect(result.map((b) => b.id)).toEqual(['task-1', 'epic-1', 'feature-1', 'bug-1']);
    });

    it('returns all items from bd ready (no additional filtering)', async () => {
      const beads = [
        createMockBeadData({ id: 'task-1', status: 'open' }),
        createMockBeadData({ id: 'task-2', status: 'open' }),
      ];
      mockExecSuccess(JSON.stringify(beads));

      const result = await client.listReady();

      // bd ready already filters, we just return what it gives us
      expect(result).toHaveLength(2);
    });

    it('throws BeadsClientError on failure', async () => {
      mockExecError(new Error('CLI error'));

      await expect(client.listReady()).rejects.toThrow(BeadsClientError);
    });
  });

  describe('getTask', () => {
    it('returns task when found', async () => {
      const bead = createMockBeadData({ id: 'task-123' });
      mockExecSuccess(JSON.stringify([bead]));

      const result = await client.getTask('task-123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('task-123');
    });

    it('returns null when not found', async () => {
      mockExecError(new Error('not found'));

      const result = await client.getTask('nonexistent');

      expect(result).toBeNull();
    });

    it('returns null for empty result', async () => {
      mockExecSuccess('[]');

      const result = await client.getTask('task-123');

      expect(result).toBeNull();
    });
  });

  describe('createTask', () => {
    it('creates task and returns ID', async () => {
      mockExecSuccess('✓ Created issue: new-task-id');

      const result = await client.createTask({
        title: 'New Task',
        description: 'Task description',
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe('new-task-id');
    });

    it('returns error on failure', async () => {
      mockExecError(new Error('Creation failed'));

      const result = await client.createTask({ title: 'New Task' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Creation failed');
    });
  });

  describe('updateStatus', () => {
    it('updates to in_progress', async () => {
      mockExecSuccess('✓ Updated issue: task-123');

      const result = await client.updateStatus('task-123', 'in_progress');

      expect(result.success).toBe(true);
    });

    it('closes task when status is closed', async () => {
      mockExecSuccess('✓ Closed issue: task-123');

      const result = await client.updateStatus('task-123', 'closed');

      expect(result.success).toBe(true);
    });

    it('returns error on failure', async () => {
      mockExecError(new Error('Update failed'));

      const result = await client.updateStatus('task-123', 'open');

      expect(result.success).toBe(false);
    });
  });

  describe('closeTask', () => {
    it('closes task with reason', async () => {
      mockExecSuccess('✓ Closed issue: task-123');

      const result = await client.closeTask('task-123', 'Completed');

      expect(result.success).toBe(true);
    });

    it('closes task without reason', async () => {
      mockExecSuccess('✓ Closed issue: task-123');

      const result = await client.closeTask('task-123');

      expect(result.success).toBe(true);
    });
  });

  describe('reopenTask', () => {
    it('reopens closed task', async () => {
      mockExecSuccess('✓ Reopened issue: task-123');

      const result = await client.reopenTask('task-123');

      expect(result.success).toBe(true);
    });
  });

  describe('getBlockers', () => {
    it('returns blocking task IDs', async () => {
      const bead = createMockBeadData({
        id: 'task-123',
        dependencies: [
          { id: 'blocker-1', title: 'Blocker', status: 'open', dependency_type: 'blocked-by' },
          { id: 'blocker-2', title: 'Blocker 2', status: 'closed', dependency_type: 'blocked-by' },
          { id: 'child-1', title: 'Child', status: 'open', dependency_type: 'parent-child' },
        ],
      });
      mockExecSuccess(JSON.stringify([bead]));

      const blockers = await client.getBlockers('task-123');

      expect(blockers).toEqual(['blocker-1']);
    });

    it('returns empty array when no dependencies', async () => {
      const bead = createMockBeadData({ id: 'task-123' });
      mockExecSuccess(JSON.stringify([bead]));

      const blockers = await client.getBlockers('task-123');

      expect(blockers).toEqual([]);
    });
  });
});

describe('BeadsClientError', () => {
  it('stores cause', () => {
    const cause = new Error('original');
    const error = new BeadsClientError('Wrapped', cause);

    expect(error.message).toBe('Wrapped');
    expect(error.cause).toBe(cause);
    expect(error.name).toBe('BeadsClientError');
  });
});
