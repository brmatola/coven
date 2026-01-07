# e2e-testing Specification

## Purpose
TBD - created by archiving change add-e2e-test-infrastructure. Update Purpose after archive.
## Requirements
### Requirement: Test Workspace Management
The system SHALL provide isolated, reusable test workspaces for E2E testing.

#### Scenario: Workspace creation
- **WHEN** E2E test suite starts
- **THEN** a temporary workspace directory is created
- **THEN** git is initialized with test user config
- **THEN** an initial commit exists (required for git operations)
- **THEN** Beads is initialized (if CLI available)
- **THEN** workspace path is available to tests via environment variable

#### Scenario: Workspace reset between tests
- **WHEN** a test completes
- **THEN** git working directory is cleaned (`git clean -fd`)
- **THEN** git state is reset (`git checkout .`)
- **THEN** .coven directory state is cleared
- **THEN** next test starts with clean state
- **THEN** reset completes in under 500ms

#### Scenario: Workspace cleanup on suite end
- **WHEN** E2E test suite completes
- **THEN** temporary workspace directory is removed
- **THEN** cleanup succeeds even if tests failed
- **THEN** no orphaned temp directories remain

#### Scenario: Beads unavailable
- **WHEN** Beads CLI is not installed
- **THEN** workspace is created without Beads
- **THEN** Beads-dependent tests are skipped
- **THEN** other tests continue to run

### Requirement: Session Test Helpers
The system SHALL provide helpers for testing session lifecycle operations.

#### Scenario: Start session helper
- **WHEN** test calls `sessionHelper.startSession(branchName)`
- **THEN** session start command is executed
- **THEN** helper waits for session to reach 'active' status
- **THEN** helper returns when session is ready
- **THEN** timeout error is thrown if session doesn't start within limit

#### Scenario: Stop session helper
- **WHEN** test calls `sessionHelper.stopSession()`
- **THEN** session stop command is executed
- **THEN** helper waits for session to reach 'inactive' status
- **THEN** any active familiars are terminated
- **THEN** helper returns when cleanup is complete

#### Scenario: Get session state
- **WHEN** test calls `sessionHelper.getSessionState()`
- **THEN** current session state snapshot is returned
- **THEN** null is returned if no session is active
- **THEN** state includes status, branch, config, tasks, familiars

#### Scenario: Wait for status
- **WHEN** test calls `sessionHelper.waitForStatus(status, timeout)`
- **THEN** helper polls session state at intervals
- **THEN** helper resolves when status matches
- **THEN** helper rejects with timeout error if status not reached

### Requirement: Task Test Helpers
The system SHALL provide helpers for creating and managing test tasks.

#### Scenario: Create test task
- **WHEN** test calls `taskHelper.createTask(title, options)`
- **THEN** task is created in Beads via CLI
- **THEN** task ID is returned
- **THEN** task is tracked for cleanup

#### Scenario: Cleanup test tasks
- **WHEN** test calls `taskHelper.cleanup()`
- **THEN** all tasks created by this helper are deleted
- **THEN** cleanup continues even if some deletions fail
- **THEN** helper can be reused after cleanup

#### Scenario: Get task details
- **WHEN** test calls `taskHelper.getTask(taskId)`
- **THEN** task details are fetched from Beads
- **THEN** null is returned if task doesn't exist
- **THEN** full Beads task data is returned

### Requirement: Session Lifecycle E2E Tests
The system SHALL have E2E tests covering full session lifecycle.

#### Scenario: Test session start and stop
- **GIVEN** test workspace is ready
- **WHEN** session is started with a branch name
- **THEN** session status becomes 'active'
- **THEN** session can be stopped
- **THEN** session status becomes 'inactive'
- **THEN** feature branch is cleared

#### Scenario: Test session pause and resume
- **GIVEN** an active session
- **WHEN** session is paused
- **THEN** session status becomes 'paused'
- **THEN** session can be resumed
- **THEN** session status returns to 'active'

#### Scenario: Test session persistence
- **GIVEN** an active session
- **WHEN** extension is deactivated and reactivated
- **THEN** session state is restored
- **THEN** session status matches previous state
- **THEN** feature branch is preserved

### Requirement: Workspace Initialization E2E Tests
The system SHALL have E2E tests covering workspace setup flow.

#### Scenario: Test prerequisites check
- **GIVEN** test workspace with required tools
- **WHEN** extension activates
- **THEN** prerequisites are checked
- **THEN** no setup panel is shown if all pass

#### Scenario: Test setup panel interaction
- **GIVEN** extension is active
- **WHEN** setup command is executed
- **THEN** setup panel opens
- **THEN** panel shows prerequisite status
- **THEN** panel allows session configuration

### Requirement: Sidebar E2E Tests
The system SHALL have E2E tests covering sidebar interactions.

#### Scenario: Test sidebar visibility
- **GIVEN** extension is active
- **WHEN** sidebar is revealed
- **THEN** Coven view container is visible
- **THEN** sessions tree view is rendered

#### Scenario: Test sidebar state updates
- **GIVEN** active session with tasks
- **WHEN** task status changes
- **THEN** sidebar tree view updates
- **THEN** task appears in correct status group

#### Scenario: Test sidebar actions
- **GIVEN** task in sidebar
- **WHEN** task action is triggered (start, stop, view)
- **THEN** appropriate command is executed
- **THEN** UI reflects command result

