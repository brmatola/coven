## ADDED Requirements

### Requirement: Conjure Panel
The system SHALL provide a panel for creating pull requests from completed feature work.

#### Scenario: Open conjure panel
- **WHEN** user clicks "Promote" or invokes conjure command
- **THEN** conjure panel opens
- **THEN** panel shows feature branch and target (main)

#### Scenario: Panel content
- **WHEN** conjure panel is displayed
- **THEN** all completed tasks are listed with summaries
- **THEN** aggregate statistics are shown
- **THEN** readiness status is displayed

### Requirement: Readiness Checks
The system SHALL verify prerequisites before allowing PR creation.

#### Scenario: All tasks complete
- **WHEN** all tasks are in "done" status
- **THEN** ready check passes

#### Scenario: Pending tasks warning
- **WHEN** tasks remain in non-done status
- **THEN** warning is displayed
- **THEN** user can proceed anyway with confirmation

#### Scenario: Tests passing check
- **WHEN** tests have been run
- **THEN** pass/fail status is displayed
- **THEN** failing tests show warning but don't block

### Requirement: PR Content Generation
The system SHALL generate PR title and description from completed work.

#### Scenario: Auto-generated title
- **WHEN** conjure panel opens
- **THEN** suggested title is generated from branch name or task summaries
- **THEN** title is editable

#### Scenario: Auto-generated description
- **WHEN** conjure panel opens
- **THEN** description summarizes all completed tasks
- **THEN** description includes test plan section
- **THEN** description is editable

#### Scenario: Coven attribution
- **WHEN** PR is created
- **THEN** description footer indicates work was done with Coven

### Requirement: PR Creation
The system SHALL create GitHub pull requests using the GitHub CLI.

#### Scenario: Create PR
- **WHEN** user clicks "Create Pull Request"
- **THEN** feature branch is pushed to remote if needed
- **THEN** PR is created via `gh pr create`
- **THEN** PR URL is returned and displayed

#### Scenario: PR creation error
- **WHEN** PR creation fails (auth, network, etc.)
- **THEN** error message is displayed
- **THEN** user can retry or copy command to run manually

#### Scenario: PR already exists
- **WHEN** PR already exists for the branch
- **THEN** user is informed and offered to open existing PR

### Requirement: Direct Merge Option
The system SHALL support merging directly without a PR for small projects.

#### Scenario: Direct merge selection
- **WHEN** user selects "Merge directly"
- **THEN** confirmation dialog warns this bypasses review
- **THEN** on confirm, feature branch is merged to main

#### Scenario: Direct merge execution
- **WHEN** direct merge is confirmed
- **THEN** feature branch is merged to main with merge commit
- **THEN** success message is shown

### Requirement: Post-Conjure Actions
The system SHALL provide follow-up actions after successful PR creation.

#### Scenario: Success display
- **WHEN** PR is created successfully
- **THEN** success message shows PR number and URL
- **THEN** "Open in Browser" action is available

#### Scenario: Session cleanup
- **WHEN** conjure completes
- **THEN** user is offered to end session
- **THEN** declining keeps session active for further work
