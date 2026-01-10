/**
 * E2E test helpers for Coven VS Code extension.
 *
 * Provides utilities for:
 * - Daemon lifecycle management
 * - SSE event waiting and assertions
 * - VS Code command and view interactions
 */

// Daemon helpers
export {
  DaemonHelper,
  DaemonHelperOptions,
  createDaemonHelper,
} from './daemon';

// Event helpers
export {
  SSEClient,
  SSEEvent,
  DaemonEventType,
  EventWaiter,
  createEventWaiter,
} from './events';

// VS Code helpers
export {
  executeCommand,
  isCommandRegistered,
  getCovenCommands,
  getExtension,
  ensureExtensionActivated,
  waitFor,
  waitForCommandResult,
  TreeItemInfo,
  getTreeViewItems,
  waitForTreeItem,
  getWorkspacePath,
  openFile,
  closeAllEditors,
  getStatusBarText,
  getOutputChannelContent,
  delay,
  createTestDisposable,
} from './vscode';
