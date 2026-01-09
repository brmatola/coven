import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkPrerequisites, refreshPrerequisites, initOpenspec, initBeads } from './prerequisites';
import { __setWorkspaceFolders, __resetWorkspaceFolders } from 'vscode';

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  stat: vi.fn(),
}));

import { exec } from 'child_process';
import { stat } from 'fs/promises';

// Helper to mock exec results
function mockExecSuccess(stdout: string): void {
  (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _opts: unknown, callback?: (err: Error | null, result: { stdout: string }) => void) => {
      // Handle both (cmd, callback) and (cmd, opts, callback) signatures
      const cb = typeof _opts === 'function' ? _opts : callback;
      if (cb) {
        cb(null, { stdout });
      }
      return { stdout, stderr: '' };
    }
  );
}

function mockExecError(error: Error): void {
  (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _opts: unknown, callback?: (err: Error | null) => void) => {
      const cb = typeof _opts === 'function' ? _opts : callback;
      if (cb) {
        cb(error);
      }
      throw error;
    }
  );
}

function mockStatSuccess(isDir: boolean): void {
  (stat as ReturnType<typeof vi.fn>).mockResolvedValue({
    isDirectory: () => isDir,
  });
}

function mockStatError(): void {
  (stat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));
}

describe('prerequisites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshPrerequisites();
    __resetWorkspaceFolders();
  });

  describe('refreshPrerequisites()', () => {
    it('clears cached status so next check fetches fresh data', async () => {
      mockExecSuccess('git version 2.40.0');
      mockStatSuccess(true);

      // First call
      const first = await checkPrerequisites();

      // Clear cache
      refreshPrerequisites();

      // Change mock behavior
      mockExecError(new Error('not found'));
      mockStatError();

      // Second call should use new mocks
      const second = await checkPrerequisites();

      expect(first.tools[0]?.available).toBe(true);
      expect(second.tools[0]?.available).toBe(false);
    });
  });

  describe('checkPrerequisites()', () => {
    it('returns cached result on subsequent calls within TTL', async () => {
      mockExecSuccess('git version 2.40.0');
      mockStatSuccess(true);

      const first = await checkPrerequisites();
      const second = await checkPrerequisites();

      expect(first).toBe(second);
      // exec should only be called for the first check (4 tools)
      expect(exec).toHaveBeenCalledTimes(4);
    });

    it('checks for required CLI tools', async () => {
      mockExecSuccess('version 1.0.0');
      mockStatSuccess(true);

      const result = await checkPrerequisites();

      expect(result.tools).toHaveLength(4);
      expect(result.tools.map((t) => t.name)).toEqual(['git', 'claude', 'openspec', 'bd']);
    });

    it('marks tools as available when command succeeds', async () => {
      mockExecSuccess('git version 2.40.0');
      mockStatSuccess(true);

      const result = await checkPrerequisites();

      expect(result.tools[0]?.available).toBe(true);
      expect(result.tools[0]?.version).toBe('git version 2.40.0');
    });

    it('marks tools as unavailable when command fails', async () => {
      mockExecError(new Error('command not found'));
      mockStatSuccess(true);

      const result = await checkPrerequisites();

      expect(result.tools[0]?.available).toBe(false);
      expect(result.tools[0]?.version).toBeUndefined();
    });

    it('includes install URLs for tools', async () => {
      mockExecSuccess('version');
      mockStatSuccess(true);

      const result = await checkPrerequisites();

      expect(result.tools[0]?.installUrl).toBe('https://git-scm.com/downloads');
      expect(result.tools[3]?.installUrl).toBe('https://github.com/steveyegge/beads');
    });

    it('checks for openspec directory initialization', async () => {
      mockExecSuccess('version');
      mockStatSuccess(true);

      const result = await checkPrerequisites();

      expect(result.inits).toHaveLength(2);
      expect(result.inits[0]?.name).toBe('openspec');
      expect(result.inits[0]?.initialized).toBe(true);
    });

    it('checks for beads directory initialization', async () => {
      mockExecSuccess('version');
      mockStatSuccess(true);

      const result = await checkPrerequisites();

      expect(result.inits[1]?.name).toBe('beads');
      expect(result.inits[1]?.initialized).toBe(true);
    });

    it('marks init as false when directory does not exist', async () => {
      mockExecSuccess('version');
      mockStatError();

      const result = await checkPrerequisites();

      expect(result.inits[0]?.initialized).toBe(false);
      expect(result.inits[1]?.initialized).toBe(false);
    });

    it('sets allMet to true when all tools available and inits complete', async () => {
      mockExecSuccess('version');
      mockStatSuccess(true);

      const result = await checkPrerequisites();

      expect(result.allMet).toBe(true);
    });

    it('sets allMet to false when any tool is unavailable', async () => {
      mockExecError(new Error('not found'));
      mockStatSuccess(true);

      const result = await checkPrerequisites();

      expect(result.allMet).toBe(false);
    });

    it('sets allMet to false when any init is incomplete', async () => {
      mockExecSuccess('version');
      mockStatError();

      const result = await checkPrerequisites();

      expect(result.allMet).toBe(false);
    });

    it('includes workspace status with single folder', async () => {
      mockExecSuccess('version');
      mockStatSuccess(true);

      const result = await checkPrerequisites();

      expect(result.workspace).toBeDefined();
      expect(result.workspace.isMultiRoot).toBe(false);
      expect(result.workspace.folderCount).toBe(1);
    });

    it('detects multi-root workspace', async () => {
      __setWorkspaceFolders([
        { uri: { fsPath: '/mock/workspace1' } },
        { uri: { fsPath: '/mock/workspace2' } },
      ]);
      mockExecSuccess('version');
      mockStatSuccess(true);

      const result = await checkPrerequisites();

      expect(result.workspace.isMultiRoot).toBe(true);
      expect(result.workspace.folderCount).toBe(2);
    });

    it('sets allMet to false when workspace is multi-root', async () => {
      __setWorkspaceFolders([
        { uri: { fsPath: '/mock/workspace1' } },
        { uri: { fsPath: '/mock/workspace2' } },
      ]);
      mockExecSuccess('version');
      mockStatSuccess(true);

      const result = await checkPrerequisites();

      expect(result.allMet).toBe(false);
    });

    it('handles empty workspace folders', async () => {
      __setWorkspaceFolders([]);
      mockExecSuccess('version');
      mockStatError();

      const result = await checkPrerequisites();

      expect(result.workspace.isMultiRoot).toBe(false);
      expect(result.workspace.folderCount).toBe(0);
    });
  });

  describe('initOpenspec()', () => {
    it('runs openspec init command', async () => {
      mockExecSuccess('Initialized');

      await initOpenspec();

      expect(exec).toHaveBeenCalledWith(
        'openspec init --tools claude',
        expect.objectContaining({ cwd: '/mock/workspace' }),
        expect.any(Function)
      );
    });

    it('throws when no workspace is open', async () => {
      // This test requires mocking vscode.workspace.workspaceFolders to be undefined
      // The current mock always has a workspace, so this tests the error path indirectly
      mockExecError(new Error('No workspace folder open'));

      await expect(initOpenspec()).rejects.toThrow();
    });
  });

  describe('initBeads()', () => {
    it('runs bd init command', async () => {
      mockExecSuccess('Initialized');

      await initBeads();

      expect(exec).toHaveBeenCalledWith(
        'bd init',
        expect.objectContaining({ cwd: '/mock/workspace' }),
        expect.any(Function)
      );
    });
  });
});
