# Design: E2E Test Infrastructure

## Overview

This change establishes a robust E2E testing infrastructure that enables confident development as Coven grows. The design prioritizes:
- **Fast iteration**: Workspace reuse with quick reset vs fresh creation
- **Extensibility**: Helpers that new features can build upon
- **Isolation**: Tests don't affect each other or the real workspace
- **CI readiness**: Works in headless environments

## Architecture

### Directory Structure

```
src/test/e2e/
├── fixtures/
│   ├── workspace-manager.ts    # Workspace lifecycle management
│   ├── session-helper.ts       # Session start/stop/state helpers
│   ├── task-helper.ts          # Beads task creation/cleanup
│   └── assertions.ts           # Custom assertion helpers
├── suites/
│   ├── extension.test.ts       # Existing: activation, commands
│   ├── beads.test.ts           # Existing: Beads integration
│   ├── session-lifecycle.test.ts   # NEW: start/pause/resume/stop
│   ├── workspace-init.test.ts      # NEW: setup panel flow
│   └── sidebar.test.ts             # NEW: tree view interactions
├── index.ts                    # Test runner entry point
└── tsconfig.json
```

### Workspace Manager

The workspace manager provides isolated test environments with fast reset:

```
┌─────────────────────────────────────────────────────────────┐
│                    WorkspaceManager                          │
├─────────────────────────────────────────────────────────────┤
│ create()     → Creates temp dir with git + beads init       │
│ reset()      → Fast cleanup: git reset, clear .coven state  │
│ destroy()    → Full cleanup: remove temp directory          │
│ getPath()    → Returns current workspace path               │
│ isReady()    → Checks git + beads initialization status     │
└─────────────────────────────────────────────────────────────┘
```

**Reset vs Recreate Strategy:**
- `reset()` is fast (~100ms): `git clean -fd && git checkout .`
- `create()` is slow (~2s): mkdir, git init, bd init, initial commit
- Tests use `reset()` between tests, `create()` only on suite setup

### Session Helper

Provides typed helpers for session operations in tests:

```typescript
interface SessionHelper {
  // Start a session and wait for it to be active
  startSession(branchName: string): Promise<void>;

  // Stop session and wait for cleanup
  stopSession(): Promise<void>;

  // Get current session state (or null if inactive)
  getSessionState(): SessionState | null;

  // Wait for session to reach a specific status
  waitForStatus(status: SessionStatus, timeoutMs?: number): Promise<void>;

  // Execute command and capture any errors
  executeCommand(command: string, ...args: unknown[]): Promise<void>;
}
```

### Task Helper

Wraps Beads operations for test setup/teardown:

```typescript
interface TaskHelper {
  // Create task and track for cleanup
  createTask(title: string, options?: TaskOptions): Promise<string>;

  // Clean up all tasks created in this test
  cleanup(): Promise<void>;

  // Get task by ID
  getTask(taskId: string): Promise<BeadData | null>;

  // List all tasks
  listTasks(): Promise<BeadData[]>;
}
```

### Test Lifecycle

```
Suite Setup:
  1. WorkspaceManager.create() → Isolated temp workspace
  2. VS Code launches with workspace
  3. Extension activates

Between Tests:
  1. WorkspaceManager.reset() → Clean git state
  2. TaskHelper.cleanup() → Remove test tasks
  3. SessionHelper.stopSession() → Ensure clean session state

Suite Teardown:
  1. WorkspaceManager.destroy() → Remove temp directory
```

## Trade-offs

### Workspace Reuse vs Fresh Creation

**Chosen: Reuse with reset**
- Pro: Fast (~100ms reset vs ~2s create)
- Pro: Beads/git already initialized
- Con: Risk of state leakage between tests
- Mitigation: Comprehensive reset that clears all known state paths

### Mocha vs Vitest for E2E

**Chosen: Keep Mocha**
- VSCode Extension Test framework requires Mocha
- Vitest is for unit tests only
- Different test runners for different purposes is acceptable

### Shared State vs Full Isolation

**Chosen: Shared workspace, isolated state**
- Same workspace directory throughout suite
- Each test resets to clean state
- Tests must not depend on order
- Cleanup happens in `afterEach`, not just `after`

## Future Extensibility

### Adding New Test Suites
1. Create `suites/<feature>.test.ts`
2. Import helpers from `fixtures/`
3. Use `suiteSetup`/`suiteTeardown` for workspace
4. Use `setup`/`teardown` for per-test cleanup

### Adding New Fixtures
1. Create `fixtures/<helper>.ts`
2. Export typed interface + implementation
3. Document usage in fixture file
4. Add to fixtures index for easy import

### CI Integration
- WorkspaceManager uses `COVEN_E2E_WORKSPACE` env var if set
- Tests skip gracefully if tools unavailable (Beads, Claude)
- Timeout configuration via environment variables
