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
- **THEN** the sidebar displays session setup options OR setup required panel if prerequisites missing

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

### Requirement: Prerequisites Checking
The extension SHALL verify required CLI tools and repo initialization before allowing session start.

#### Scenario: Check CLI tools on activation
- **WHEN** extension activates
- **THEN** system checks for `git`, `claude`, `openspec`, and `bd` CLI commands
- **THEN** availability status is cached for display

#### Scenario: Check repo initialization
- **WHEN** extension activates in a git repository
- **THEN** system checks for `openspec/` directory (OpenSpec initialized)
- **THEN** system checks for `.beads/` directory (Beads initialized)

#### Scenario: All prerequisites met
- **WHEN** all CLI tools are available AND repo is initialized
- **THEN** extension operates normally
- **THEN** session setup is available

#### Scenario: Missing CLI tools
- **WHEN** any required CLI tool is missing
- **THEN** setup panel displays which tools are missing
- **THEN** install instructions/links are provided for each missing tool
- **THEN** "Check Again" button re-runs detection

#### Scenario: Repo not initialized
- **WHEN** CLI tools are present but repo lacks OpenSpec or Beads initialization
- **THEN** setup panel shows initialization status
- **THEN** "Initialize OpenSpec" button runs `openspec init --tools claude` with confirmation
- **THEN** "Initialize Beads" button runs `bd init` with confirmation

#### Scenario: Initialization success
- **WHEN** user clicks initialize button and command succeeds
- **THEN** status updates to show initialization complete
- **THEN** user can proceed to session setup
