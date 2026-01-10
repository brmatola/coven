## 0. Workspace Initialization Flow

- [ ] 0.1 Implement git repository detection
- [ ] 0.2 Implement `.coven/` directory detection
- [ ] 0.3 Implement `.beads/` directory detection
- [ ] 0.4 Implement `openspec/` directory detection
- [ ] 0.5 Implement CLI tool detection (bd, openspec commands in PATH)
- [ ] 0.6 Create SetupTreeProvider for welcome/setup view
- [ ] 0.7 Implement "Initialize Git" command (runs `git init`)
- [ ] 0.8 Implement "Initialize Beads" command (runs `bd init`)
- [ ] 0.9 Implement "Initialize Coven" action (creates `.coven/` with default config)
- [ ] 0.10 Implement "Initialize OpenSpec" command (runs `openspec init`)
- [ ] 0.11 Show installation instructions for missing CLI tools
- [ ] 0.12 Implement progressive setup flow (git → beads/coven → ready)
- [ ] 0.13 Add SetupTreeProvider unit tests

## 1. Daemon Client Infrastructure

- [ ] 1.1 Create `packages/vscode/src/daemon/` directory structure
- [ ] 1.2 Implement DaemonClient class with Unix socket HTTP
- [ ] 1.3 Implement connection management (connect, reconnect, disconnect)
- [ ] 1.4 Implement health check and version check
- [ ] 1.5 Implement SSE event subscription and parsing
- [ ] 1.6 Implement local state cache with event-driven updates
- [ ] 1.7 Add typed event emitter for workflow/agent/question events
- [ ] 1.8 Add DaemonClient unit tests

## 2. Binary Management

- [ ] 2.1 Add daemon binaries to extension package (darwin-arm64, darwin-amd64, linux-amd64, linux-arm64)
- [ ] 2.2 Implement binary extraction to `~/.coven/bin/`
- [ ] 2.3 Implement version check and aggressive auto-update (replace if version differs)
- [ ] 2.4 Implement daemon auto-start logic
- [ ] 2.5 Add binary management unit tests
- [ ] 2.6 Update `packages/vscode/package.json` to include binaries in vsix

## 3. Extension Activation Refactor

- [ ] 3.1 Refactor `extension.ts` to create DaemonClient on activation
- [ ] 3.2 Add `.coven/` directory detection
- [ ] 3.3 Add daemon connection flow (connect or auto-start)
- [ ] 3.4 Add SSE subscription on successful connection
- [ ] 3.5 Add connection error handling with user notification
- [ ] 3.6 Show setup view when workspace not fully initialized

## 4. Workflow Sidebar View

- [ ] 4.1 Create WorkflowTreeProvider with grouped sections
- [ ] 4.2 Implement Active Workflows section
- [ ] 4.3 Implement Questions section with badge count
- [ ] 4.4 Implement Ready Tasks section
- [ ] 4.5 Implement Blocked section
- [ ] 4.6 Implement Completed section (collapsed by default)
- [ ] 4.7 Add inline action buttons (Start, Cancel, Approve, Reject, Retry)
- [ ] 4.8 Wire up event listeners for real-time updates
- [ ] 4.9 Add WorkflowTreeProvider unit tests

## 5. Workflow Detail Panel

- [ ] 5.1 Create WorkflowDetailPanel webview
- [ ] 5.2 Implement workflow metadata display
- [ ] 5.3 Implement step list with status indicators
- [ ] 5.4 Implement nested loop step display
- [ ] 5.5 Implement agent output streaming section
- [ ] 5.6 Implement action buttons (Cancel, Retry, Approve, Reject)
- [ ] 5.7 Add "View Log" functionality
- [ ] 5.8 Wire up SSE events for real-time updates
- [ ] 5.9 Add WorkflowDetailPanel unit tests

## 6. Merge Review Panel Refactor

- [ ] 6.1 Refactor ReviewPanel to work with workflow context
- [ ] 6.2 Add step outputs summary display
- [ ] 6.3 Implement file diff viewing via `vscode.diff()` command
- [ ] 6.4 Wire up approve-merge/reject-merge API calls
- [ ] 6.5 Handle conflict response from approve-merge
- [ ] 6.6 Implement "Open Worktree" action (opens worktree folder in new window)
- [ ] 6.7 Implement "Retry Merge" action for post-conflict resolution
- [ ] 6.8 Update ReviewPanel unit tests

## 7. Question Handling

- [ ] 7.1 Refactor QuestionHandler to use daemon API
- [ ] 7.2 Implement question notification from SSE events
- [ ] 7.3 Implement question answer dialog
- [ ] 7.4 Wire up POST /questions/:id/answer
- [ ] 7.5 Add QuestionHandler unit tests

## 8. Command Handlers Refactor

