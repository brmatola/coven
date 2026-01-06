# Tasks: Add Core Session Management

## 1. Core Types and Interfaces
- [ ] 1.1 Define `Task` interface with id, title, description, status, dependencies, acceptanceCriteria
- [ ] 1.2 Define `TaskStatus` type: ready, working, review, done, blocked
- [ ] 1.3 Define `TaskSource` interface for pluggable task providers
- [ ] 1.4 Define `Familiar` interface representing an active agent
- [ ] 1.5 Define `FamiliarStatus` type: working, waiting, merging, complete, failed
- [ ] 1.6 Define `CovenState` interface for full session state snapshot
- [ ] 1.7 Define event types for state changes

## 2. TaskManager Implementation
- [ ] 2.1 Create `TaskManager` class extending EventEmitter
- [ ] 2.2 Implement task CRUD operations (add, remove, update)
- [ ] 2.3 Implement status transition logic with validation
- [ ] 2.4 Implement dependency tracking (task A blocks task B)
- [ ] 2.5 Implement task filtering and querying (by status, by source)
- [ ] 2.6 Add persistence to workspace storage
- [ ] 2.7 Write unit tests for TaskManager

## 3. FamiliarManager Implementation
- [ ] 3.1 Create `FamiliarManager` class extending EventEmitter
- [ ] 3.2 Implement familiar spawning coordination (respects max concurrent)
- [ ] 3.3 Implement familiar termination and cleanup
- [ ] 3.4 Track active familiars and their states
- [ ] 3.5 Implement question queue for pending agent questions
- [ ] 3.6 Write unit tests for FamiliarManager

## 4. CovenSession Implementation
- [ ] 4.1 Create `CovenSession` class extending EventEmitter
- [ ] 4.2 Implement session lifecycle (start, stop, pause, resume)
- [ ] 4.3 Wire up TaskManager and FamiliarManager coordination
- [ ] 4.4 Implement `getState()` returning current CovenState snapshot
- [ ] 4.5 Implement session configuration loading/saving
- [ ] 4.6 Persist session state on every state change
- [ ] 4.7 Auto-restore session on extension activation
- [ ] 4.8 Write integration tests for CovenSession

## 5. Orphan Familiar Recovery
- [ ] 5.1 Store agent PID with familiar state for later recovery
- [ ] 5.2 On recovery, enumerate worktrees from previous session
- [ ] 5.3 Check if stored PID is still running and is a claude process
- [ ] 5.4 Implement reconnection to running agent's output stream
- [ ] 5.5 Detect uncommitted changes in orphan worktrees (git status)
- [ ] 5.6 Detect unmerged commits in orphan worktrees (git log comparison)
- [ ] 5.7 Implement "continue task" flow for dead agent with uncommitted work
- [ ] 5.8 Auto-transition to "review" for dead agent with unmerged commits
- [ ] 5.9 Clean up worktrees with no recoverable work

## 6. Manual Task Source
- [ ] 6.1 Implement `ManualTaskSource` implementing TaskSource interface
- [ ] 6.2 Support creating tasks via UI (title, description, acceptance criteria)
- [ ] 6.3 Support editing and deleting manual tasks
- [ ] 6.4 Persist manual tasks to workspace storage

## 7. E2E Tests
- [ ] 7.1 Test: Start session creates active session state
- [ ] 7.2 Test: Session persists across VSCode restart
- [ ] 7.3 Test: Task status transitions work correctly
- [ ] 7.4 Test: Manual task creation and persistence
- [ ] 7.5 Test: Session stop cleans up properly
