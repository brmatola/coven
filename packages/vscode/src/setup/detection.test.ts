import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectGit,
  detectBeads,
  detectCoven,
  detectOpenSpec,
  detectWorkspaceComponents,
} from './detection';
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

// Mock exec result tracking - allows different responses per command
let execResponses: Map<string, { stdout?: string; error?: Error }> = new Map();

function mockExecCommand(commandPattern: string, response: { stdout?: string; error?: Error }): void {
  execResponses.set(commandPattern, response);
}

function setupExecMock(): void {
  (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (cmd: string, _opts: unknown, callback?: (err: Error | null, result?: { stdout: string }) => void) => {
      const cb = typeof _opts === 'function' ? _opts : callback;

      // Find matching pattern
      for (const [pattern, response] of execResponses.entries()) {
        if (cmd.includes(pattern)) {
          if (cb) {
            if (response.error) {
              cb(response.error);
            } else {
              cb(null, { stdout: response.stdout ?? '' });
            }
          }
          if (response.error) {
            throw response.error;
          }
          return { stdout: response.stdout ?? '', stderr: '' };
        }
      }

      // Default: command not found
      const error = new Error('command not found');
      if (cb) {
        cb(error);
      }
      throw error;
    }
  );
}

// Stat mock tracking - allows different responses per path
let statResponses: Map<string, { isDirectory?: boolean; isFile?: boolean; error?: boolean }> = new Map();

function mockStatPath(
  pathPattern: string,
  response: { isDirectory?: boolean; isFile?: boolean; error?: boolean }
): void {
  statResponses.set(pathPattern, response);
}

function setupStatMock(): void {
  (stat as ReturnType<typeof vi.fn>).mockImplementation((filePath: string) => {
    // Find matching pattern - prefer longest match first
    const matches = Array.from(statResponses.entries())
      .filter(([pattern]) => filePath.includes(pattern))
      .sort((a, b) => b[0].length - a[0].length);

    if (matches.length > 0) {
      const [, response] = matches[0]!;
      if (response.error) {
        return Promise.reject(new Error('ENOENT'));
      }
      return Promise.resolve({
        isDirectory: () => response.isDirectory ?? false,
        isFile: () => response.isFile ?? false,
      });
    }

    // Default: not found
    return Promise.reject(new Error('ENOENT'));
  });
}

