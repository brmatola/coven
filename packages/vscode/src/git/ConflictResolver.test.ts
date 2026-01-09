import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import { ConflictResolver } from './ConflictResolver';
import { GitProvider, ConflictFile, MergeResult } from './types';

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      writeFile: vi.fn().mockResolvedValue(undefined),
      access: vi.fn().mockRejectedValue(new Error('ENOENT')),
    },
  };
});

// Create a mock GitProvider
function createMockGitProvider(): GitProvider {
  return {
    listWorktrees: vi.fn().mockResolvedValue([]),
    createWorktree: vi.fn().mockResolvedValue({
      path: '/test/worktree',
      branch: 'test-branch',
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
      mergedFiles: [],
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

describe('ConflictResolver', () => {
  const workspaceRoot = '/test/workspace';
  const workingDir = '/test/worktree';

  let resolver: ConflictResolver;
  let mockGitProvider: GitProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGitProvider = createMockGitProvider();
    resolver = new ConflictResolver(workspaceRoot, {}, mockGitProvider);
  });

  afterEach(() => {
    resolver.dispose();
  });

  describe('detectConflicts', () => {
    it('should return empty array for successful merge', () => {
      const result: MergeResult = {
        success: true,
        conflicts: [],
        mergedFiles: ['file.ts'],
        commitHash: 'abc123',
      };

      const conflicts = resolver.detectConflicts('task-1', result);

      expect(conflicts).toHaveLength(0);
    });

    it('should return conflicts and emit event for failed merge', () => {
      const conflictFiles: ConflictFile[] = [
        { path: 'file1.ts', baseContent: '', ourContent: 'ours', theirContent: 'theirs' },
        { path: 'file2.ts', baseContent: '', ourContent: 'ours2', theirContent: 'theirs2' },
      ];
      const result: MergeResult = {
        success: false,
        conflicts: conflictFiles,
        mergedFiles: [],
      };
      const handler = vi.fn();
      resolver.on('conflict:detected', handler);

      const conflicts = resolver.detectConflicts('task-1', result);

      expect(conflicts).toHaveLength(2);
      expect(handler).toHaveBeenCalledWith({
        taskId: 'task-1',
        conflicts: conflictFiles,
      });
    });

    it('should return empty array for empty conflicts list', () => {
      const result: MergeResult = {
        success: false,
        conflicts: [],
        mergedFiles: [],
      };

      const conflicts = resolver.detectConflicts('task-1', result);

      expect(conflicts).toHaveLength(0);
    });
  });

  describe('resolveConflict', () => {
    const conflict: ConflictFile = {
      path: 'src/file.ts',
      baseContent: 'base content',
      ourContent: 'our content',
      theirContent: 'their content',
    };

    it('should resolve with "ours" strategy', async () => {
      const resolution = await resolver.resolveConflict(conflict, 'ours', workingDir);

      expect(resolution.success).toBe(true);
      expect(resolution.strategy).toBe('ours');
      expect(resolution.resolvedContent).toBe('our content');
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        '/test/worktree/src/file.ts',
        'our content'
      );
      expect(mockGitProvider.add).toHaveBeenCalledWith('src/file.ts', workingDir);
    });

    it('should resolve with "theirs" strategy', async () => {
      const resolution = await resolver.resolveConflict(conflict, 'theirs', workingDir);

      expect(resolution.success).toBe(true);
      expect(resolution.strategy).toBe('theirs');
      expect(resolution.resolvedContent).toBe('their content');
    });

    it('should resolve with "merged" strategy when custom content provided', async () => {
      const customContent = 'merged content from user';
      const resolution = await resolver.resolveConflict(conflict, 'merged', workingDir, customContent);

      expect(resolution.success).toBe(true);
      expect(resolution.strategy).toBe('merged');
      expect(resolution.resolvedContent).toBe(customContent);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        '/test/worktree/src/file.ts',
        customContent
      );
    });

    it('should fail with "merged" strategy when no custom content', async () => {
      const resolution = await resolver.resolveConflict(conflict, 'merged', workingDir);

      expect(resolution.success).toBe(false);
      expect(resolution.error).toBe('Merged strategy requires custom content');
    });

    it('should fail with "manual" strategy', async () => {
      const resolution = await resolver.resolveConflict(conflict, 'manual', workingDir);

      expect(resolution.success).toBe(false);
      expect(resolution.strategy).toBe('manual');
      expect(resolution.error).toBe('Manual resolution required');
    });

    it('should handle file write errors', async () => {
      vi.mocked(fs.promises.writeFile).mockRejectedValueOnce(new Error('Permission denied'));

      const resolution = await resolver.resolveConflict(conflict, 'ours', workingDir);

      expect(resolution.success).toBe(false);
      expect(resolution.error).toBe('Permission denied');
    });

    it('should handle git add errors', async () => {
      vi.mocked(mockGitProvider.add).mockRejectedValueOnce(new Error('Git add failed'));

      const resolution = await resolver.resolveConflict(conflict, 'ours', workingDir);

      expect(resolution.success).toBe(false);
      expect(resolution.error).toBe('Git add failed');
    });
  });

  describe('resolveAll', () => {
    const conflicts: ConflictFile[] = [
      { path: 'file1.ts', baseContent: '', ourContent: 'ours1', theirContent: 'theirs1' },
      { path: 'file2.ts', baseContent: '', ourContent: 'ours2', theirContent: 'theirs2' },
    ];

    it('should resolve all conflicts with specified strategy', async () => {
      const resolutions = await resolver.resolveAll('task-1', conflicts, workingDir, 'ours');

      expect(resolutions).toHaveLength(2);
      expect(resolutions.every(r => r.success)).toBe(true);
      expect(resolutions.every(r => r.strategy === 'ours')).toBe(true);
    });

    it('should use default strategy when not specified', async () => {
      resolver = new ConflictResolver(workspaceRoot, { defaultStrategy: 'theirs' }, mockGitProvider);

      const resolutions = await resolver.resolveAll('task-1', conflicts, workingDir);

      expect(resolutions.every(r => r.strategy === 'theirs')).toBe(true);
    });

    it('should emit conflict:resolved for each successful resolution', async () => {
      const handler = vi.fn();
      resolver.on('conflict:resolved', handler);

      await resolver.resolveAll('task-1', conflicts, workingDir, 'ours');

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should emit conflict:escalated for failed resolutions', async () => {
      const handler = vi.fn();
      resolver.on('conflict:escalated', handler);

      await resolver.resolveAll('task-1', conflicts, workingDir, 'manual');

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('hasUnresolvedConflicts', () => {
    it('should return true when MERGE_HEAD exists', async () => {
      vi.mocked(fs.promises.access).mockResolvedValueOnce(undefined);

      const result = await resolver.hasUnresolvedConflicts(workingDir);

      expect(result).toBe(true);
      expect(fs.promises.access).toHaveBeenCalledWith('/test/worktree/.git/MERGE_HEAD');
    });

    it('should return false when MERGE_HEAD does not exist', async () => {
      vi.mocked(fs.promises.access).mockRejectedValueOnce(new Error('ENOENT'));

      const result = await resolver.hasUnresolvedConflicts(workingDir);

      expect(result).toBe(false);
    });
  });

  describe('completeMerge', () => {
    it('should stage changes and commit', async () => {
      const commitHash = await resolver.completeMerge(workingDir, 'Custom merge message');

      expect(mockGitProvider.add).toHaveBeenCalledWith('.', workingDir);
      expect(mockGitProvider.commit).toHaveBeenCalledWith('Custom merge message', workingDir);
      expect(commitHash).toBe('abc123');
    });

    it('should use default message when not provided', async () => {
      await resolver.completeMerge(workingDir);

      expect(mockGitProvider.commit).toHaveBeenCalledWith('Resolve merge conflicts', workingDir);
    });
  });

  describe('abortMerge', () => {
    it('should call git abort merge', async () => {
      await resolver.abortMerge(workingDir);

      expect(mockGitProvider.abortMerge).toHaveBeenCalledWith(workingDir);
    });
  });

  describe('escalateToUser', () => {
    it('should emit conflict:escalated event', () => {
      const conflict: ConflictFile = {
        path: 'src/file.ts',
        baseContent: '',
        ourContent: 'ours',
        theirContent: 'theirs',
      };
      const handler = vi.fn();
      resolver.on('conflict:escalated', handler);

      resolver.escalateToUser('task-1', conflict);

      expect(handler).toHaveBeenCalledWith({
        taskId: 'task-1',
        conflict,
      });
    });
  });

  describe('options', () => {
    it('should use default manual strategy when not configured', async () => {
      const conflicts: ConflictFile[] = [
        { path: 'file.ts', baseContent: '', ourContent: 'ours', theirContent: 'theirs' },
      ];

      const resolutions = await resolver.resolveAll('task-1', conflicts, workingDir);

      expect(resolutions[0]?.strategy).toBe('manual');
      expect(resolutions[0]?.success).toBe(false);
    });

    it('should respect configured default strategy', async () => {
      resolver = new ConflictResolver(workspaceRoot, { defaultStrategy: 'ours' }, mockGitProvider);
      const conflicts: ConflictFile[] = [
        { path: 'file.ts', baseContent: '', ourContent: 'ours', theirContent: 'theirs' },
      ];

      const resolutions = await resolver.resolveAll('task-1', conflicts, workingDir);

      expect(resolutions[0]?.strategy).toBe('ours');
      expect(resolutions[0]?.success).toBe(true);
    });
  });

  describe('dispose', () => {
    it('should remove all event listeners', () => {
      const handler = vi.fn();
      resolver.on('conflict:detected', handler);
      resolver.on('conflict:resolved', handler);

      resolver.dispose();

      expect(resolver.listenerCount('conflict:detected')).toBe(0);
      expect(resolver.listenerCount('conflict:resolved')).toBe(0);
    });
  });
});
