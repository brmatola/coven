## ADDED Requirements

### Requirement: Review Panel
The system SHALL provide a dedicated panel for reviewing completed agent work.

#### Scenario: Open review panel
- **WHEN** user clicks "Review" on a task in review status
- **THEN** review panel opens showing task details
- **THEN** panel shows agent's summary of changes made

#### Scenario: Review panel content
- **WHEN** review panel is displayed
- **THEN** header shows task title and completion info
- **THEN** changed files are listed with line counts
- **THEN** acceptance criteria are displayed

### Requirement: Diff Viewing
The system SHALL allow viewing diffs of changes made by agents.

#### Scenario: View file diff
- **WHEN** user clicks "View Diff" on a changed file
- **THEN** VSCode diff editor opens
- **THEN** diff compares feature branch to task branch

#### Scenario: View all changes
- **WHEN** user clicks "View All Changes"
- **THEN** summary diff of all files is shown

### Requirement: Acceptance Criteria Verification
The system SHALL display acceptance criteria with verification status.

#### Scenario: Criteria display
- **WHEN** task has acceptance criteria
- **THEN** criteria are shown as checklist items
- **THEN** auto-verifiable items show computed status

#### Scenario: Test verification
- **WHEN** acceptance criteria includes "tests pass"
- **THEN** system runs tests and shows pass/fail status

### Requirement: Approval Flow
The system SHALL allow approving completed work to merge to feature branch.

#### Scenario: Approve task
- **WHEN** user clicks "Approve"
- **THEN** task branch is merged to feature branch
- **THEN** task status transitions to "done"
- **THEN** worktree is cleaned up
- **THEN** review panel closes

#### Scenario: Approve with feedback
- **WHEN** user provides optional feedback before approving
- **THEN** feedback is logged in activity log

### Requirement: Revert Flow
The system SHALL allow reverting completed work to discard changes.

#### Scenario: Revert confirmation
- **WHEN** user clicks "Revert"
- **THEN** confirmation dialog appears warning changes will be lost

#### Scenario: Revert execution
- **WHEN** user confirms revert
- **THEN** task branch is deleted without merging
- **THEN** worktree is cleaned up
- **THEN** task status returns to "ready"
- **THEN** review panel closes

#### Scenario: Revert with reason
- **WHEN** user provides revert reason
- **THEN** reason is logged in activity log
- **THEN** reason is stored with task for future reference

### Requirement: Pre-Merge Checks
The system SHALL run configurable validation checks before allowing merge to feature branch.

#### Scenario: Check configuration
- **WHEN** pre-merge checks are enabled in `.coven/config.json`
- **THEN** configured commands are available (e.g., `["npm test", "npm run lint"]`)
- **THEN** checks run in the task worktree before merge

#### Scenario: Run checks on approval
- **WHEN** user clicks "Approve" and pre-merge checks are enabled
- **THEN** checks run sequentially in task worktree
- **THEN** progress is shown in review panel
- **THEN** check output is captured and displayable

#### Scenario: Checks pass
- **WHEN** all pre-merge checks pass (exit code 0)
- **THEN** merge proceeds normally
- **THEN** check results are logged

#### Scenario: Checks fail
- **WHEN** any pre-merge check fails (non-zero exit)
- **THEN** merge is blocked
- **THEN** failure output is displayed in review panel
- **THEN** user can choose to fix and re-run, or override

#### Scenario: Override failed checks
- **WHEN** user chooses to override failed checks
- **THEN** confirmation dialog explains risks
- **THEN** override is logged with reason
- **THEN** merge proceeds after confirmation

#### Scenario: Skip checks
- **WHEN** pre-merge checks are disabled in config
- **THEN** approval merges immediately without running checks
- **THEN** no skip confirmation needed
