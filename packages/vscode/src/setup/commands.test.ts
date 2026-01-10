import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initGit,
  initBeads,
  initOpenspec,
  initCoven,
  onDidInitializeComponent,
  registerSetupCommands,
} from './commands';
import { __setWorkspaceFolders, __resetWorkspaceFolders, window, commands, env } from 'vscode';

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  stat: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

// Mock detection module
vi.mock('./detection', () => ({
  detectGit: vi.fn(),
  detectBeads: vi.fn(),
  detectCoven: vi.fn(),
  detectOpenSpec: vi.fn(),
}));

import { exec } from 'child_process';
import { stat, mkdir, writeFile } from 'fs/promises';
import { detectGit, detectBeads, detectCoven, detectOpenSpec } from './detection';

// Helper to mock exec results
function mockExecSuccess(stdout = ''): void {
  (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _opts: unknown, callback?: (err: Error | null, result: { stdout: string }) => void) => {
      const cb = typeof _opts === 'function' ? _opts : callback;
      if (cb) {
        cb(null, { stdout });
      }
      return { stdout, stderr: '' };
    }
  );
}

function mockExecError(errorMessage: string): void {
  const error = new Error(errorMessage);
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

describe('setup commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetWorkspaceFolders();

    // Reset all detection mocks to return missing status
    (detectGit as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'missing',
      hasGitDir: false,
      isValidRepo: false,
      details: 'No .git directory found',
    });

    (detectBeads as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'missing',
      hasBeadsDir: false,
      hasCliAvailable: false,
      details: 'Beads not available',
    });

    (detectCoven as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'missing',
      hasCovenDir: false,
      hasConfigFile: false,
      details: 'Coven not initialized',
    });

    (detectOpenSpec as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'missing',
      hasOpenspecDir: false,
      hasCliAvailable: false,
      details: 'OpenSpec not available',
    });

    // Mock fs functions
    (stat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));
    (mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  describe('initGit()', () => {
    it('throws error when no workspace is open', async () => {
      __setWorkspaceFolders([]);

      await expect(initGit()).rejects.toThrow('No workspace folder open');
    });

    it('shows message and returns early if already initialized', async () => {
      (detectGit as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'complete',
        hasGitDir: true,
        isValidRepo: true,
        currentBranch: 'main',
        details: 'Git repository on branch: main',
      });

      await initGit();

      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'Git repository already initialized.'
      );
      expect(exec).not.toHaveBeenCalled();
    });

    it('runs git init and shows success message', async () => {
      mockExecSuccess('Initialized empty Git repository');

      const fireListener = vi.fn();
      const disposable = onDidInitializeComponent.event(fireListener);

      await initGit();

      expect(exec).toHaveBeenCalledWith(
        'git init',
        expect.objectContaining({ cwd: '/mock/workspace' }),
        expect.any(Function)
      );
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'Git repository initialized successfully.'
      );
      expect(fireListener).toHaveBeenCalledWith('git');

      disposable.dispose();
    });

    it('shows install instructions when git command not found', async () => {
      mockExecError('command not found');
      (window.showErrorMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
        'Open Installation Page'
      );

      await expect(initGit()).rejects.toThrow();

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('git CLI is not available'),
        'Open Installation Page'
      );
    });

    it('shows error message on other failures', async () => {
      mockExecError('Permission denied');

      await expect(initGit()).rejects.toThrow();

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize git')
      );
    });
  });

  describe('initBeads()', () => {
    it('throws error when no workspace is open', async () => {
      __setWorkspaceFolders([]);

      await expect(initBeads()).rejects.toThrow('No workspace folder open');
    });

    it('shows install instructions when CLI not available', async () => {
      (detectBeads as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'missing',
        hasBeadsDir: false,
        hasCliAvailable: false,
        details: 'CLI not available',
      });
      (window.showErrorMessage as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(initBeads()).rejects.toThrow('Beads CLI not available');

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('bd CLI is not available'),
        'Open Installation Page'
      );
    });

    it('shows message and returns early if already initialized', async () => {
      (detectBeads as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'complete',
        hasBeadsDir: true,
        hasCliAvailable: true,
        cliVersion: 'bd version 1.0.0',
        details: 'Beads initialized',
      });

      await initBeads();

      expect(window.showInformationMessage).toHaveBeenCalledWith('Beads already initialized.');
      expect(exec).not.toHaveBeenCalled();
    });

    it('runs bd init and shows success message', async () => {
      (detectBeads as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'partial',
        hasBeadsDir: false,
        hasCliAvailable: true,
        cliVersion: 'bd version 1.0.0',
        details: 'CLI available',
      });
      mockExecSuccess('Initialized');

      const fireListener = vi.fn();
      const disposable = onDidInitializeComponent.event(fireListener);

      await initBeads();

      expect(exec).toHaveBeenCalledWith(
        'bd init',
        expect.objectContaining({ cwd: '/mock/workspace' }),
        expect.any(Function)
      );
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'Beads initialized successfully.'
      );
      expect(fireListener).toHaveBeenCalledWith('beads');

      disposable.dispose();
    });

    it('shows error message on init failure', async () => {
      (detectBeads as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'partial',
        hasBeadsDir: false,
        hasCliAvailable: true,
        cliVersion: 'bd version 1.0.0',
        details: 'CLI available',
      });
      mockExecError('Init failed');

      await expect(initBeads()).rejects.toThrow();

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize beads')
      );
    });
  });

  describe('initOpenspec()', () => {
    it('throws error when no workspace is open', async () => {
      __setWorkspaceFolders([]);

      await expect(initOpenspec()).rejects.toThrow('No workspace folder open');
    });

    it('shows install instructions when CLI not available', async () => {
      (detectOpenSpec as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'missing',
        hasOpenspecDir: false,
        hasCliAvailable: false,
        details: 'CLI not available',
      });
      (window.showErrorMessage as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(initOpenspec()).rejects.toThrow('OpenSpec CLI not available');

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('openspec CLI is not available'),
        'Open Installation Page'
      );
    });

    it('shows message and returns early if already initialized', async () => {
      (detectOpenSpec as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'complete',
        hasOpenspecDir: true,
        hasCliAvailable: true,
        cliVersion: 'openspec version 0.1.0',
        details: 'OpenSpec initialized',
      });

      await initOpenspec();

      expect(window.showInformationMessage).toHaveBeenCalledWith('OpenSpec already initialized.');
      expect(exec).not.toHaveBeenCalled();
    });

    it('runs openspec init and shows success message', async () => {
      (detectOpenSpec as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'partial',
        hasOpenspecDir: false,
        hasCliAvailable: true,
        cliVersion: 'openspec version 0.1.0',
        details: 'CLI available',
      });
      mockExecSuccess('Initialized');

      const fireListener = vi.fn();
      const disposable = onDidInitializeComponent.event(fireListener);

      await initOpenspec();

      expect(exec).toHaveBeenCalledWith(
        'openspec init --tools claude',
        expect.objectContaining({ cwd: '/mock/workspace' }),
        expect.any(Function)
      );
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'OpenSpec initialized successfully.'
      );
      expect(fireListener).toHaveBeenCalledWith('openspec');

      disposable.dispose();
    });
  });

  describe('initCoven()', () => {
    it('throws error when no workspace is open', async () => {
      __setWorkspaceFolders([]);

      await expect(initCoven()).rejects.toThrow('No workspace folder open');
    });

    it('shows message and returns early if already initialized', async () => {
      (detectCoven as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'complete',
        hasCovenDir: true,
        hasConfigFile: true,
        configPath: '/mock/workspace/.coven/config.yaml',
        details: 'Coven initialized',
      });

      await initCoven();

      expect(window.showInformationMessage).toHaveBeenCalledWith('Coven already initialized.');
      expect(mkdir).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
    });

    it('creates .coven directory and config.yaml', async () => {
      const fireListener = vi.fn();
      const disposable = onDidInitializeComponent.event(fireListener);

      await initCoven();

      expect(mkdir).toHaveBeenCalledWith('/mock/workspace/.coven', { recursive: true });
      expect(writeFile).toHaveBeenCalledWith(
        '/mock/workspace/.coven/config.yaml',
        expect.stringContaining('version: "1"'),
        'utf-8'
      );
      expect(window.showInformationMessage).toHaveBeenCalledWith('Coven initialized successfully.');
      expect(fireListener).toHaveBeenCalledWith('coven');

      disposable.dispose();
    });

    it('skips mkdir if directory already exists', async () => {
      (detectCoven as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'partial',
        hasCovenDir: true,
        hasConfigFile: false,
        details: 'Directory exists but no config',
      });

      await initCoven();

      expect(mkdir).not.toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalled();
    });

    it('shows error message on failure', async () => {
      (mkdir as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Permission denied'));

      await expect(initCoven()).rejects.toThrow();

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize coven')
      );
    });
  });

  describe('registerSetupCommands()', () => {
    it('registers all four init commands', () => {
      const mockContext = {
        subscriptions: {
          push: vi.fn(),
        },
      } as unknown as { subscriptions: { push: ReturnType<typeof vi.fn> } };

      registerSetupCommands(mockContext as never);

      expect(commands.registerCommand).toHaveBeenCalledWith('coven.initGit', initGit);
      expect(commands.registerCommand).toHaveBeenCalledWith('coven.initBeads', initBeads);
      expect(commands.registerCommand).toHaveBeenCalledWith('coven.initOpenspec', initOpenspec);
      expect(commands.registerCommand).toHaveBeenCalledWith('coven.initCoven', initCoven);
    });
  });

  describe('showInstallInstructions()', () => {
    it('opens external URL when user clicks button', async () => {
      (detectGit as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'missing',
        hasGitDir: false,
        isValidRepo: false,
        details: 'No .git directory found',
      });
      mockExecError('command not found');
      (window.showErrorMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
        'Open Installation Page'
      );

      await expect(initGit()).rejects.toThrow();

      expect(env.openExternal).toHaveBeenCalled();
    });

    it('does not open URL when user dismisses dialog', async () => {
      (detectGit as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'missing',
        hasGitDir: false,
        isValidRepo: false,
        details: 'No .git directory found',
      });
      mockExecError('command not found');
      (window.showErrorMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await expect(initGit()).rejects.toThrow();

      expect(env.openExternal).not.toHaveBeenCalled();
    });
  });
});