- [ ] 8.1 Implement `coven.startTask` using daemon API
- [ ] 8.2 Implement `coven.cancelWorkflow` using daemon API
- [ ] 8.3 Implement `coven.retryWorkflow` using daemon API
- [ ] 8.4 Implement `coven.approveMerge` using daemon API
- [ ] 8.5 Implement `coven.rejectMerge` using daemon API
- [ ] 8.6 Implement `coven.answerQuestion` using daemon API
- [ ] 8.7 Implement `coven.stopDaemon` command (POST /shutdown)
- [ ] 8.8 Implement `coven.restartDaemon` command
- [ ] 8.9 Implement `coven.viewDaemonLogs` command
- [ ] 8.10 Implement `coven.initializeWorkspace` command

## 9. Status Bar Refactor

- [ ] 9.1 Refactor CovenStatusBar to show daemon status
- [ ] 9.2 Show active/pending workflow counts
- [ ] 9.3 Show connection state indicator
- [ ] 9.4 Handle click to reveal sidebar
- [ ] 9.5 Add CovenStatusBar unit tests

## 10. Agent Output Refactor

- [ ] 10.1 Refactor FamiliarOutputChannel to receive output via SSE
- [ ] 10.2 Implement historical output fetch via GET /agents/:id/output
- [ ] 10.3 Implement real-time output via agent.output events
- [ ] 10.4 Remove direct stdout capture code
- [ ] 10.5 Add FamiliarOutputChannel unit tests

## 11. Remove Deprecated Code

- [ ] 11.1 Delete CovenSession.ts
- [ ] 11.2 Delete FamiliarManager.ts
- [ ] 11.3 Delete ClaudeAgent.ts
- [ ] 11.4 Delete AgentOrchestrator.ts
- [ ] 11.5 Delete OrphanRecovery.ts
- [ ] 11.6 Delete BeadsTaskSource direct file access code
- [ ] 11.7 Delete WorktreeManager from extension
- [ ] 11.8 Delete SessionsTreeDataProvider
- [ ] 11.9 Delete GrimoireTreeProvider (replace with WorkflowTreeProvider)
- [ ] 11.10 Clean up unused imports and types

## 12. Daemon Session Removal

- [ ] 12.1 Remove session package from daemon (`packages/daemon/internal/session/`)
- [ ] 12.2 Remove session handlers registration from daemon.go
- [ ] 12.3 Remove session-related state from store
- [ ] 12.4 Update daemon tests to remove session references
- [ ] 12.5 Ensure daemon accepts work immediately on start

## 13. Unit Test Infrastructure

- [ ] 13.1 Create MockDaemonClient for simulating socket responses
- [ ] 13.2 Create MockSSEStream for emitting configurable events
- [ ] 13.3 Create state fixtures (empty state, active workflows, pending questions, etc.)
- [ ] 13.4 Add timer mocks for reconnection testing
- [ ] 13.5 Remove tests for deleted code (CovenSession, FamiliarManager, etc.)

## 14. DaemonClient Unit Tests

- [ ] 14.1 Test connect success (socket responds, state fetched)
- [ ] 14.2 Test connect timeout (5s limit)
- [ ] 14.3 Test connect refused (daemon not running)
- [ ] 14.4 Test auto-reconnect on SSE drop (3 retries, 1s interval)
- [ ] 14.5 Test max retries exceeded (shows disconnected)
- [ ] 14.6 Test SSE event parsing (valid events)
- [ ] 14.7 Test SSE malformed event handling
- [ ] 14.8 Test SSE heartbeat processing
- [ ] 14.9 Test state cache population from initial snapshot
- [ ] 14.10 Test state cache incremental updates
- [ ] 14.11 Test API call success responses
- [ ] 14.12 Test API call error responses
- [ ] 14.13 Test API call timeout handling
- [ ] 14.14 Test event emission (correct types and data)

## 15. WorkflowTreeProvider Unit Tests

- [ ] 15.1 Test Active Workflows section renders running workflows
- [ ] 15.2 Test Questions section with badge count
- [ ] 15.3 Test Ready Tasks section renders available tasks
- [ ] 15.4 Test Blocked section renders blocked workflows
- [ ] 15.5 Test Completed section collapsed by default
- [ ] 15.6 Test workflows grouped and ordered correctly
- [ ] 15.7 Test real-time updates on state change
- [ ] 15.8 Test optimistic UI updates
- [ ] 15.9 Test action buttons trigger correct API calls
- [ ] 15.10 Test empty sections (edge case)
- [ ] 15.11 Test many items render (50+ workflows)
- [ ] 15.12 Test rapid updates don't cause race conditions

## 16. WorkflowDetailPanel Unit Tests

