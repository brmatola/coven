## ADDED Requirements

### Requirement: Worktree Lifecycle
The system SHALL manage git worktrees for isolated agent workspaces with automatic creation and cleanup.

#### Scenario: Create worktree for task
- **WHEN** an agent is assigned to a task
- **THEN** a new worktree is created at `{basePath}/{sessionId}/{taskId}`
- **THEN** a task-specific branch is created from the feature branch
- **THEN** the worktree is checked out to the task branch

#### Scenario: Cleanup worktree after merge
- **WHEN** a task's changes are successfully merged to the feature branch
- **THEN** the worktree is removed
- **THEN** the task branch is deleted

#### Scenario: Cleanup on task termination
- **WHEN** a task is terminated without completion
- **THEN** uncommitted changes in the worktree are discarded
- **THEN** the worktree is removed
- **THEN** the task branch is deleted

### Requirement: Orphan Worktree Detection
The system SHALL detect and clean up orphaned worktrees from crashed sessions.

#### Scenario: Detect orphaned worktrees
- **WHEN** session starts
- **THEN** existing worktrees in the base path are checked
- **THEN** worktrees not associated with active sessions are identified

#### Scenario: Clean up orphaned worktrees
- **WHEN** orphaned worktrees are detected
- **THEN** user is prompted to clean them up
- **THEN** confirmed orphans are removed with their branches

### Requirement: Merge to Feature Branch
The system SHALL merge completed task branches to the feature branch with conflict handling.

#### Scenario: Clean merge
- **WHEN** task branch has no conflicts with feature branch
- **THEN** changes are merged to feature branch
- **THEN** merge commit references the task ID

#### Scenario: Merge with conflicts
- **WHEN** task branch has conflicts with feature branch
- **THEN** ConflictResolver is invoked
- **THEN** resolved conflicts are committed
- **THEN** merge completes after resolution

### Requirement: AI-Assisted Conflict Resolution
The system SHALL attempt to resolve merge conflicts using an AI agent before escalating to human.

#### Scenario: AI resolves conflict
- **WHEN** merge conflict occurs
- **THEN** an AI agent is given the conflict context and task description
- **THEN** agent proposes resolution
- **THEN** resolution is applied and merge continues

#### Scenario: AI cannot resolve conflict
- **WHEN** AI agent fails to resolve conflict after max attempts
- **THEN** conflict is escalated to user
- **THEN** task status becomes "blocked"
- **THEN** user is notified with conflict details

### Requirement: Branch Operations
The system SHALL support creating and managing branches for sessions and tasks.

#### Scenario: Create feature branch
- **WHEN** session starts with a new branch name
- **THEN** feature branch is created from base branch (main)
- **THEN** feature branch is checked out in main worktree

#### Scenario: Use existing feature branch
- **WHEN** session starts with an existing branch name
- **THEN** existing branch is used
- **THEN** no new branch is created
