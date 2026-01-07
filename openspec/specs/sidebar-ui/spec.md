# sidebar-ui Specification

## Purpose
TBD - created by archiving change add-sidebar-views. Update Purpose after archive.
## Requirements
### Requirement: Task List Display
The system SHALL display all tasks in a tree view grouped by status.

#### Scenario: Task groups
- **WHEN** sidebar is visible
- **THEN** tasks are grouped under status headers (Ready, Working, Review, Done, Blocked)
- **THEN** each group shows count of tasks in that status

#### Scenario: Task item display
- **WHEN** a task exists in the task list
- **THEN** task item shows title and status icon
- **THEN** working tasks show elapsed time
- **THEN** blocked tasks show blocking reason

#### Scenario: Real-time updates
- **WHEN** task status changes
- **THEN** task moves to appropriate group immediately
- **THEN** tree view refreshes without losing scroll position

### Requirement: Session Header
The system SHALL display session information at the top of the sidebar.

#### Scenario: Active session header
- **WHEN** a session is active
- **THEN** header shows feature branch name
- **THEN** header shows summary stats (tasks complete, lines changed, test status)
- **THEN** header has settings and promote actions

#### Scenario: No session state
- **WHEN** no session is active
- **THEN** sidebar shows "Start a Session" prompt
- **THEN** clicking prompt opens session setup

### Requirement: Working Task Details
The system SHALL show agent status for tasks being worked on.

#### Scenario: Agent status display
- **WHEN** a task is in "working" status
- **THEN** familiar status is shown (working, waiting, merging)
- **THEN** elapsed time is displayed
- **THEN** quick actions available (view output, cancel)

#### Scenario: Awaiting response highlight
- **WHEN** an agent is waiting for human response
- **THEN** task is visually highlighted
- **THEN** "Respond" action is prominently displayed

### Requirement: Status Bar Integration
The system SHALL display session summary in VSCode status bar.

#### Scenario: Status bar inactive
- **WHEN** no session is active
- **THEN** status bar shows "Coven: Inactive"
- **THEN** clicking opens session setup

#### Scenario: Status bar active
- **WHEN** session is active
- **THEN** status bar shows summary (e.g., "Coven: 2 working, 1 review")
- **THEN** clicking reveals sidebar

#### Scenario: Attention needed
- **WHEN** an agent needs human response
- **THEN** status bar pulses or highlights
- **THEN** tooltip shows question summary

### Requirement: Session Setup
The system SHALL provide a setup flow for starting new sessions.

#### Scenario: Branch selection
- **WHEN** starting a new session
- **THEN** user can select existing feature branch or create new
- **THEN** new branch is created from base branch (main)

#### Scenario: Configuration options
- **WHEN** setting up session
- **THEN** user can configure max concurrent agents
- **THEN** user can configure worktree location
- **THEN** user can configure auto-approve settings

### Requirement: Task Quick Actions
The system SHALL provide contextual actions for tasks via tree item actions.

#### Scenario: Ready task actions
- **WHEN** viewing a ready task
- **THEN** "Start" action is available to assign agent
- **THEN** "Edit" action opens task detail

#### Scenario: Working task actions
- **WHEN** viewing a working task
- **THEN** "View Output" opens agent output panel
- **THEN** "Stop" terminates the agent

#### Scenario: Review task actions
- **WHEN** viewing a review task
- **THEN** "Review" opens review panel

### Requirement: Task List Scaling
The system SHALL handle large task lists efficiently with virtualization and search.

#### Scenario: Virtualized scrolling
- **WHEN** task list contains many items (50+)
- **THEN** list uses virtualized rendering (only visible items in DOM)
- **THEN** scroll performance remains smooth
- **THEN** memory usage scales O(visible) not O(total)

#### Scenario: Task search
- **WHEN** user types in search input
- **THEN** task list filters to matching titles/descriptions
- **THEN** filtering happens instantly (debounced 150ms)
- **THEN** clearing search restores full list

#### Scenario: Search with Beads index
- **WHEN** Beads is available and has search capability
- **THEN** search queries Beads cached database for performance
- **THEN** fallback to local in-memory filter if Beads unavailable

#### Scenario: Filter by status
- **WHEN** user selects status filter
- **THEN** only tasks with that status are shown
- **THEN** filter combines with search (AND logic)
- **THEN** filter state persists across sessions

