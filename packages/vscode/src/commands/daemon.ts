import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DaemonClient } from '../daemon/client';
import { DaemonLifecycle, DaemonStartError } from '../daemon/lifecycle';
import { DaemonClientError } from '../daemon/types';

/**
 * Options for daemon commands
 */
export interface DaemonCommandDependencies {
  /** DaemonClient for API calls */
  client: DaemonClient;
  /** DaemonLifecycle for starting/stopping */
  lifecycle: DaemonLifecycle;
  /** Workspace root path */
  workspaceRoot: string;
}

/**
 * Show a user-friendly error message for daemon errors
 */
function showDaemonError(error: unknown, context: string): void {
  let message: string;
  let actions: string[] = [];

  if (error instanceof DaemonStartError) {
    message = error.message;
    actions = ['View Logs'];
  } else if (error instanceof DaemonClientError) {
    switch (error.code) {
      case 'connection_refused':
        message = 'Daemon is not running.';
        break;
      case 'socket_not_found':
        message = 'Daemon socket not found.';
        break;
      default:
        message = error.message;
    }
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }

  if (actions.length > 0 && error instanceof DaemonStartError) {
    void vscode.window.showErrorMessage(`${context}: ${message}`, ...actions).then((action) => {
      if (action === 'View Logs') {
        void viewDaemonLogs(path.dirname(error.logPath));
      }
    });
  } else {
    void vscode.window.showErrorMessage(`${context}: ${message}`);
  }
}

/**
 * Stop the daemon gracefully.
 * Handles the case where daemon is already stopped.
 */
export async function stopDaemon(deps: DaemonCommandDependencies): Promise<void> {
  try {
    // Check if daemon is running first
    const isRunning = await deps.lifecycle.isRunning();
    if (!isRunning) {
      void vscode.window.showInformationMessage('Daemon is not running.');
      return;
    }

    // Send shutdown request
    await deps.client.post<unknown>('/shutdown', {});
    void vscode.window.showInformationMessage('Daemon stopped.');
  } catch (error) {
    if (error instanceof DaemonClientError) {
      // Connection refused means daemon already stopped
      if (error.code === 'connection_refused' || error.code === 'socket_not_found') {
        void vscode.window.showInformationMessage('Daemon is not running.');
        return;
      }
    }
    showDaemonError(error, 'Failed to stop daemon');
  }
}

/**
 * Restart the daemon (stop + start).
 */
export async function restartDaemon(deps: DaemonCommandDependencies): Promise<void> {
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Restarting daemon...',
        cancellable: false,
      },
      async () => {
        // Stop daemon if running
        try {
          await deps.client.post<unknown>('/shutdown', {});
          // Wait a bit for shutdown to complete
          await delay(500);
        } catch (error) {
          // Ignore connection errors - daemon may already be stopped
          if (!(error instanceof DaemonClientError) ||
            (error.code !== 'connection_refused' && error.code !== 'socket_not_found')) {
            throw error;
          }
        }

        // Start daemon
        await deps.lifecycle.ensureRunning();
      }
    );

    void vscode.window.showInformationMessage('Daemon restarted.');
  } catch (error) {
    showDaemonError(error, 'Failed to restart daemon');
  }
}

/**
 * View daemon log file in VS Code editor.
 */
export async function viewDaemonLogs(workspaceRoot: string): Promise<void> {
  const logPath = path.join(workspaceRoot, '.coven', 'covend.log');

  if (!fs.existsSync(logPath)) {
    void vscode.window.showWarningMessage(
      'No daemon logs found. The daemon may not have been started yet.'
    );
    return;
  }

  try {
    const doc = await vscode.workspace.openTextDocument(logPath);
    await vscode.window.showTextDocument(doc, {
      preview: false,
      preserveFocus: false,
    });
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to open daemon logs: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Initialize coven in the workspace.
 * Creates .coven directory and default configuration.
 */
export async function initializeWorkspace(workspaceRoot: string): Promise<void> {
  const covenDir = path.join(workspaceRoot, '.coven');

  // Check if already initialized
  if (fs.existsSync(covenDir)) {
    const choice = await vscode.window.showWarningMessage(
      'Coven is already initialized in this workspace. Reinitialize?',
      'Yes',
      'No'
    );
    if (choice !== 'Yes') {
      return;
    }
  }

  try {
    // Create .coven directory
    fs.mkdirSync(covenDir, { recursive: true });

    // Create default config
    const configPath = path.join(covenDir, 'config.yaml');
    const defaultConfig = `# Coven Configuration
version: "1"
daemon:
  socket: ".coven/covend.sock"
`;
    fs.writeFileSync(configPath, defaultConfig, 'utf-8');

    // Create .gitignore to exclude daemon artifacts
    const gitignorePath = path.join(covenDir, '.gitignore');
    const gitignoreContent = `# Daemon artifacts
covend.sock
covend.log
covend.pid
`;
    fs.writeFileSync(gitignorePath, gitignoreContent, 'utf-8');

    void vscode.window.showInformationMessage('Coven initialized successfully.');
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Failed to initialize coven: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Register all daemon lifecycle commands.
 */
export function registerDaemonCommands(
  context: vscode.ExtensionContext,
  getDeps: () => DaemonCommandDependencies | null
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  // Stop daemon command
  disposables.push(
    vscode.commands.registerCommand('coven.stopDaemon', async () => {
      const deps = getDeps();
      if (!deps) {
        void vscode.window.showErrorMessage('Coven is not initialized.');
        return;
      }
      await stopDaemon(deps);
    })
  );

  // Restart daemon command
  disposables.push(
    vscode.commands.registerCommand('coven.restartDaemon', async () => {
      const deps = getDeps();
      if (!deps) {
        void vscode.window.showErrorMessage('Coven is not initialized.');
        return;
      }
      await restartDaemon(deps);
    })
  );

  // View daemon logs command
  disposables.push(
    vscode.commands.registerCommand('coven.viewDaemonLogs', async () => {
      const deps = getDeps();
      if (!deps) {
        void vscode.window.showErrorMessage('Coven is not initialized.');
        return;
      }
      await viewDaemonLogs(deps.workspaceRoot);
    })
  );

  // Initialize workspace command
  disposables.push(
    vscode.commands.registerCommand('coven.initializeWorkspace', async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        void vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }
      await initializeWorkspace(workspaceFolders[0].uri.fsPath);
    })
  );

  // Add to context subscriptions
  context.subscriptions.push(...disposables);

  return disposables;
}

/**
 * Helper to delay for a specified number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
