## ADDED Requirements

### Requirement: Extension Activation
The extension SHALL activate when the user opens a workspace containing a git repository OR when the user explicitly invokes a Coven command.

#### Scenario: Workspace activation
- **WHEN** user opens a folder containing a `.git` directory
- **THEN** the extension activates and registers all commands

#### Scenario: Command activation
- **WHEN** user invokes `coven.startSession` command
- **THEN** the extension activates if not already active

#### Scenario: Graceful deactivation
- **WHEN** VSCode window closes or extension is disabled
- **THEN** the extension cleans up resources and terminates active sessions

### Requirement: Activity Bar Integration
The extension SHALL provide a dedicated view container in the VSCode activity bar with the Coven icon and sidebar panel.

#### Scenario: View container visible
- **WHEN** extension is active
- **THEN** a Coven icon appears in the activity bar
- **THEN** clicking the icon reveals the Coven sidebar

#### Scenario: Sidebar content
- **WHEN** user opens Coven sidebar with no active session
- **THEN** the sidebar displays session setup options

### Requirement: Status Bar Integration
The extension SHALL display a status bar item showing the current Coven state.

#### Scenario: Inactive state
- **WHEN** no Coven session is active
- **THEN** status bar shows "Coven: Inactive"
- **THEN** clicking status bar opens start session dialog

#### Scenario: Active state display
- **WHEN** a Coven session is active
- **THEN** status bar shows summary (e.g., "Coven: 2 working, 1 review")
- **THEN** clicking status bar reveals Coven sidebar

### Requirement: Command Registration
The extension SHALL register core commands for session lifecycle management.

#### Scenario: Start session command
- **WHEN** user invokes `coven.startSession`
- **THEN** session setup flow begins (branch selection, configuration)

#### Scenario: Stop session command
- **WHEN** user invokes `coven.stopSession` with active session
- **THEN** user is prompted to confirm
- **THEN** active agents are terminated and worktrees cleaned up
