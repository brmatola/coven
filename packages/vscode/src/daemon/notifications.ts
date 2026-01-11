import * as vscode from 'vscode';
import * as path from 'path';
import { DaemonClientError, DaemonErrorCode } from './types';
import { DaemonStartError } from './lifecycle';

/**
 * User-friendly error messages for daemon errors.
 */
const ERROR_MESSAGES: Record<DaemonErrorCode, { title: string; message: string }> = {
  connection_refused: {
    title: 'Connection Refused',
    message: 'Cannot connect to Coven daemon. It may have crashed.',
  },
  connection_timeout: {
    title: 'Connection Timeout',
    message: 'Daemon is not responding. It may be overloaded.',
  },
  socket_not_found: {
    title: 'Daemon Not Running',
    message: 'Coven daemon is not running. Would you like to start it?',
  },
  request_failed: {
    title: 'Request Failed',
    message: 'Failed to communicate with daemon. Please try again.',
  },
  parse_error: {
    title: 'Parse Error',
    message: 'Received invalid response from daemon.',
  },
  task_not_found: {
    title: 'Task Not Found',
    message: 'Task not found. It may have been deleted.',
  },
  agent_not_found: {
    title: 'Agent Not Found',
    message: 'Agent not found. It may have stopped.',
  },
  question_not_found: {
    title: 'Question Not Found',
    message: 'Question not found. It may have been answered.',
  },
  workflow_not_found: {
    title: 'Workflow Not Found',
    message: 'Workflow not found. It may have been deleted.',
  },
  session_not_active: {
    title: 'No Active Session',
    message: 'No active session. Please start a session first.',
  },
  session_already_active: {
    title: 'Session Already Active',
    message: 'A session is already running.',
  },
  invalid_request: {
    title: 'Invalid Request',
    message: 'The request was invalid. Please try again.',
  },
  internal_error: {
    title: 'Internal Error',
    message: 'Daemon encountered an error. Please check the logs.',
  },
  not_implemented: {
    title: 'Not Implemented',
    message: 'This feature is not yet implemented.',
  },
};

/**
 * Actions available in error notifications.
 */
type NotificationAction = 'View Logs' | 'Start Daemon' | 'Restart Daemon' | 'Retry' | 'Refresh' | 'Update Extension' | 'Ignore';

/**
 * Action handlers for notifications.
 */
interface NotificationActions {
  viewLogs?: () => void | Promise<void>;
  startDaemon?: () => void | Promise<void>;
  restartDaemon?: () => void | Promise<void>;
  retry?: () => void | Promise<void>;
  refresh?: () => void | Promise<void>;
}

/**
 * Service for displaying daemon-related notifications.
 * Provides user-friendly error messages and appropriate actions.
 */
export class DaemonNotificationService {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Get the daemon log file path.
   */
  getLogPath(): string {
    return path.join(this.workspaceRoot, '.coven', 'covend.log');
  }

  /**
   * Open daemon logs in editor.
   */
  async viewLogs(): Promise<void> {
    const logPath = this.getLogPath();
    try {
      const doc = await vscode.workspace.openTextDocument(logPath);
      await vscode.window.showTextDocument(doc);
    } catch {
      await vscode.window.showErrorMessage(
        `Could not open log file: ${logPath}`,
        'OK'
      );
    }
  }

  /**
   * Show error notification for a DaemonClientError.
   */
  async showError(
    error: Error,
    actions?: NotificationActions
  ): Promise<void> {
    let title = 'Daemon Error';
    let message = error.message;
    let availableActions: NotificationAction[] = ['View Logs'];

    if (error instanceof DaemonClientError) {
      const errorInfo = ERROR_MESSAGES[error.code];
      if (errorInfo) {
        title = errorInfo.title;
        message = errorInfo.message;
      }

      // Customize actions based on error type
      switch (error.code) {
        case 'socket_not_found':
          availableActions = actions?.startDaemon
            ? ['Start Daemon', 'View Logs']
            : ['View Logs'];
          break;
        case 'connection_refused':
          availableActions = actions?.restartDaemon
            ? ['Restart Daemon', 'View Logs']
            : ['View Logs'];
          break;
        case 'connection_timeout':
          availableActions = actions?.retry
            ? ['Retry', 'View Logs']
            : ['View Logs'];
          break;
        case 'task_not_found':
        case 'agent_not_found':
        case 'question_not_found':
        case 'workflow_not_found':
          availableActions = actions?.refresh
            ? ['Refresh']
            : [];
          break;
      }
    } else if (error instanceof DaemonStartError) {
      title = 'Failed to Start Daemon';
      message = error.message;
      availableActions = ['View Logs'];
    }

    const result = await vscode.window.showErrorMessage(
      `${title}: ${message}`,
      ...availableActions
    );

    await this.handleAction(result, actions);
  }

