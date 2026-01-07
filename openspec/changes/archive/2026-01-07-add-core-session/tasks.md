# Tasks: Add Core Session Management

## Implementation
Epic: `coven-4qw` (add-core-session)
Track progress: `bd epic status coven-4qw`
List tasks: `bd list --parent coven-4qw`

## 1. Core Types and Interfaces
- [x] 1.1 Define `Task` interface with id, title, description, status, dependencies, acceptanceCriteria
- [x] 1.2 Define `TaskStatus` type: ready, working, review, done, blocked
- [x] 1.3 Define `TaskSource` interface for pluggable task providers
- [x] 1.4 Define `Familiar` interface representing an active agent
- [x] 1.5 Define `FamiliarStatus` type: working, waiting, merging, complete, failed
- [x] 1.6 Define `CovenState` interface for full session state snapshot
- [x] 1.7 Define event types for state changes

## 2. TaskManager Implementation
- [x] 2.1 Create `TaskManager` class extending EventEmitter
- [x] 2.2 Implement task CRUD operations (add, remove, update)
- [x] 2.3 Implement status transition logic with validation
- [x] 2.4 Implement dependency tracking (task A blocks task B)
- [x] 2.5 Implement task filtering and querying (by status, by source)
- [x] 2.6 Add persistence to workspace storage
- [x] 2.7 Write unit tests for TaskManager

## 3. FamiliarManager Implementation
- [x] 3.1 Create `FamiliarManager` class extending EventEmitter
- [x] 3.2 Implement familiar spawning coordination (respects max concurrent)
- [x] 3.3 Implement familiar termination and cleanup
- [x] 3.4 Track active familiars and their states
- [x] 3.5 Implement question queue for pending agent questions
- [x] 3.6 Write unit tests for FamiliarManager

## 4. CovenSession Implementation
- [x] 4.1 Create `CovenSession` class extending EventEmitter
- [x] 4.2 Implement session lifecycle (start, stop, pause, resume)
- [x] 4.3 Wire up TaskManager and FamiliarManager coordination
- [x] 4.4 Implement `getState()` returning current CovenState snapshot
- [x] 4.5 Implement session configuration loading/saving
- [x] 4.6 Persist session state on every state change
- [x] 4.7 Auto-restore session on extension activation
- [x] 4.8 Write integration tests for CovenSession

## 5. Orphan Familiar Recovery
- [x] 5.1 Store agent PID with familiar state for later recovery
- [x] 5.2 On recovery, enumerate worktrees from previous session
- [x] 5.3 Check if stored PID is still running and is a claude process
- [x] 5.4 Implement reconnection to running agent's output stream
- [x] 5.5 Detect uncommitted changes in orphan worktrees (git status)
- [x] 5.6 Detect unmerged commits in orphan worktrees (git log comparison)
- [x] 5.7 Implement "continue task" flow for dead agent with uncommitted work
- [x] 5.8 Auto-transition to "review" for dead agent with unmerged commits
- [x] 5.9 Clean up worktrees with no recoverable work

## 6. Manual Task Source
- [x] 6.1 Implement `ManualTaskSource` implementing TaskSource interface
- [x] 6.2 Support creating tasks via UI (title, description, acceptance criteria)
- [x] 6.3 Support editing and deleting manual tasks
- [x] 6.4 Persist manual tasks to workspace storage

## 7. E2E Tests
- [x] 7.1 Test: Start session creates active session state
- [x] 7.2 Test: Session persists across VSCode restart
- [x] 7.3 Test: Task status transitions work correctly
- [x] 7.4 Test: Manual task creation and persistence
- [x] 7.5 Test: Session stop cleans up properly
