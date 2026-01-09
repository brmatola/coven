import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import { WorktreeManager } from './WorktreeManager';
import { GitProvider, Worktree } from './types';

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// Create a mock GitProvider
function createMockGitProvider(): GitProvider {
  return {
    listWorktrees: vi.fn().mockResolvedValue([]),
    createWorktree: vi.fn().mockResolvedValue({
      path: '/test/worktrees/session/task-1',
      branch: 'coven/session/task-1',
      head: 'abc123',
      isMain: false,
      isBare: false,
    }),
    deleteWorktree: vi.fn().mockResolvedValue(undefined),
    getCurrentBranch: vi.fn().mockResolvedValue('main'),
    branchExists: vi.fn().mockResolvedValue(true),
    createBranch: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockResolvedValue({
      staged: [],
      modified: [],
      untracked: [],
      deleted: [],
      branch: 'main',
      ahead: 0,
      behind: 0,
    }),
    merge: vi.fn().mockResolvedValue({
      success: true,
      conflicts: [],
      mergedFiles: ['file.ts'],
      commitHash: 'def456',
    }),
    commit: vi.fn().mockResolvedValue('abc123'),
    add: vi.fn().mockResolvedValue(undefined),
    abortMerge: vi.fn().mockResolvedValue(undefined),
    isWorktree: vi.fn().mockResolvedValue(false),
    getRepoRoot: vi.fn().mockResolvedValue('/test/workspace'),
    getDiff: vi.fn().mockResolvedValue(''),
    isAvailable: vi.fn().mockResolvedValue(true),
  };
}

