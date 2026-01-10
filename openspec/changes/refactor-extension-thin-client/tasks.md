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
- [ ] 2.3 Implement version comparison and auto-update
- [ ] 2.4 Implement daemon auto-start logic
- [ ] 2.5 Add binary management unit tests
- [ ] 2.6 Update `packages/vscode/package.json` to include binaries in vsix

## 3. Extension Activation Refactor

- [ ] 3.1 Refactor `extension.ts` to create DaemonClient on activation
- [ ] 3.2 Add `.coven/` directory detection
- [ ] 3.3 Add daemon connection flow (connect or auto-start)
- [ ] 3.4 Add SSE subscription on successful connection
- [ ] 3.5 Add connection error handling with user notification
- [ ] 3.6 Add welcome view for non-coven workspaces

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
- [ ] 6.3 Wire up approve-merge/reject-merge API calls
- [ ] 6.4 Handle conflict response from approve-merge
- [ ] 6.5 Add "Open Worktree" action for conflict resolution
- [ ] 6.6 Update ReviewPanel unit tests

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
- [ ] 8.7 Implement `coven.stopDaemon` command
- [ ] 8.8 Implement `coven.restartDaemon` command
- [ ] 8.9 Implement `coven.viewDaemonLogs` command
- [ ] 8.10 Remove session-related commands (startSession, stopSession)

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
- [ ] 11.11 Remove session-related tests

## 12. Unit Tests Update

- [ ] 12.1 Add DaemonClient unit tests with mocked socket
- [ ] 12.2 Add WorkflowTreeProvider unit tests
- [ ] 12.3 Add WorkflowDetailPanel unit tests
- [ ] 12.4 Update ReviewPanel tests for workflow context
- [ ] 12.5 Update QuestionHandler tests
- [ ] 12.6 Update command handler tests
- [ ] 12.7 Update CovenStatusBar tests
- [ ] 12.8 Remove tests for deleted code
- [ ] 12.9 Ensure 80% coverage maintained

## 13. E2E Tests Update

- [ ] 13.1 Update E2E test setup to ensure daemon is running
- [ ] 13.2 Add E2E test: daemon auto-start on activation
- [ ] 13.3 Add E2E test: workflow start via UI
- [ ] 13.4 Add E2E test: workflow progress display
- [ ] 13.5 Add E2E test: merge approval flow
- [ ] 13.6 Add E2E test: question handling flow
- [ ] 13.7 Add E2E test: workflow cancellation
- [ ] 13.8 Add E2E test: blocked workflow retry
- [ ] 13.9 Add E2E test: daemon reconnection
- [ ] 13.10 Remove session-related E2E tests

## 14. Error Handling & UX Polish

- [ ] 14.1 Add user-friendly error messages for daemon connection failures
- [ ] 14.2 Add "View Daemon Logs" action in error notifications
- [ ] 14.3 Add loading states for async operations
- [ ] 14.4 Add optimistic UI updates for actions
- [ ] 14.5 Add connection lost notification with retry action
- [ ] 14.6 Add daemon version mismatch notification
