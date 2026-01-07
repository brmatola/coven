# git-operations Specification

## Purpose
TBD - created by archiving change add-git-worktree-management. Update Purpose after archive.
## Requirements
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
The system SHALL attempt to resolve merge conflicts using a dedicated merge agent before escalating to human.

#### Scenario: AI resolves conflict
- **WHEN** merge conflict occurs
- **THEN** a merge agent is spawned with conflict context (both branches, task descriptions, conflicting files)
- **THEN** merge agent proposes resolution
- **THEN** resolution is validated (compiles, tests pass if applicable)
- **THEN** resolution is applied and merge continues

#### Scenario: AI cannot resolve conflict
- **WHEN** merge agent fails to resolve conflict after max attempts (default: 2)
- **THEN** conflict is escalated to user
- **THEN** task status becomes "blocked"
- **THEN** user is notified with conflict details and diff

### Requirement: Merge Queue Coordination
The system SHALL serialize merges to the feature branch to prevent race conditions when multiple agents complete concurrently.

#### Scenario: Sequential merge queue
- **WHEN** multiple tasks complete and enter review status
- **THEN** approved tasks are queued for merge in approval order
- **THEN** merges execute one at a time
- **THEN** subsequent merges rebase on updated feature branch before merging

#### Scenario: Merge queue conflict
- **WHEN** a queued merge would conflict with a just-completed merge
- **THEN** merge agent is invoked to resolve
- **THEN** if unresolvable, task returns to "review" with conflict notification
- **THEN** user can re-review with updated context

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