- [ ] 16.1 Test metadata display (grimoire, started time, ID)
- [ ] 16.2 Test step list renders all steps
- [ ] 16.3 Test status icons (checkmark, spinner, circle, X)
- [ ] 16.4 Test nested loop steps indented correctly
- [ ] 16.5 Test current step highlighted
- [ ] 16.6 Test iteration count for loops
- [ ] 16.7 Test initial output fetch
- [ ] 16.8 Test streaming output append
- [ ] 16.9 Test auto-scroll behavior
- [ ] 16.10 Test action button visibility per status
- [ ] 16.11 Test action buttons trigger correct API calls

## 17. Other Component Unit Tests

- [ ] 17.1 MergeReviewPanel: diff display (files, +/- counts)
- [ ] 17.2 MergeReviewPanel: step outputs summary
- [ ] 17.3 MergeReviewPanel: approve success
- [ ] 17.4 MergeReviewPanel: approve with conflict detection
- [ ] 17.5 MergeReviewPanel: reject with/without reason
- [ ] 17.6 MergeReviewPanel: open worktree action
- [ ] 17.7 QuestionHandler: notification shows
- [ ] 17.8 QuestionHandler: dialog opens and submits
- [ ] 17.9 QuestionHandler: badge count updates
- [ ] 17.10 QuestionHandler: multiple pending questions
- [ ] 17.11 StatusBar: connected state display
- [ ] 17.12 StatusBar: disconnected state display
- [ ] 17.13 StatusBar: active/pending counts
- [ ] 17.14 StatusBar: click reveals sidebar
- [ ] 17.15 SetupTreeProvider: shows missing components
- [ ] 17.16 SetupTreeProvider: updates on initialization
- [ ] 17.17 Verify 80% coverage maintained

## 18. E2E Test Migration & Infrastructure

- [ ] 18.1 Move E2E tests from `packages/vscode/src/test/e2e/` to `e2e/vscode/`
- [ ] 18.2 Update VS Code test runner config to use new location
- [ ] 18.3 Update `package.json` test:e2e script paths
- [ ] 18.4 Update Makefile test-e2e target for extension
- [ ] 18.5 Create test workspace fixture with .coven/ and sample beads
- [ ] 18.6 Use mock agent binary from e2e/daemon/mockagent/
- [ ] 18.7 Add daemon start/stop helpers for test setup/teardown
- [ ] 18.8 Add SSE event assertion helpers with timeout
- [ ] 18.9 Add UI element assertion helpers (sidebar items, panels)
- [ ] 18.10 Delete old `packages/vscode/src/test/e2e/` directory

## 19. E2E Critical Path Tests

- [ ] 19.1 Test daemon auto-start on workspace activation
- [ ] 19.2 Test start task workflow (click Start → workflow.started)
- [ ] 19.3 Test workflow completion (all steps → completed section)
- [ ] 19.4 Test merge approval (pending_merge → approve → merged)
- [ ] 19.5 Test question handling (question appears → answer → agent continues)
- [ ] 19.6 Test cancel workflow (Cancel → agent terminated → cancelled)

## 20. E2E Error Recovery Tests

- [ ] 20.1 Test daemon crash recovery (kill daemon → reconnect → state recovered)
- [ ] 20.2 Test connection drop (network drop → reconnect attempts → restored)
- [ ] 20.3 Test API error handling (404/500 → user-friendly error → UI stable)

## 21. E2E Workflow Lifecycle Tests

- [ ] 21.1 Test multi-step workflow (3+ steps transition correctly)
- [ ] 21.2 Test loop step execution (iteration count displays)
- [ ] 21.3 Test blocked workflow retry (fail → fix → retry → complete)
- [ ] 21.4 Test reject merge (reject with reason → blocked)
- [ ] 21.5 Test merge conflict handling (conflict detected → worktree openable)

## 22. E2E Concurrent Operations Tests

- [ ] 22.1 Test multiple active workflows simultaneously
- [ ] 22.2 Test multiple pending questions
- [ ] 22.3 Test rapid task starts (3 tasks quickly)

## 23. E2E UI State Tests

- [ ] 23.1 Test sidebar sections render correctly
- [ ] 23.2 Test detail panel real-time updates
- [ ] 23.3 Test output streaming in panel
- [ ] 23.4 Test optimistic updates (immediate feedback)

## 24. E2E Initialization Tests

- [ ] 24.1 Test setup view shows for uninitialized workspace
- [ ] 24.2 Test "Initialize Coven" creates .coven/ and starts daemon
- [ ] 24.3 Test transition from setup view to main UI after initialization
- [ ] 24.4 Test error handling when CLI tools not installed

## 25. Error Handling & UX Polish

- [ ] 25.1 Add user-friendly error messages for daemon connection failures
- [ ] 25.2 Add "View Daemon Logs" action in error notifications
- [ ] 25.3 Add loading states for async operations
- [ ] 25.4 Add optimistic UI updates for actions
- [ ] 25.5 Add connection lost notification with retry action
- [ ] 25.6 Add daemon version mismatch notification
