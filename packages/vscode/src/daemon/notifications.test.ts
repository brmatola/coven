import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DaemonNotificationService, showLoading, showSuccess, showWarning, withLoading } from './notifications';
import { DaemonClientError } from './types';
import { DaemonStartError } from './lifecycle';
import * as vscode from 'vscode';

// vscode is automatically mocked via vitest.config.ts alias

describe('DaemonNotificationService', () => {
  let service: DaemonNotificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DaemonNotificationService('/workspace');
  });

  describe('getLogPath', () => {
    it('returns correct log path', () => {
      expect(service.getLogPath()).toBe('/workspace/.coven/covend.log');
    });
  });

  describe('viewLogs', () => {
    it('opens log file in editor', async () => {
      const mockDoc = { uri: 'mock-uri' };
      (vscode.workspace.openTextDocument as ReturnType<typeof vi.fn>).mockResolvedValue(mockDoc);

      await service.viewLogs();

      expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith('/workspace/.coven/covend.log');
      expect(vscode.window.showTextDocument).toHaveBeenCalledWith(mockDoc);
    });

    it('shows error if file cannot be opened', async () => {
      (vscode.workspace.openTextDocument as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('File not found'));

      await service.viewLogs();

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Could not open log file'),
        'OK'
      );
    });
  });

  describe('showError', () => {
    it('shows error for connection_refused', async () => {
      const error = new DaemonClientError('connection_refused', 'Connection refused');

      await service.showError(error);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Cannot connect to Coven daemon'),
        'View Logs'
      );
    });

    it('shows error for socket_not_found with Start Daemon action', async () => {
      const error = new DaemonClientError('socket_not_found', 'Socket not found');
      const startDaemon = vi.fn();

      await service.showError(error, { startDaemon });

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Coven daemon is not running'),
        'Start Daemon',
        'View Logs'
      );
    });

    it('shows error for connection_timeout with Retry action', async () => {
      const error = new DaemonClientError('connection_timeout', 'Timeout');
      const retry = vi.fn();

      await service.showError(error, { retry });

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Daemon is not responding'),
        'Retry',
        'View Logs'
      );
    });

    it('shows error for task_not_found with Refresh action', async () => {
      const error = new DaemonClientError('task_not_found', 'Not found');
      const refresh = vi.fn();

      await service.showError(error, { refresh });

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Task not found'),
        'Refresh'
      );
    });

    it('shows error for DaemonStartError', async () => {
      const error = new DaemonStartError('Failed to start', '/logs/path');

      await service.showError(error);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to Start Daemon'),
        'View Logs'
      );
    });

    it('shows generic error for unknown errors', async () => {
      const error = new Error('Unknown error');

      await service.showError(error);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Unknown error'),
        'View Logs'
      );
    });

    it('calls View Logs action when selected', async () => {
      const error = new DaemonClientError('internal_error', 'Error');
      (vscode.window.showErrorMessage as ReturnType<typeof vi.fn>).mockResolvedValue('View Logs');
      const mockDoc = { uri: 'mock-uri' };
      (vscode.workspace.openTextDocument as ReturnType<typeof vi.fn>).mockResolvedValue(mockDoc);

      await service.showError(error);

      expect(vscode.workspace.openTextDocument).toHaveBeenCalled();
    });

    it('calls Start Daemon action when selected', async () => {
      const error = new DaemonClientError('socket_not_found', 'Not found');
      const startDaemon = vi.fn();
      (vscode.window.showErrorMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Start Daemon');

      await service.showError(error, { startDaemon });

      expect(startDaemon).toHaveBeenCalled();
    });

    it('calls Retry action when selected', async () => {
      const error = new DaemonClientError('connection_timeout', 'Timeout');
      const retry = vi.fn();
      (vscode.window.showErrorMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Retry');

      await service.showError(error, { retry });

      expect(retry).toHaveBeenCalled();
    });

    it('calls Refresh action when selected', async () => {
      const error = new DaemonClientError('task_not_found', 'Not found');
      const refresh = vi.fn();
      (vscode.window.showErrorMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Refresh');

      await service.showError(error, { refresh });

      expect(refresh).toHaveBeenCalled();
    });
  });

  describe('showConnectionLost', () => {
    it('shows warning with Retry and View Logs', async () => {
      await service.showConnectionLost();

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        'Connection to Coven daemon lost.',
        'Retry',
        'View Logs'
      );
    });

    it('calls retry action when selected', async () => {
      const retry = vi.fn();
      (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Retry');

      await service.showConnectionLost({ retry });

      expect(retry).toHaveBeenCalled();
    });

    it('opens logs when View Logs selected', async () => {
      (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue('View Logs');
      const mockDoc = { uri: 'mock-uri' };
      (vscode.workspace.openTextDocument as ReturnType<typeof vi.fn>).mockResolvedValue(mockDoc);

      await service.showConnectionLost();

      expect(vscode.workspace.openTextDocument).toHaveBeenCalled();
    });
  });

  describe('showReconnecting', () => {
    it('shows status bar message with attempt count', () => {
      service.showReconnecting(2, 3);

      expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith(
        expect.stringContaining('Reconnecting to daemon (2/3)')
      );
    });
  });

  describe('showReconnected', () => {
    it('shows success message', async () => {
      await service.showReconnected();

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Reconnected to Coven daemon.'
      );
    });
  });

  describe('showReconnectionFailed', () => {
    it('shows error with Retry and View Logs', async () => {
      await service.showReconnectionFailed();

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Could not reconnect'),
        'Retry',
        'View Logs'
      );
    });

    it('calls retry action when selected', async () => {
      const retry = vi.fn();
      (vscode.window.showErrorMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Retry');

      await service.showReconnectionFailed({ retry });

      expect(retry).toHaveBeenCalled();
    });
  });

  describe('showVersionMismatch', () => {
    it('shows warning with version info', async () => {
      await service.showVersionMismatch('>=1.0.0', '0.9.0');

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Daemon version 0.9.0'),
        'Update Extension',
        'Ignore'
      );
    });

    it('triggers update check when Update Extension selected', async () => {
      (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Update Extension');

      await service.showVersionMismatch('>=1.0.0', '0.9.0');

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'workbench.extensions.action.checkForUpdates'
      );
    });
  });

  describe('showStarting', () => {
    it('shows status bar message with spinner', async () => {
      await service.showStarting();

      expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith(
        expect.stringContaining('Starting Coven daemon')
      );
    });
  });

  describe('showStarted', () => {
    it('shows success status bar message', () => {
      service.showStarted();

      expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith(
        expect.stringContaining('Coven daemon started'),
        3000
      );
    });
  });

  describe('showStopped', () => {
    it('shows stopped status bar message', () => {
      service.showStopped();

      expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith(
        expect.stringContaining('Coven daemon stopped'),
        3000
      );
    });
  });
});