describe('detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetWorkspaceFolders();
    execResponses = new Map();
    statResponses = new Map();
    setupExecMock();
    setupStatMock();
  });

  describe('detectGit()', () => {
    it('returns missing when no workspace is open', async () => {
      __setWorkspaceFolders([]);

      const result = await detectGit();

      expect(result.status).toBe('missing');
      expect(result.hasGitDir).toBe(false);
      expect(result.isValidRepo).toBe(false);
      expect(result.details).toContain('No workspace');
    });

    it('returns missing when .git directory does not exist', async () => {
      mockStatPath('.git', { error: true });

      const result = await detectGit();

      expect(result.status).toBe('missing');
      expect(result.hasGitDir).toBe(false);
      expect(result.isValidRepo).toBe(false);
      expect(result.details).toContain('No .git directory');
    });

    it('returns complete when git repo is valid', async () => {
      mockStatPath('.git', { isDirectory: true });
      mockExecCommand('git rev-parse', { stdout: 'main\n' });

      const result = await detectGit();

      expect(result.status).toBe('complete');
      expect(result.hasGitDir).toBe(true);
      expect(result.isValidRepo).toBe(true);
      expect(result.currentBranch).toBe('main');
      expect(result.details).toContain('main');
    });

    it('returns partial when .git exists but repo is corrupted', async () => {
      mockStatPath('.git', { isDirectory: true });
      mockExecCommand('git rev-parse', { error: new Error('fatal: not a git repository') });

      const result = await detectGit();

      expect(result.status).toBe('partial');
      expect(result.hasGitDir).toBe(true);
      expect(result.isValidRepo).toBe(false);
      expect(result.details).toContain('corrupted');
    });
  });

  describe('detectBeads()', () => {
    it('returns missing when CLI not available and no .beads dir', async () => {
      mockExecCommand('bd --version', { error: new Error('not found') });
      mockStatPath('.beads', { error: true });

      const result = await detectBeads();

      expect(result.status).toBe('missing');
      expect(result.hasCliAvailable).toBe(false);
      expect(result.hasBeadsDir).toBe(false);
    });

    it('returns partial when CLI available but workspace not initialized', async () => {
      mockExecCommand('bd --version', { stdout: 'bd version 1.0.0' });
      mockStatPath('.beads', { error: true });

      const result = await detectBeads();

      expect(result.status).toBe('partial');
      expect(result.hasCliAvailable).toBe(true);
      expect(result.hasBeadsDir).toBe(false);
      expect(result.cliVersion).toBe('bd version 1.0.0');
      expect(result.details).toContain('not initialized');
    });

    it('returns partial when .beads exists but CLI not available', async () => {
      mockExecCommand('bd --version', { error: new Error('not found') });
      mockStatPath('.beads', { isDirectory: true });

      const result = await detectBeads();

      expect(result.status).toBe('partial');
      expect(result.hasCliAvailable).toBe(false);
      expect(result.hasBeadsDir).toBe(true);
      expect(result.details).toContain('CLI not available');
    });

    it('returns complete when CLI available and workspace initialized', async () => {
      mockExecCommand('bd --version', { stdout: 'bd version 1.0.0' });
      mockStatPath('.beads', { isDirectory: true });

      const result = await detectBeads();

      expect(result.status).toBe('complete');
      expect(result.hasCliAvailable).toBe(true);
      expect(result.hasBeadsDir).toBe(true);
      expect(result.cliVersion).toBe('bd version 1.0.0');
    });

    it('handles no workspace open with CLI available', async () => {
      __setWorkspaceFolders([]);
      mockExecCommand('bd --version', { stdout: 'bd version 1.0.0' });

      const result = await detectBeads();

      expect(result.status).toBe('partial');
      expect(result.hasCliAvailable).toBe(true);
      expect(result.hasBeadsDir).toBe(false);
      expect(result.details).toContain('no workspace');
    });

    it('handles no workspace open with CLI unavailable', async () => {
      __setWorkspaceFolders([]);
      mockExecCommand('bd --version', { error: new Error('not found') });

      const result = await detectBeads();

      expect(result.status).toBe('missing');
      expect(result.hasCliAvailable).toBe(false);
      expect(result.hasBeadsDir).toBe(false);
    });
  });

  describe('detectCoven()', () => {
    it('returns missing when no workspace is open', async () => {
      __setWorkspaceFolders([]);

      const result = await detectCoven();

      expect(result.status).toBe('missing');
      expect(result.hasCovenDir).toBe(false);
      expect(result.hasConfigFile).toBe(false);
    });

    it('returns missing when .coven directory does not exist', async () => {
      mockStatPath('.coven', { error: true });

      const result = await detectCoven();

      expect(result.status).toBe('missing');
      expect(result.hasCovenDir).toBe(false);
      expect(result.hasConfigFile).toBe(false);
    });

    it('returns partial when .coven exists but config.yaml missing', async () => {
      mockStatPath('.coven', { isDirectory: true });
      mockStatPath('config.yaml', { error: true });

      const result = await detectCoven();

      expect(result.status).toBe('partial');
      expect(result.hasCovenDir).toBe(true);
      expect(result.hasConfigFile).toBe(false);
      expect(result.details).toContain('config.yaml is missing');
    });

    it('returns complete when .coven and config.yaml exist', async () => {
      mockStatPath('.coven', { isDirectory: true });
      mockStatPath('.coven/config.yaml', { isFile: true });

      const result = await detectCoven();

      expect(result.status).toBe('complete');
      expect(result.hasCovenDir).toBe(true);
      expect(result.hasConfigFile).toBe(true);
      expect(result.configPath).toBeDefined();
    });
  });

  describe('detectOpenSpec()', () => {
    it('returns missing when CLI not available and no openspec dir', async () => {
      mockExecCommand('openspec --version', { error: new Error('not found') });
      mockStatPath('openspec', { error: true });

      const result = await detectOpenSpec();

      expect(result.status).toBe('missing');
      expect(result.hasCliAvailable).toBe(false);
      expect(result.hasOpenspecDir).toBe(false);
    });

    it('returns partial when CLI available but workspace not initialized', async () => {
      mockExecCommand('openspec --version', { stdout: 'openspec version 0.1.0' });
      mockStatPath('openspec', { error: true });

      const result = await detectOpenSpec();

      expect(result.status).toBe('partial');
      expect(result.hasCliAvailable).toBe(true);
      expect(result.hasOpenspecDir).toBe(false);
      expect(result.cliVersion).toBe('openspec version 0.1.0');
    });

    it('returns partial when openspec dir exists but CLI not available', async () => {
      mockExecCommand('openspec --version', { error: new Error('not found') });
      mockStatPath('openspec', { isDirectory: true });

      const result = await detectOpenSpec();

      expect(result.status).toBe('partial');
      expect(result.hasCliAvailable).toBe(false);
      expect(result.hasOpenspecDir).toBe(true);
    });

    it('returns complete when CLI available and workspace initialized', async () => {
      mockExecCommand('openspec --version', { stdout: 'openspec version 0.1.0' });
      mockStatPath('openspec', { isDirectory: true });

      const result = await detectOpenSpec();

      expect(result.status).toBe('complete');
      expect(result.hasCliAvailable).toBe(true);
      expect(result.hasOpenspecDir).toBe(true);
      expect(result.cliVersion).toBe('openspec version 0.1.0');
    });

    it('handles no workspace open with CLI available', async () => {
      __setWorkspaceFolders([]);
      mockExecCommand('openspec --version', { stdout: 'openspec version 0.1.0' });

      const result = await detectOpenSpec();

      expect(result.status).toBe('partial');
      expect(result.hasCliAvailable).toBe(true);
      expect(result.hasOpenspecDir).toBe(false);
    });

    it('handles no workspace open with CLI unavailable', async () => {
      __setWorkspaceFolders([]);
      mockExecCommand('openspec --version', { error: new Error('not found') });

      const result = await detectOpenSpec();

      expect(result.status).toBe('missing');
      expect(result.hasCliAvailable).toBe(false);
      expect(result.hasOpenspecDir).toBe(false);
    });
  });

  describe('detectWorkspaceComponents()', () => {
    it('detects all components in parallel', async () => {
      mockStatPath('.git', { isDirectory: true });
      mockStatPath('.beads', { isDirectory: true });
      mockStatPath('.coven', { isDirectory: true });
      mockStatPath('.coven/config.yaml', { isFile: true });
      mockStatPath('openspec', { isDirectory: true });
      mockExecCommand('git rev-parse', { stdout: 'main\n' });
      mockExecCommand('bd --version', { stdout: 'bd version 1.0.0' });
      mockExecCommand('openspec --version', { stdout: 'openspec version 0.1.0' });

      const result = await detectWorkspaceComponents();

      expect(result.git.status).toBe('complete');
      expect(result.beads.status).toBe('complete');
      expect(result.coven.status).toBe('complete');
      expect(result.openspec.status).toBe('complete');
      expect(result.isFullyInitialized).toBe(true);
      expect(result.isPartiallyInitialized).toBe(false);
    });

    it('reports fully initialized when required components complete (openspec optional)', async () => {
      mockStatPath('.git', { isDirectory: true });
      mockStatPath('.beads', { isDirectory: true });
      mockStatPath('.coven', { isDirectory: true });
      mockStatPath('.coven/config.yaml', { isFile: true });
      mockStatPath('openspec', { error: true });
      mockExecCommand('git rev-parse', { stdout: 'main\n' });
      mockExecCommand('bd --version', { stdout: 'bd version 1.0.0' });
      mockExecCommand('openspec --version', { error: new Error('not found') });

      const result = await detectWorkspaceComponents();

      expect(result.git.status).toBe('complete');
      expect(result.beads.status).toBe('complete');
      expect(result.coven.status).toBe('complete');
      expect(result.openspec.status).toBe('missing');
      expect(result.isFullyInitialized).toBe(false);
      expect(result.isPartiallyInitialized).toBe(true);
    });

    it('reports partially initialized when some components are present', async () => {
      mockStatPath('.git', { isDirectory: true });
      mockStatPath('.beads', { error: true });
      mockStatPath('.coven', { error: true });
      mockStatPath('openspec', { error: true });
      mockExecCommand('git rev-parse', { stdout: 'main\n' });
      mockExecCommand('bd --version', { error: new Error('not found') });
      mockExecCommand('openspec --version', { error: new Error('not found') });

      const result = await detectWorkspaceComponents();

      expect(result.git.status).toBe('complete');
      expect(result.beads.status).toBe('missing');
      expect(result.coven.status).toBe('missing');
      expect(result.openspec.status).toBe('missing');
      expect(result.isFullyInitialized).toBe(false);
      expect(result.isPartiallyInitialized).toBe(true);
    });

    it('reports not initialized when all components missing', async () => {
      __setWorkspaceFolders([]);
      mockExecCommand('bd --version', { error: new Error('not found') });
      mockExecCommand('openspec --version', { error: new Error('not found') });

      const result = await detectWorkspaceComponents();

      expect(result.git.status).toBe('missing');
      expect(result.beads.status).toBe('missing');
      expect(result.coven.status).toBe('missing');
      expect(result.openspec.status).toBe('missing');
      expect(result.isFullyInitialized).toBe(false);
      expect(result.isPartiallyInitialized).toBe(false);
    });
  });
});
