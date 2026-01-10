import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs';
import {
  stopDaemon,
  restartDaemon,
  viewDaemonLogs,
  initializeWorkspace,
  DaemonCommandDependencies,
} from './daemon';
import { DaemonClient } from '../daemon/client';
import { DaemonLifecycle, DaemonStartError } from '../daemon/lifecycle';
import { DaemonClientError } from '../daemon/types';

// Use vi.hoisted to create mock functions that can be used in vi.mock
const { mockShowInformationMessage, mockShowWarningMessage, mockShowErrorMessage, mockShowTextDocument, mockOpenTextDocument, mockWithProgress } = vi.hoisted(() => ({
  mockShowInformationMessage: vi.fn(),
  mockShowWarningMessage: vi.fn(),
  mockShowErrorMessage: vi.fn(),
  mockShowTextDocument: vi.fn(),
  mockOpenTextDocument: vi.fn(),
  mockWithProgress: vi.fn().mockImplementation(
    async <T>(_options: unknown, callback: () => Promise<T>): Promise<T> => {
      return callback();
    }
  ),
}));

// Mock vscode
vi.mock('vscode', () => ({
  window: {
    showInformationMessage: mockShowInformationMessage,
    showWarningMessage: mockShowWarningMessage,
    showErrorMessage: mockShowErrorMessage,
    showTextDocument: mockShowTextDocument,
    withProgress: mockWithProgress,
  },
  workspace: {
    openTextDocument: mockOpenTextDocument,
    workspaceFolders: [{ uri: { fsPath: '/test/workspace' } }],
  },
  ProgressLocation: {
    Notification: 1,
  },
}));

// Mock fs
vi.mock('fs');
const mockFs = vi.mocked(fs);

describe('Daemon Commands', () => {
  const workspaceRoot = '/test/workspace';
  let mockClient: { post: Mock; getHealth: Mock };
  let mockLifecycle: { isRunning: Mock; ensureRunning: Mock };
  let deps: DaemonCommandDependencies;

  beforeEach(() => {
    vi.resetAllMocks();

    mockClient = {
      post: vi.fn(),
      getHealth: vi.fn(),
    };

    mockLifecycle = {
      isRunning: vi.fn(),
      ensureRunning: vi.fn(),
    };

    deps = {
      client: mockClient as unknown as DaemonClient,
      lifecycle: mockLifecycle as unknown as DaemonLifecycle,
      workspaceRoot,
    };

    // Reset withProgress mock implementation
    mockWithProgress.mockImplementation(
      async <T>(_options: unknown, callback: () => Promise<T>): Promise<T> => {
        return callback();
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('stopDaemon', () => {
    it('should stop running daemon', async () => {
      mockLifecycle.isRunning.mockResolvedValue(true);
      mockClient.post.mockResolvedValue(undefined);

      await stopDaemon(deps);

      expect(mockClient.post).toHaveBeenCalledWith('/shutdown', {});
      expect(mockShowInformationMessage).toHaveBeenCalledWith('Daemon stopped.');
    });

    it('should show message if daemon is not running', async () => {
      mockLifecycle.isRunning.mockResolvedValue(false);

      await stopDaemon(deps);

      expect(mockClient.post).not.toHaveBeenCalled();
      expect(mockShowInformationMessage).toHaveBeenCalledWith('Daemon is not running.');
    });

    it('should handle connection refused error gracefully', async () => {
      mockLifecycle.isRunning.mockResolvedValue(true);
      mockClient.post.mockRejectedValue(
        new DaemonClientError('connection_refused', 'Connection refused')
      );

      await stopDaemon(deps);

      expect(mockShowInformationMessage).toHaveBeenCalledWith('Daemon is not running.');
    });

    it('should show error for other errors', async () => {
      mockLifecycle.isRunning.mockResolvedValue(true);
      mockClient.post.mockRejectedValue(new Error('Unknown error'));

      await stopDaemon(deps);

      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to stop daemon')
      );
    });
  });

  describe('restartDaemon', () => {
    it('should restart daemon', async () => {
      mockClient.post.mockResolvedValue(undefined);
      mockLifecycle.ensureRunning.mockResolvedValue(undefined);

      await restartDaemon(deps);

      expect(mockClient.post).toHaveBeenCalledWith('/shutdown', {});
      expect(mockLifecycle.ensureRunning).toHaveBeenCalled();
      expect(mockShowInformationMessage).toHaveBeenCalledWith('Daemon restarted.');
    });

    it('should start daemon even if stop fails with connection refused', async () => {
      mockClient.post.mockRejectedValue(
        new DaemonClientError('connection_refused', 'Connection refused')
      );
      mockLifecycle.ensureRunning.mockResolvedValue(undefined);

      await restartDaemon(deps);

      expect(mockLifecycle.ensureRunning).toHaveBeenCalled();
      expect(mockShowInformationMessage).toHaveBeenCalledWith('Daemon restarted.');
    });

    it('should show error if restart fails', async () => {
      mockClient.post.mockResolvedValue(undefined);
      mockLifecycle.ensureRunning.mockRejectedValue(
        new DaemonStartError('Failed to start', '/test/workspace/.coven/covend.log')
      );
      // showErrorMessage returns a thenable when called with actions
      mockShowErrorMessage.mockResolvedValue(undefined);

      await restartDaemon(deps);

      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to restart daemon'),
        'View Logs'
      );
    });
  });

  describe('viewDaemonLogs', () => {
    it('should open log file if it exists', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const mockDoc = { uri: { fsPath: '/test/workspace/.coven/covend.log' } };
      mockOpenTextDocument.mockResolvedValue(mockDoc);
      mockShowTextDocument.mockResolvedValue(undefined);

      await viewDaemonLogs(workspaceRoot);

      expect(mockOpenTextDocument).toHaveBeenCalledWith(
        '/test/workspace/.coven/covend.log'
      );
      expect(mockShowTextDocument).toHaveBeenCalledWith(mockDoc, {
        preview: false,
        preserveFocus: false,
      });
    });

    it('should show warning if log file does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await viewDaemonLogs(workspaceRoot);

      expect(mockShowWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('No daemon logs found')
      );
    });

    it('should show error if opening file fails', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockOpenTextDocument.mockRejectedValue(new Error('Permission denied'));

      await viewDaemonLogs(workspaceRoot);

      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to open daemon logs')
      );
    });
  });

  describe('initializeWorkspace', () => {
    it('should create .coven directory and config', async () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation(() => undefined);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      await initializeWorkspace(workspaceRoot);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/test/workspace/.coven', { recursive: true });
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/test/workspace/.coven/config.yaml',
        expect.stringContaining('version: "1"'),
        'utf-8'
      );
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/test/workspace/.coven/.gitignore',
        expect.stringContaining('covend.sock'),
        'utf-8'
      );
      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        'Coven initialized successfully.'
      );
    });

    it('should prompt before reinitializing', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockShowWarningMessage.mockResolvedValue('No');

      await initializeWorkspace(workspaceRoot);

      expect(mockShowWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('already initialized'),
        'Yes',
        'No'
      );
      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should reinitialize if user confirms', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockShowWarningMessage.mockResolvedValue('Yes');
      mockFs.mkdirSync.mockImplementation(() => undefined);
      mockFs.writeFileSync.mockImplementation(() => undefined);

      await initializeWorkspace(workspaceRoot);

      expect(mockFs.mkdirSync).toHaveBeenCalled();
      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        'Coven initialized successfully.'
      );
    });

    it('should show error if initialization fails', async () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await initializeWorkspace(workspaceRoot);

      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize coven')
      );
    });
  });
});
