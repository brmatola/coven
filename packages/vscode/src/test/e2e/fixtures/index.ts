/**
 * E2E Test Fixtures
 *
 * Shared utilities for E2E testing. Import from this file:
 *
 * ```typescript
 * import {
 *   WorkspaceManager,
 *   SessionHelper,
 *   TaskHelper,
 *   assertCommandExists,
 * } from './fixtures';
 * ```
 */

// Workspace management
export {
  WorkspaceManager,
  getWorkspaceManager,
  resetDefaultManager,
} from './workspace-manager';

// Session helpers
export {
  SessionHelper,
  createSessionHelper,
  SessionStatus,
  SessionState,
  PersistedSessionState,
} from './session-helper';

// Familiar (agent) helpers
export {
  FamiliarHelper,
  createFamiliarHelper,
  FamiliarStatus,
  FamiliarState,
  PersistedFamiliar,
  ProcessInfo,
  WorktreeInfo,
} from './familiar-helper';

// Task helpers
export {
  TaskHelper,
  createTaskHelper,
  CreateTaskOptions,
  TaskData,
} from './task-helper';

// Assertions
export {
  assertCommandExists,
  assertCommandsExist,
  assertExtensionPresent,
  assertExtensionActive,
  assertCommandSucceeds,
  assertCommandFails,
  assertEventually,
  assertContainsAll,
} from './assertions';
