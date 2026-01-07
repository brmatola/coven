# Tasks: Add E2E Test Infrastructure

## Implementation
Epic: `coven-487` (add-e2e-test-infrastructure)
Track progress: `bd epic status coven-487`
List tasks: `bd list --parent coven-487`

## 1. Workspace Manager
- [ ] 1.1 Create `WorkspaceManager` class in `src/test/e2e/fixtures/`
- [ ] 1.2 Implement `create()` with git + beads initialization
- [ ] 1.3 Implement `reset()` with git clean/checkout and .coven cleanup
- [ ] 1.4 Implement `destroy()` with temp directory removal
- [ ] 1.5 Add `isReady()` check for git/beads status
- [ ] 1.6 Update `run-e2e-tests.ts` to use WorkspaceManager
- [ ] 1.7 Add error handling with retry for cleanup operations

## 2. Session Helper
- [ ] 2.1 Create `SessionHelper` class in `src/test/e2e/fixtures/`
- [ ] 2.2 Implement `startSession()` with wait-for-active logic
- [ ] 2.3 Implement `stopSession()` with cleanup wait
- [ ] 2.4 Implement `getSessionState()` for state inspection
- [ ] 2.5 Implement `waitForStatus()` with polling and timeout
- [ ] 2.6 Implement `executeCommand()` wrapper with error capture
- [ ] 2.7 Write unit tests for SessionHelper

## 3. Task Helper
- [ ] 3.1 Create `TaskHelper` class in `src/test/e2e/fixtures/`
- [ ] 3.2 Implement `createTask()` with tracking for cleanup
- [ ] 3.3 Implement `cleanup()` for test teardown
- [ ] 3.4 Implement `getTask()` and `listTasks()` wrappers
- [ ] 3.5 Handle Beads unavailable scenario (skip gracefully)
- [ ] 3.6 Migrate existing beads.test.ts helpers to TaskHelper

## 4. Test Infrastructure Updates
- [ ] 4.1 Create `fixtures/index.ts` exporting all helpers
- [ ] 4.2 Create `fixtures/assertions.ts` with custom test assertions
- [ ] 4.3 Update `index.ts` to support suite setup/teardown hooks
- [ ] 4.4 Add environment variable support for timeout configuration
- [ ] 4.5 Reorganize existing tests into `suites/` directory

## 5. Session Lifecycle Tests
- [ ] 5.1 Create `suites/session-lifecycle.test.ts`
- [ ] 5.2 Test: Start session → verify active → stop session
- [ ] 5.3 Test: Pause session → verify paused → resume session
- [ ] 5.4 Test: Session state persists across restart
- [ ] 5.5 Test: Config changes persist

## 6. Workspace Init Tests
- [ ] 6.1 Create `suites/workspace-init.test.ts`
- [ ] 6.2 Test: Prerequisites check passes with valid workspace
- [ ] 6.3 Test: Setup panel opens and shows status
- [ ] 6.4 Test: Setup panel branch selection flow

## 7. Sidebar Tests
- [ ] 7.1 Create `suites/sidebar.test.ts`
- [ ] 7.2 Test: Sidebar reveals with session tree
- [ ] 7.3 Test: Tree updates on session state change
- [ ] 7.4 Test: Task actions trigger correct commands

## 8. Documentation & Cleanup
- [ ] 8.1 Add README.md to `src/test/e2e/` documenting structure
- [ ] 8.2 Update existing tests to use new fixtures
- [ ] 8.3 Remove duplicate helper code from test files
- [ ] 8.4 Verify all tests pass with new infrastructure