  /**
   * Show connection lost notification.
   */
  async showConnectionLost(
    actions?: NotificationActions
  ): Promise<void> {
    const result = await vscode.window.showWarningMessage(
      'Connection to Coven daemon lost.',
      'Retry',
      'View Logs'
    );

    if (result === 'Retry' && actions?.retry) {
      await actions.retry();
    } else if (result === 'View Logs') {
      await this.viewLogs();
    }
  }

  /**
   * Show reconnection progress.
   */
  showReconnecting(attempt: number, maxAttempts: number): vscode.Disposable {
    return vscode.window.setStatusBarMessage(
      `$(sync~spin) Reconnecting to daemon (${attempt}/${maxAttempts})...`
    );
  }

  /**
   * Show reconnection success.
   */
  async showReconnected(): Promise<void> {
    await vscode.window.showInformationMessage(
      'Reconnected to Coven daemon.'
    );
  }

  /**
   * Show reconnection failed notification after max retries.
   */
  async showReconnectionFailed(
    actions?: NotificationActions
  ): Promise<void> {
    const result = await vscode.window.showErrorMessage(
      'Could not reconnect to Coven daemon after multiple attempts.',
      'Retry',
      'View Logs'
    );

    if (result === 'Retry' && actions?.retry) {
      await actions.retry();
    } else if (result === 'View Logs') {
      await this.viewLogs();
    }
  }

  /**
   * Show version mismatch warning.
   */
  async showVersionMismatch(
    expected: string,
    actual: string
  ): Promise<void> {
    const result = await vscode.window.showWarningMessage(
      `Daemon version ${actual} may be incompatible with extension (requires ${expected}).`,
      'Update Extension',
      'Ignore'
    );

    if (result === 'Update Extension') {
      await vscode.commands.executeCommand('workbench.extensions.action.checkForUpdates');
    }
  }

  /**
   * Show daemon starting notification.
   */
  showStarting(): vscode.Disposable {
    return vscode.window.setStatusBarMessage('$(sync~spin) Starting Coven daemon...');
  }

  /**
   * Show daemon started notification.
   */
  showStarted(): void {
    vscode.window.setStatusBarMessage('$(check) Coven daemon started', 3000);
  }

  /**
   * Show daemon stopped notification.
   */
  showStopped(): void {
    vscode.window.setStatusBarMessage('$(stop-circle) Coven daemon stopped', 3000);
  }

  /**
   * Handle action selection from notification.
   */
  private async handleAction(
    result: string | undefined,
    actions?: NotificationActions
  ): Promise<void> {
    switch (result as NotificationAction) {
      case 'View Logs':
        await this.viewLogs();
        break;
      case 'Start Daemon':
        if (actions?.startDaemon) {
          await actions.startDaemon();
        }
        break;
      case 'Restart Daemon':
        if (actions?.restartDaemon) {
          await actions.restartDaemon();
        }
        break;
      case 'Retry':
        if (actions?.retry) {
          await actions.retry();
        }
        break;
      case 'Refresh':
        if (actions?.refresh) {
          await actions.refresh();
        }
        break;
    }
  }
}

/**
 * Show a loading notification that can be dismissed.
 */
export function showLoading(message: string): vscode.Disposable {
  return vscode.window.setStatusBarMessage(`$(sync~spin) ${message}`);
}

/**
 * Show a success notification briefly.
 */
export function showSuccess(message: string, durationMs: number = 3000): void {
  vscode.window.setStatusBarMessage(`$(check) ${message}`, durationMs);
}

/**
 * Show a warning notification briefly.
 */
export function showWarning(message: string, durationMs: number = 5000): void {
  vscode.window.setStatusBarMessage(`$(warning) ${message}`, durationMs);
}

/**
 * Run an async operation with loading state.
 * Shows spinner in status bar and handles errors.
 */
export async function withLoading<T>(
  message: string,
  operation: () => Promise<T>,
  errorHandler?: (error: Error) => void | Promise<void>
): Promise<T | undefined> {
  const loading = showLoading(message);
  try {
    const result = await operation();
    loading.dispose();
    return result;
  } catch (error) {
    loading.dispose();
    if (errorHandler && error instanceof Error) {
      await errorHandler(error);
    }
    return undefined;
  }
}

/**
 * Run an async operation with VS Code's progress API.
 * Shows progress notification with cancellation support.
 */
export async function withProgress<T>(
  title: string,
  operation: (
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken
  ) => Promise<T>,
  location: vscode.ProgressLocation = vscode.ProgressLocation.Notification
): Promise<T> {
  return vscode.window.withProgress(
    {
      location,
      title,
      cancellable: true,
    },
    operation
  );
}
