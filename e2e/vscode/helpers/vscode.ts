/**
 * VS Code helpers for E2E tests.
 *
 * Provides utilities for executing commands, inspecting tree views,
 * and interacting with VS Code during tests.
 */
import * as vscode from 'vscode';

/**
 * Execute a VS Code command.
 *
 * @param command The command identifier (e.g., 'coven.startSession')
 * @param args Optional arguments to pass to the command
 * @returns The result of the command, if any
 */
export async function executeCommand<T = unknown>(
  command: string,
  ...args: unknown[]
): Promise<T> {
  return vscode.commands.executeCommand<T>(command, ...args);
}

/**
 * Check if a command is registered.
 *
 * @param command The command identifier
 */
export async function isCommandRegistered(command: string): Promise<boolean> {
  const commands = await vscode.commands.getCommands(true);
  return commands.includes(command);
}

/**
 * Get all registered Coven commands.
 */
export async function getCovenCommands(): Promise<string[]> {
  const commands = await vscode.commands.getCommands(true);
  return commands.filter((cmd) => cmd.startsWith('coven.'));
}

/**
 * Get the Coven extension instance.
 *
 * @throws Error if extension is not installed
 */
export function getExtension(): vscode.Extension<unknown> {
  const extension = vscode.extensions.getExtension('coven.coven');
  if (!extension) {
    throw new Error('Coven extension is not installed');
  }
  return extension;
}

/**
 * Ensure the Coven extension is activated.
 *
 * @returns The extension's exported API
 */
export async function ensureExtensionActivated(): Promise<unknown> {
  const extension = getExtension();
  if (!extension.isActive) {
    return extension.activate();
  }
  return extension.exports;
}

/**
 * Wait for a condition to become true.
 *
 * @param predicate Function that returns true when condition is met
 * @param timeout Maximum time to wait in ms (default: 5000)
 * @param pollInterval How often to check in ms (default: 100)
 * @param message Description of what we're waiting for (for error messages)
 */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeout = 5000,
  pollInterval = 100,
  message = 'condition'
): Promise<void> {
  const endTime = Date.now() + timeout;

  while (Date.now() < endTime) {
    const result = await predicate();
    if (result) {
      return;
    }
    await delay(pollInterval);
  }

  throw new Error(`Timeout waiting for ${message} after ${timeout}ms`);
}

/**
 * Wait for a VS Code command to return a specific result.
 *
 * @param command The command to execute
 * @param predicate Function that returns true when result is expected
 * @param timeout Maximum time to wait in ms
 * @param pollInterval How often to check in ms
 */
export async function waitForCommandResult<T>(
  command: string,
  predicate: (result: T) => boolean,
  timeout = 5000,
  pollInterval = 100
): Promise<T> {
  const endTime = Date.now() + timeout;

  while (Date.now() < endTime) {
    const result = await executeCommand<T>(command);
    if (predicate(result)) {
      return result;
    }
    await delay(pollInterval);
  }

  throw new Error(`Timeout waiting for command '${command}' result after ${timeout}ms`);
}

// ============================================================================
// Tree View Helpers
// ============================================================================

/**
 * Tree item representation for testing.
 */
export interface TreeItemInfo {
  label: string;
  description?: string;
  tooltip?: string;
  contextValue?: string;
  collapsibleState: vscode.TreeItemCollapsibleState;
  iconPath?: string;
}

/**
 * Get tree items from a tree view by triggering a refresh and reading the data provider.
 *
 * Note: This requires access to the extension's internals. In a real E2E test,
 * you might use the VS Code test utilities or visual inspection.
 */
export async function getTreeViewItems(viewId: string): Promise<TreeItemInfo[]> {
  // This is a placeholder - actual implementation depends on how the extension exposes its tree data
  // In practice, you might need to:
  // 1. Access the extension's API to get the data provider
  // 2. Use @vscode/test-electron utilities
  // 3. Or test via command execution
  throw new Error(
    `getTreeViewItems('${viewId}') requires extension API access. ` +
    `Use executeCommand with a custom command that returns tree data.`
  );
}

/**
 * Wait for a tree view to contain an item matching a predicate.
 *
 * @param viewId The tree view identifier
 * @param predicate Function to match the desired item
 * @param timeout Maximum time to wait in ms
 */
export async function waitForTreeItem(
  viewId: string,
  predicate: (item: TreeItemInfo) => boolean,
  timeout = 5000
): Promise<TreeItemInfo> {
  const endTime = Date.now() + timeout;

  while (Date.now() < endTime) {
    try {
      const items = await getTreeViewItems(viewId);
      const item = items.find(predicate);
      if (item) {
        return item;
      }
    } catch {
      // Tree view might not be ready yet
    }
    await delay(100);
  }

  throw new Error(
    `Timeout waiting for tree item in '${viewId}' matching predicate after ${timeout}ms`
  );
}

// ============================================================================
// Workspace Helpers
// ============================================================================

/**
 * Get the current workspace folder path.
 *
 * @throws Error if no workspace is open
 */
export function getWorkspacePath(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error('No workspace folder is open');
  }
  return folders[0].uri.fsPath;
}

/**
 * Open a file in the editor.
 *
 * @param filePath Absolute or relative (to workspace) file path
 */
export async function openFile(filePath: string): Promise<vscode.TextEditor> {
  const uri = filePath.startsWith('/')
    ? vscode.Uri.file(filePath)
    : vscode.Uri.file(`${getWorkspacePath()}/${filePath}`);
  const document = await vscode.workspace.openTextDocument(uri);
  return vscode.window.showTextDocument(document);
}

/**
 * Close all editors.
 */
export async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

// ============================================================================
// Status Bar Helpers
// ============================================================================

/**
 * Get the Coven status bar item text.
 *
 * Note: Direct status bar item access is limited in VS Code.
 * This requires the extension to expose the status bar state.
 */
export async function getStatusBarText(): Promise<string | null> {
  // This would require the extension to expose its status bar state via command or API
  // For now, this is a placeholder
  return null;
}

// ============================================================================
// Output Channel Helpers
// ============================================================================

/**
 * Get content from the Coven output channel.
 *
 * Note: Direct output channel content access is limited.
 * Consider using the extension's logging API if available.
 */
export async function getOutputChannelContent(): Promise<string | null> {
  // This would require the extension to expose its output channel content
  // For now, this is a placeholder
  return null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Delay for a specified number of milliseconds.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a disposable that will clean up after the test.
 */
export function createTestDisposable(): vscode.Disposable {
  const disposables: vscode.Disposable[] = [];

  return {
    dispose: () => {
      for (const d of disposables.reverse()) {
        d.dispose();
      }
    },
    add: (disposable: vscode.Disposable) => {
      disposables.push(disposable);
    },
  } as vscode.Disposable & { add: (d: vscode.Disposable) => void };
}