describe('WorktreeManager', () => {
  const workspaceRoot = '/test/workspace';
  const worktreeBasePath = '.coven/worktrees';
  const sessionId = 'test-session-123';

  let manager: WorktreeManager;
  let mockGitProvider: GitProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGitProvider = createMockGitProvider();
    manager = new WorktreeManager(workspaceRoot, worktreeBasePath, sessionId, mockGitProvider);
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('initialize', () => {
    it('should create base directory', async () => {
      await manager.initialize();

      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        '/test/workspace/.coven/worktrees',
        { recursive: true }
      );
    });

    it('should detect existing worktrees from this session', async () => {
      const existingWorktree: Worktree = {
        path: '/test/workspace/.coven/worktrees/test-session-123/existing-task',
        branch: 'coven/test-session-123/existing-task',
        head: 'abc123',
        isMain: false,
        isBare: false,
      };
      vi.mocked(mockGitProvider.listWorktrees).mockResolvedValue([existingWorktree]);

      await manager.initialize();

      expect(manager.getWorktree('existing-task')).toEqual(existingWorktree);
    });

    it('should not detect worktrees from other sessions', async () => {
      const otherSessionWorktree: Worktree = {
        path: '/test/workspace/.coven/worktrees/other-session/task-1',
        branch: 'coven/other-session/task-1',
        head: 'abc123',
        isMain: false,
        isBare: false,
      };
      vi.mocked(mockGitProvider.listWorktrees).mockResolvedValue([otherSessionWorktree]);

      await manager.initialize();

      expect(manager.getWorktree('task-1')).toBeUndefined();
    });
  });

  describe('createForTask', () => {
    it('should create a worktree for the task', async () => {
      const worktree = await manager.createForTask('task-1', 'feature/main');

      expect(mockGitProvider.createWorktree).toHaveBeenCalledWith(
        'coven/test-session-123/task-1',
        '/test/workspace/.coven/worktrees/test-session-123/task-1',
        { baseBranch: 'feature/main', createBranch: true }
      );
      expect(worktree).toBeDefined();
      expect(worktree.branch).toBe('coven/session/task-1'); // From mock
    });

    it('should track the created worktree', async () => {
      await manager.createForTask('task-1', 'feature/main');

      expect(manager.getWorktree('task-1')).toBeDefined();
    });

    it('should emit worktree:created event', async () => {
      const handler = vi.fn();
      manager.on('worktree:created', handler);

      await manager.createForTask('task-1', 'feature/main');

      expect(handler).toHaveBeenCalledWith({
        taskId: 'task-1',
        worktree: expect.objectContaining({ branch: 'coven/session/task-1' }),
      });
    });

    it('should throw if worktree already exists for task', async () => {
      await manager.createForTask('task-1', 'feature/main');

      await expect(manager.createForTask('task-1', 'feature/main')).rejects.toThrow(
        'Worktree already exists for task: task-1'
      );
    });

    it('should sanitize task ID for filesystem path', async () => {
      await manager.createForTask('task/with/slashes', 'feature/main');

      expect(mockGitProvider.createWorktree).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('task_with_slashes'),
        expect.any(Object)
      );
    });

    it('should sanitize task ID for branch name', async () => {
      await manager.createForTask('task/with/slashes', 'feature/main');

      expect(mockGitProvider.createWorktree).toHaveBeenCalledWith(
        expect.stringContaining('task-with-slashes'),
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  describe('getWorktree', () => {
    it('should return undefined for non-existent task', () => {
      expect(manager.getWorktree('non-existent')).toBeUndefined();
    });

    it('should return worktree for existing task', async () => {
      await manager.createForTask('task-1', 'feature/main');

      const worktree = manager.getWorktree('task-1');
      expect(worktree).toBeDefined();
    });
  });

  describe('getAllWorktrees', () => {
    it('should return empty map initially', () => {
      const worktrees = manager.getAllWorktrees();
      expect(worktrees.size).toBe(0);
    });

    it('should return copy of worktrees map', async () => {
      await manager.createForTask('task-1', 'feature/main');

      const worktrees = manager.getAllWorktrees();
      expect(worktrees.size).toBe(1);

      // Verify it's a copy, not the original
      worktrees.clear();
      expect(manager.getAllWorktrees().size).toBe(1);
    });
  });

  describe('mergeToFeature', () => {
    it('should merge task branch to feature branch', async () => {
      vi.mocked(mockGitProvider.createWorktree).mockResolvedValue({
        path: '/test/worktrees/task-1',
        branch: 'coven/test-session-123/task-1',
        head: 'abc123',
        isMain: false,
        isBare: false,
      });
      await manager.createForTask('task-1', 'feature/main');

      await manager.mergeToFeature('task-1', 'feature/main');

      expect(mockGitProvider.merge).toHaveBeenCalledWith('coven/test-session-123/task-1', {
        message: 'Merge task task-1: coven/test-session-123/task-1',
        fastForward: false,
      });
    });

    it('should emit worktree:merged event', async () => {
      await manager.createForTask('task-1', 'feature/main');
      const handler = vi.fn();
      manager.on('worktree:merged', handler);

      await manager.mergeToFeature('task-1', 'feature/main');

      expect(handler).toHaveBeenCalledWith({
        taskId: 'task-1',
        result: expect.objectContaining({ success: true }),
      });
    });

    it('should emit worktree:conflict on merge conflicts', async () => {
      const conflicts = [
        { path: 'file.ts', baseContent: '', ourContent: 'ours', theirContent: 'theirs' },
      ];
      vi.mocked(mockGitProvider.merge).mockResolvedValue({
        success: false,
        conflicts,
        mergedFiles: [],
      });
      await manager.createForTask('task-1', 'feature/main');
      const handler = vi.fn();
      manager.on('worktree:conflict', handler);

      await manager.mergeToFeature('task-1', 'feature/main');

      expect(handler).toHaveBeenCalledWith({
        taskId: 'task-1',
        conflicts,
      });
    });

    it('should throw if no worktree exists for task', async () => {
      await expect(manager.mergeToFeature('non-existent', 'feature/main')).rejects.toThrow(
        'No worktree found for task: non-existent'
      );
    });
  });

  describe('cleanupForTask', () => {
    beforeEach(() => {
      vi.mocked(mockGitProvider.createWorktree).mockResolvedValue({
        path: '/test/workspace/.coven/worktrees/test-session-123/task-1',
        branch: 'coven/test-session-123/task-1',
        head: 'abc123',
        isMain: false,
        isBare: false,
      });
    });

    it('should delete worktree and branch', async () => {
      await manager.createForTask('task-1', 'feature/main');

      await manager.cleanupForTask('task-1');

      expect(mockGitProvider.deleteWorktree).toHaveBeenCalledWith(
        '/test/workspace/.coven/worktrees/test-session-123/task-1',
        true
      );
      expect(mockGitProvider.deleteBranch).toHaveBeenCalledWith(
        'coven/test-session-123/task-1',
        true
      );
    });

    it('should not delete branch when deleteBranch is false', async () => {
      await manager.createForTask('task-1', 'feature/main');

      await manager.cleanupForTask('task-1', false);

      expect(mockGitProvider.deleteWorktree).toHaveBeenCalled();
      expect(mockGitProvider.deleteBranch).not.toHaveBeenCalled();
    });

    it('should remove worktree from tracking', async () => {
      await manager.createForTask('task-1', 'feature/main');
      expect(manager.getWorktree('task-1')).toBeDefined();

      await manager.cleanupForTask('task-1');

      expect(manager.getWorktree('task-1')).toBeUndefined();
    });

    it('should emit worktree:deleted event', async () => {
      await manager.createForTask('task-1', 'feature/main');
      const handler = vi.fn();
      manager.on('worktree:deleted', handler);

      await manager.cleanupForTask('task-1');

      expect(handler).toHaveBeenCalledWith({
        taskId: 'task-1',
        path: '/test/workspace/.coven/worktrees/test-session-123/task-1',
      });
    });

    it('should do nothing if no worktree exists', async () => {
      await manager.cleanupForTask('non-existent');

      expect(mockGitProvider.deleteWorktree).not.toHaveBeenCalled();
    });

    it('should continue cleanup even if branch deletion fails', async () => {
      vi.mocked(mockGitProvider.deleteBranch).mockRejectedValue(new Error('Branch protected'));
      await manager.createForTask('task-1', 'feature/main');

      // Should not throw
      await manager.cleanupForTask('task-1');

      expect(manager.getWorktree('task-1')).toBeUndefined();
    });
  });

  describe('detectOrphans', () => {
    it('should detect worktrees from other sessions', async () => {
      const orphanWorktree: Worktree = {
        path: '/test/workspace/.coven/worktrees/old-session/orphan-task',
        branch: 'coven/old-session/orphan-task',
        head: 'abc123',
        isMain: false,
        isBare: false,
      };
      vi.mocked(mockGitProvider.listWorktrees).mockResolvedValue([orphanWorktree]);

      const orphans = await manager.detectOrphans();

      expect(orphans).toHaveLength(1);
      expect(orphans[0]).toEqual(orphanWorktree);
    });

    it('should not detect worktrees from current session', async () => {
      const currentSessionWorktree: Worktree = {
        path: '/test/workspace/.coven/worktrees/test-session-123/task-1',
        branch: 'coven/test-session-123/task-1',
        head: 'abc123',
        isMain: false,
        isBare: false,
      };
      vi.mocked(mockGitProvider.listWorktrees).mockResolvedValue([currentSessionWorktree]);

      const orphans = await manager.detectOrphans();

      expect(orphans).toHaveLength(0);
    });

    it('should not detect main worktree', async () => {
      const mainWorktree: Worktree = {
        path: '/test/workspace',
        branch: 'main',
        head: 'abc123',
        isMain: true,
        isBare: false,
      };
      vi.mocked(mockGitProvider.listWorktrees).mockResolvedValue([mainWorktree]);

      const orphans = await manager.detectOrphans();

      expect(orphans).toHaveLength(0);
    });

    it('should emit worktree:orphan event for each orphan', async () => {
      const orphanWorktree: Worktree = {
        path: '/test/workspace/.coven/worktrees/old-session/orphan-task',
        branch: 'coven/old-session/orphan-task',
        head: 'abc123',
        isMain: false,
        isBare: false,
      };
      vi.mocked(mockGitProvider.listWorktrees).mockResolvedValue([orphanWorktree]);
      const handler = vi.fn();
      manager.on('worktree:orphan', handler);

      await manager.detectOrphans();

      expect(handler).toHaveBeenCalledWith({
        path: orphanWorktree.path,
        branch: orphanWorktree.branch,
      });
    });
  });

  describe('cleanupOrphans', () => {
    it('should cleanup all orphaned worktrees', async () => {
      const orphans: Worktree[] = [
        {
          path: '/test/workspace/.coven/worktrees/old-session/orphan-1',
          branch: 'coven/old-session/orphan-1',
          head: 'abc123',
          isMain: false,
          isBare: false,
        },
        {
          path: '/test/workspace/.coven/worktrees/old-session/orphan-2',
          branch: 'coven/old-session/orphan-2',
          head: 'def456',
          isMain: false,
          isBare: false,
        },
      ];
      vi.mocked(mockGitProvider.listWorktrees).mockResolvedValue(orphans);

      const cleaned = await manager.cleanupOrphans();

      expect(cleaned).toBe(2);
      expect(mockGitProvider.deleteWorktree).toHaveBeenCalledTimes(2);
      expect(mockGitProvider.deleteBranch).toHaveBeenCalledTimes(2);
    });

    it('should return 0 when no orphans exist', async () => {
      vi.mocked(mockGitProvider.listWorktrees).mockResolvedValue([]);

      const cleaned = await manager.cleanupOrphans();

      expect(cleaned).toBe(0);
    });

    it('should continue cleaning even if some fail', async () => {
      const orphans: Worktree[] = [
        {
          path: '/test/workspace/.coven/worktrees/old-session/orphan-1',
          branch: 'coven/old-session/orphan-1',
          head: 'abc123',
          isMain: false,
          isBare: false,
        },
        {
          path: '/test/workspace/.coven/worktrees/old-session/orphan-2',
          branch: 'coven/old-session/orphan-2',
          head: 'def456',
          isMain: false,
          isBare: false,
        },
      ];
      vi.mocked(mockGitProvider.listWorktrees).mockResolvedValue(orphans);
      vi.mocked(mockGitProvider.deleteWorktree)
        .mockRejectedValueOnce(new Error('Failed to delete'))
        .mockResolvedValueOnce(undefined);

      const cleaned = await manager.cleanupOrphans();

      expect(cleaned).toBe(1);
    });
  });

  describe('getTaskStatus', () => {
    it('should return null for non-existent task', async () => {
      const status = await manager.getTaskStatus('non-existent');
      expect(status).toBeNull();
    });

    it('should return status for existing task', async () => {
      vi.mocked(mockGitProvider.createWorktree).mockResolvedValue({
        path: '/test/worktree/task-1',
        branch: 'coven/test-session-123/task-1',
        head: 'abc123',
        isMain: false,
        isBare: false,
      });
      vi.mocked(mockGitProvider.getStatus).mockResolvedValue({
        staged: ['file1.ts'],
        modified: ['file2.ts', 'file3.ts'],
        untracked: [],
        deleted: [],
        branch: 'coven/test-session-123/task-1',
        ahead: 1,
        behind: 0,
      });
      await manager.createForTask('task-1', 'feature/main');

      const status = await manager.getTaskStatus('task-1');

      expect(status).toEqual({
        hasChanges: true,
        staged: 1,
        modified: 2,
        untracked: 0,
      });
    });

    it('should report hasChanges false when no changes', async () => {
      vi.mocked(mockGitProvider.createWorktree).mockResolvedValue({
        path: '/test/worktree/task-1',
        branch: 'coven/test-session-123/task-1',
        head: 'abc123',
        isMain: false,
        isBare: false,
      });
      vi.mocked(mockGitProvider.getStatus).mockResolvedValue({
        staged: [],
        modified: [],
        untracked: [],
        deleted: [],
        branch: 'coven/test-session-123/task-1',
        ahead: 0,
        behind: 0,
      });
      await manager.createForTask('task-1', 'feature/main');

      const status = await manager.getTaskStatus('task-1');

      expect(status?.hasChanges).toBe(false);
    });
  });

  describe('dispose', () => {
    it('should remove all event listeners', () => {
      const handler = vi.fn();
      manager.on('worktree:created', handler);

      manager.dispose();

      // EventEmitter.listenerCount should be 0 after dispose
      expect(manager.listenerCount('worktree:created')).toBe(0);
    });
  });
});
