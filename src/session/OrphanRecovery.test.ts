import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { OrphanRecovery } from './OrphanRecovery';
import { FamiliarManager } from '../agents/FamiliarManager';
import { TaskManager } from '../tasks/TaskManager';
import { Familiar, ProcessInfo, DEFAULT_SESSION_CONFIG } from '../shared/types';

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
      writeFile: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// Mock child_process.exec
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    exec: vi.fn(),
  };
});

describe('OrphanRecovery', () => {
  let orphanRecovery: OrphanRecovery;
  let familiarManager: FamiliarManager;
  let taskManager: TaskManager;
  const workspaceRoot = '/test/workspace';

  const mockProcessInfo: ProcessInfo = {
    pid: 12345,
    startTime: Date.now(),
    command: 'claude',
    worktreePath: '/test/workspace/.coven/worktrees/task-123',
  };

  const mockFamiliar: Familiar = {
    taskId: 'task-123',
    status: 'working',
    processInfo: mockProcessInfo,
    spawnedAt: Date.now(),
    outputBuffer: [],
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    taskManager = new TaskManager(workspaceRoot);
    await taskManager.initialize();

    familiarManager = new FamiliarManager(workspaceRoot, DEFAULT_SESSION_CONFIG);
    await familiarManager.initialize();

    orphanRecovery = new OrphanRecovery(
      workspaceRoot,
      '.coven/worktrees',
      familiarManager,
      taskManager
    );
  });

  afterEach(() => {
    taskManager.dispose();
    familiarManager.dispose();
  });

  describe('isProcessAlive', () => {
    it('should return false if process does not exist', async () => {
      // Mock process.kill to throw (process doesn't exist)
      const originalKill = process.kill;
      process.kill = vi.fn().mockImplementation(() => {
        const err = new Error('ESRCH');
        (err as NodeJS.ErrnoException).code = 'ESRCH';
        throw err;
      });

      const result = await orphanRecovery.isProcessAlive(mockProcessInfo);
      expect(result).toBe(false);

      process.kill = originalKill;
    });
  });

  describe('hasUncommittedChanges', () => {
    it('should return true when git status has output', async () => {
      vi.mocked(child_process.exec).mockImplementation(
        (_cmd: string, _opts: child_process.ExecOptions | undefined, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: 'M  file.txt\n', stderr: '' });
          }
          return {} as child_process.ChildProcess;
        }
      );

      const result = await orphanRecovery.hasUncommittedChanges('/test/worktree');
      expect(result).toBe(true);
    });

    it('should return false when git status is empty', async () => {
      vi.mocked(child_process.exec).mockImplementation(
        (_cmd: string, _opts: child_process.ExecOptions | undefined, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '', stderr: '' });
          }
          return {} as child_process.ChildProcess;
        }
      );

      const result = await orphanRecovery.hasUncommittedChanges('/test/worktree');
      expect(result).toBe(false);
    });

    it('should return false when git command fails', async () => {
      vi.mocked(child_process.exec).mockImplementation(
        (_cmd: string, _opts: child_process.ExecOptions | undefined, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(new Error('Not a git repo'), { stdout: '', stderr: '' });
          }
          return {} as child_process.ChildProcess;
        }
      );

      const result = await orphanRecovery.hasUncommittedChanges('/test/worktree');
      expect(result).toBe(false);
    });
  });

  describe('hasUnmergedCommits', () => {
    it('should return true when there are commits ahead', async () => {
      let callCount = 0;
      vi.mocked(child_process.exec).mockImplementation(
        (_cmd: string, _opts: child_process.ExecOptions | undefined, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          callCount++;
          if (callback) {
            if (callCount === 1) {
              // First call: git rev-parse --abbrev-ref HEAD
              callback(null, { stdout: 'feature-branch\n', stderr: '' });
            } else {
              // Second call: git log origin/branch..HEAD
              callback(null, { stdout: 'abc123 commit message\n', stderr: '' });
            }
          }
          return {} as child_process.ChildProcess;
        }
      );

      const result = await orphanRecovery.hasUnmergedCommits('/test/worktree');
      expect(result).toBe(true);
    });

    it('should return false when no commits ahead', async () => {
      let callCount = 0;
      vi.mocked(child_process.exec).mockImplementation(
        (_cmd: string, _opts: child_process.ExecOptions | undefined, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          callCount++;
          if (callback) {
            if (callCount === 1) {
              callback(null, { stdout: 'main\n', stderr: '' });
            } else {
              callback(null, { stdout: '', stderr: '' });
            }
          }
          return {} as child_process.ChildProcess;
        }
      );

      const result = await orphanRecovery.hasUnmergedCommits('/test/worktree');
      expect(result).toBe(false);
    });
  });

  describe('enumerateWorktrees', () => {
    it('should return list of worktree directories', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue([
        { name: 'task-1', isDirectory: () => true } as fs.Dirent,
        { name: 'task-2', isDirectory: () => true } as fs.Dirent,
        { name: 'file.txt', isDirectory: () => false } as fs.Dirent,
      ]);

      const worktrees = await orphanRecovery.enumerateWorktrees();
      expect(worktrees).toHaveLength(2);
      expect(worktrees[0]).toContain('task-1');
      expect(worktrees[1]).toContain('task-2');
    });

    it('should return empty array if directory does not exist', async () => {
      vi.mocked(fs.promises.readdir).mockRejectedValue(new Error('ENOENT'));

      const worktrees = await orphanRecovery.enumerateWorktrees();
      expect(worktrees).toEqual([]);
    });
  });

  describe('cleanupWorktree', () => {
    it('should call git worktree remove', async () => {
      vi.mocked(child_process.exec).mockImplementation(
        (_cmd: string, _opts: child_process.ExecOptions | undefined, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '', stderr: '' });
          }
          return {} as child_process.ChildProcess;
        }
      );

      await orphanRecovery.cleanupWorktree('/test/worktree');

      expect(child_process.exec).toHaveBeenCalledWith(
        expect.stringContaining('git worktree remove'),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should fallback to rm if git worktree remove fails', async () => {
      vi.mocked(child_process.exec).mockImplementation(
        (_cmd: string, _opts: child_process.ExecOptions | undefined, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(new Error('worktree not found'), { stdout: '', stderr: '' });
          }
          return {} as child_process.ChildProcess;
        }
      );

      await orphanRecovery.cleanupWorktree('/test/worktree');

      // Should try rm as fallback
      expect(fs.promises.rm).toHaveBeenCalledWith('/test/worktree', { recursive: true, force: true });
    });
  });

  describe('recover', () => {
    it('should emit orphan:reconnecting for alive process', async () => {
      // Setup familiar manager to return our mock familiar
      vi.spyOn(familiarManager, 'getPersistedFamiliarIds').mockResolvedValue(['task-123']);
      vi.spyOn(familiarManager, 'getPersistedFamiliarInfo').mockResolvedValue(mockFamiliar);
      vi.spyOn(familiarManager, 'registerRecoveredFamiliar');

      // Mock process as alive
      vi.spyOn(orphanRecovery, 'isProcessAlive').mockResolvedValue(true);

      const handler = vi.fn();
      orphanRecovery.on('orphan:reconnecting', handler);

      await orphanRecovery.recover();

      expect(handler).toHaveBeenCalledWith({ taskId: 'task-123' });
      expect(familiarManager.registerRecoveredFamiliar).toHaveBeenCalled();
    });

    it('should emit orphan:cleanedUp for orphan with no work', async () => {
      vi.spyOn(familiarManager, 'getPersistedFamiliarIds').mockResolvedValue(['task-123']);
      vi.spyOn(familiarManager, 'getPersistedFamiliarInfo').mockResolvedValue(mockFamiliar);

      vi.spyOn(orphanRecovery, 'isProcessAlive').mockResolvedValue(false);
      vi.spyOn(orphanRecovery, 'hasUncommittedChanges').mockResolvedValue(false);
      vi.spyOn(orphanRecovery, 'hasUnmergedCommits').mockResolvedValue(false);
      vi.spyOn(orphanRecovery, 'cleanupWorktree').mockResolvedValue();

      const handler = vi.fn();
      orphanRecovery.on('orphan:cleanedUp', handler);

      await orphanRecovery.recover();

      expect(handler).toHaveBeenCalledWith({ taskId: 'task-123' });
      expect(orphanRecovery.cleanupWorktree).toHaveBeenCalled();
    });
  });
});
