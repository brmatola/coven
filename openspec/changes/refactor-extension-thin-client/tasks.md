## 1. Daemon Client Infrastructure

- [ ] 1.1 Create `packages/vscode/src/daemon/` directory structure
- [ ] 1.2 Implement DaemonClient class with Unix socket HTTP
- [ ] 1.3 Implement connection management (connect, reconnect, disconnect)
- [ ] 1.4 Implement health check and version check
- [ ] 1.5 Implement SSE event subscription
- [ ] 1.6 Implement local state cache with event-driven updates
- [ ] 1.7 Add DaemonClient unit tests

## 2. Binary Management

- [ ] 2.1 Add daemon binaries to extension package (darwin-arm64, darwin-amd64, linux-amd64, linux-arm64)
- [ ] 2.2 Implement binary extraction to `~/.coven/bin/`
- [ ] 2.3 Implement version comparison and auto-update
- [ ] 2.4 Implement daemon auto-start logic
- [ ] 2.5 Add binary management unit tests
- [ ] 2.6 Update `packages/vscode/package.json` to include binaries in vsix

## 3. Extension Activation Refactor

- [ ] 3.1 Refactor `extension.ts` to create DaemonClient on activation
- [ ] 3.2 Add daemon connection flow (connect, version check, start if needed)
- [ ] 3.3 Add SSE subscription on successful connection
- [ ] 3.4 Add connection error handling with user notification
- [ ] 3.5 Implement transparent daemon restart on version mismatch

## 4. Sidebar Integration

- [ ] 4.1 Refactor GrimoireTreeProvider to use DaemonClient.getState()
- [ ] 4.2 Refactor SessionsTreeDataProvider to use DaemonClient.getState()
- [ ] 4.3 Add event listeners for cache updates
- [ ] 4.4 Remove direct beads access from tree providers
- [ ] 4.5 Verify instant UI refresh (no async in getChildren)

## 5. Command Handlers Refactor

- [ ] 5.1 Refactor `coven.startSession` to use daemon API
- [ ] 5.2 Refactor `coven.stopSession` to use daemon API
- [ ] 5.3 Refactor `coven.startTask` to use daemon API
- [ ] 5.4 Refactor `coven.stopTask` to use daemon API
- [ ] 5.5 Refactor `coven.respondToQuestion` to use daemon API
- [ ] 5.6 Remove direct agent spawning from commands

## 6. Agent Output Refactor

- [ ] 6.1 Refactor FamiliarOutputChannel to receive output via SSE
- [ ] 6.2 Implement historical output fetch on channel open
- [ ] 6.3 Add sequence number tracking for output continuity
- [ ] 6.4 Remove direct stdout capture

## 7. Question Handling Refactor

- [ ] 7.1 Refactor QuestionHandler to receive questions via SSE
- [ ] 7.2 Refactor question response to use daemon API
- [ ] 7.3 Remove direct stdin injection

## 8. Session Management Refactor

- [ ] 8.1 Refactor CovenSession to delegate to daemon
- [ ] 8.2 Remove FamiliarManager direct agent management
- [ ] 8.3 Remove BeadsTaskSource direct file access
- [ ] 8.4 Remove OrphanRecovery (daemon handles this)

## 9. Remove Deprecated Code

- [ ] 9.1 Remove ClaudeAgent.ts
- [ ] 9.2 Remove direct beads file watching code
- [ ] 9.3 Remove WorktreeManager from extension
- [ ] 9.4 Remove AgentOrchestrator
- [ ] 9.5 Clean up unused imports and types

## 10. Configuration Refactor

- [ ] 10.1 Refactor config loading to read from daemon state
- [ ] 10.2 Refactor config updates to use daemon API
- [ ] 10.3 Remove direct config file watching

## 11. Unit Tests Update

- [ ] 11.1 Update existing unit tests to mock DaemonClient
- [ ] 11.2 Add DaemonClient unit tests
- [ ] 11.3 Add binary management unit tests
- [ ] 11.4 Remove tests for removed functionality
- [ ] 11.5 Ensure 80% coverage maintained

## 12. E2E Tests Update

- [ ] 12.1 Update E2E test setup to ensure daemon is running
- [ ] 12.2 Update E2E tests to verify daemon integration
- [ ] 12.3 Add E2E tests for daemon auto-start
- [ ] 12.4 Add E2E tests for SSE event handling
- [ ] 12.5 Add E2E tests for connection recovery
- [ ] 12.6 Verify existing E2E tests pass with daemon

## 13. Error Handling

- [ ] 13.1 Add user-friendly error messages for daemon connection failures
- [ ] 13.2 Add "View Daemon Logs" action in error notifications
- [ ] 13.3 Add "Restart Daemon" command
- [ ] 13.4 Add status bar indicator for daemon connection state