describe('Notification helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish default return value for setStatusBarMessage after clearing mocks
    (vscode.window.setStatusBarMessage as ReturnType<typeof vi.fn>).mockReturnValue({ dispose: vi.fn() });
  });

  describe('showLoading', () => {
    it('shows status bar message with spinner', () => {
      showLoading('Loading...');

      expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith(
        '$(sync~spin) Loading...'
      );
    });
  });

  describe('showSuccess', () => {
    it('shows status bar message with check', () => {
      showSuccess('Done!');

      expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith(
        '$(check) Done!',
        3000
      );
    });

    it('uses custom duration', () => {
      showSuccess('Done!', 5000);

      expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith(
        '$(check) Done!',
        5000
      );
    });
  });

  describe('showWarning', () => {
    it('shows status bar message with warning', () => {
      showWarning('Warning!');

      expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith(
        '$(warning) Warning!',
        5000
      );
    });
  });

  describe('withLoading', () => {
    it('shows loading and returns result on success', async () => {
      const result = await withLoading(
        'Loading...',
        async () => 'result'
      );

      expect(result).toBe('result');
      expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith(
        '$(sync~spin) Loading...'
      );
    });

    it('handles errors and calls error handler', async () => {
      const errorHandler = vi.fn();

      const result = await withLoading(
        'Loading...',
        async () => {
          throw new Error('Test error');
        },
        errorHandler
      );

      expect(result).toBeUndefined();
      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
    });

    it('returns undefined on error without handler', async () => {
      const result = await withLoading(
        'Loading...',
        async () => {
          throw new Error('Test error');
        }
      );

      expect(result).toBeUndefined();
    });
  });
});
