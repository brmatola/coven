import * as vscode from 'vscode';
import { NotificationLevel, SessionConfig } from './types';

/**
 * Notification helper that respects config-based notification levels.
 * Provides methods for different notification types with appropriate actions.
 */
export class NotificationService {
  constructor(private getConfig: () => SessionConfig) {}

  /**
   * Notify when an agent asks a question.
   */
  async notifyQuestion(
    taskId: string,
    question: string,
    onRespond: () => void
  ): Promise<void> {
    const level = this.getConfig().notifications.questions;
    const truncatedQuestion =
      question.length > 100 ? question.slice(0, 100) + '...' : question;
    const message = `Agent needs response: ${truncatedQuestion}`;

    await this.notify(level, message, [
      {
        label: 'Respond',
        action: onRespond,
      },
      {
        label: 'View Output',
        action: (): void => {
          void vscode.commands.executeCommand('coven.viewFamiliarOutput', taskId);
        },
      },
    ]);
  }

  /**
   * Notify when an agent completes a task.
   */
  async notifyCompletion(
    taskId: string,
    taskTitle: string,
    onReview: () => void
  ): Promise<void> {
    const level = this.getConfig().notifications.completions;
    const message = `Task completed: ${taskTitle}`;

    await this.notify(level, message, [
      {
        label: 'Review',
        action: onReview,
      },
      {
        label: 'View Output',
        action: (): void => {
          void vscode.commands.executeCommand('coven.viewFamiliarOutput', taskId);
        },
      },
    ]);
  }

  /**
   * Notify when a merge conflict is resolved.
   */
  async notifyConflictResolved(taskId: string, filesResolved: string[]): Promise<void> {
    const level = this.getConfig().notifications.conflicts;
    const fileCount = filesResolved.length;
    const message = `Merge conflict resolved: ${fileCount} file${fileCount !== 1 ? 's' : ''}`;

    await this.notify(level, message, [
      {
        label: 'View Changes',
        action: (): void => {
          void vscode.commands.executeCommand('coven.viewFamiliarOutput', taskId);
        },
      },
    ]);
  }

  /**
   * Notify when an agent encounters an error.
   */
  async notifyError(taskId: string, error: string): Promise<void> {
    const level = this.getConfig().notifications.errors;
    const truncatedError = error.length > 150 ? error.slice(0, 150) + '...' : error;
    const message = `Agent error: ${truncatedError}`;

    await this.notify(
      level,
      message,
      [
        {
          label: 'View Output',
          action: (): void => {
            void vscode.commands.executeCommand('coven.viewFamiliarOutput', taskId);
          },
        },
      ],
      'error'
    );
  }

  /**
   * Notify when an agent is blocked or stuck.
   */
  async notifyBlocked(taskId: string, reason: string): Promise<void> {
    const level = this.getConfig().notifications.errors;
    const message = `Agent blocked: ${reason}`;

    await this.notify(
      level,
      message,
      [
        {
          label: 'Help',
          action: (): void => {
            void vscode.commands.executeCommand('coven.viewFamiliarOutput', taskId);
          },
        },
      ],
      'warning'
    );
  }

  /**
   * Internal notification method that respects notification level.
   */
  private async notify(
    level: NotificationLevel,
    message: string,
    actions: Array<{ label: string; action: () => void }>,
    severity: 'info' | 'warning' | 'error' = 'info'
  ): Promise<void> {
    if (level === 'none') {
      return;
    }

    const actionLabels = actions.map((a) => a.label);

    let result: string | undefined;

    if (level === 'modal') {
      // Modal notification - blocking
      const showFn =
        severity === 'error'
          ? vscode.window.showErrorMessage
          : severity === 'warning'
            ? vscode.window.showWarningMessage
            : vscode.window.showInformationMessage;

      result = await showFn(message, { modal: true }, ...actionLabels);
    } else if (level === 'toast') {
      // Toast notification - non-blocking
      const showFn =
        severity === 'error'
          ? vscode.window.showErrorMessage
          : severity === 'warning'
            ? vscode.window.showWarningMessage
            : vscode.window.showInformationMessage;

      result = await showFn(message, ...actionLabels);
    } else if (level === 'statusbar') {
      // Status bar - just show briefly, no actions
      vscode.window.setStatusBarMessage(`$(bell) ${message}`, 5000);
      return;
    }

    // Execute the action if user clicked one
    if (result) {
      const action = actions.find((a) => a.label === result);
      if (action) {
        action.action();
      }
    }
  }
}
