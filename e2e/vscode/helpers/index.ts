/**
 * E2E test helpers for Coven VS Code extension.
 *
 * Provides utilities for:
 * - Daemon lifecycle management
 * - Direct daemon API access
 * - Beads CLI interactions
 * - SSE event waiting and assertions
 * - VS Code command and view interactions
 */

// Daemon helpers
export {
  DaemonHelper,
  DaemonHelperOptions,
  createDaemonHelper,
} from './daemon';

// Direct daemon client for testing
export {
  TestDaemonClient,
} from './daemon-client';
export type {
  DaemonHealth,
  DaemonTask,
  DaemonAgent,
  DaemonState,
  StateResponse,
} from './daemon-client';

// Beads CLI wrapper
export {
  BeadsClient,
  isBeadsAvailable,
} from './beads-client';
export type {
  BeadsTask,
  CreateTaskOptions,
} from './beads-client';

// Test environment management
export {
  TestEnv,
  createTestEnv,
} from './test-env';
export type {
  TestEnvConfig,
} from './test-env';

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
