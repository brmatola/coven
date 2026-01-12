## ADDED Requirements

### Requirement: Custom Commit Messages
Merge steps SHALL support custom commit message templates.

#### Scenario: Template-rendered commit message
- **WHEN** a merge step defines `commit_message: "{{.task.type}}: {{.task.title}}"`
- **AND** the task type is "feature" and title is "Add login"
- **THEN** the commit message is "feature: Add login"

#### Scenario: Multi-line commit message
- **WHEN** a merge step defines a multi-line `commit_message`
- **THEN** the first line is the commit title
- **AND** remaining lines are the commit body

#### Scenario: Default commit message
- **WHEN** a merge step does not define `commit_message`
- **THEN** an auto-generated message is used including task ID and summary

#### Scenario: Access workflow context in commit message
- **WHEN** a merge step references `{{.implement.summary}}` in commit message
- **THEN** the agent's summary from the implement step is included

### Requirement: Rebase Action
The system SHALL support rebasing worktrees onto the latest target branch.

#### Scenario: Manual rebase via UI
- **WHEN** the target branch has diverged
- **AND** user clicks "Rebase" in review panel
- **THEN** the worktree is rebased onto the latest target

#### Scenario: Rebase success
- **WHEN** rebase completes without conflicts
- **THEN** the review panel refreshes with updated diff
- **AND** merge can proceed

#### Scenario: Rebase conflict
- **WHEN** rebase encounters conflicts
- **THEN** the workflow status becomes "rebase_conflict"
- **AND** conflicting files are listed
- **AND** user can open worktree to resolve

#### Scenario: Auto-rebase option
- **WHEN** a merge step defines `auto_rebase: true`
- **AND** target branch has diverged
- **THEN** rebase is attempted automatically before merge
- **AND** if conflicts occur, workflow blocks for manual resolution

### Requirement: Pre-Merge Checks
Merge steps SHALL support pre-merge validation scripts.

#### Scenario: Pre-merge checks pass
- **WHEN** a merge step defines `pre_merge: ["npm run lint", "npm test"]`
- **AND** both commands exit with code 0
- **THEN** merge proceeds normally

#### Scenario: Pre-merge check fails
- **WHEN** a merge step defines `pre_merge: ["npm test"]`
- **AND** the command exits with code 1
- **THEN** merge is blocked
- **AND** review panel shows check failure with output

#### Scenario: Multiple pre-merge checks
- **WHEN** a merge step defines multiple pre-merge commands
- **THEN** all commands run sequentially
- **AND** if any fails, subsequent checks are skipped
- **AND** all results are shown in review panel
