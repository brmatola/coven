# vscode-extension Specification

## Purpose
Defines the VS Code extension that provides the primary user interface for Coven. The extension integrates with VS Code's activity bar, status bar, and sidebar to enable users to manage multi-agent coding sessions. It handles extension lifecycle, prerequisite detection (CLI tools and repo initialization), and provides the foundation for session management commands.
## Requirements
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

### Requirement: Multi-root Workspace Handling
The extension SHALL detect multi-root workspaces and show an unsupported message.

#### Scenario: Single folder workspace
- **WHEN** workspace contains a single folder with `.git`
- **THEN** that folder is used automatically
- **THEN** extension operates normally

#### Scenario: Multi-root workspace detected
- **WHEN** workspace contains multiple folders
- **THEN** setup panel shows "Multi-root workspaces are not supported"
- **THEN** user is guided to open a single folder workspace

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

### Requirement: Test Infrastructure
The extension SHALL include comprehensive test infrastructure with mocking support for external CLI dependencies.

#### Scenario: CLI mock registry
- **WHEN** tests run
- **THEN** a mock registry is available for CLI commands (`git`, `claude`, `bd`, `gh`, `openspec`)
- **THEN** mocks can be configured per-test with expected inputs and outputs
- **THEN** mocks track call history for assertions

#### Scenario: Git mock provider
- **WHEN** GitProvider is used in tests
- **THEN** MockGitProvider implements same interface
- **THEN** mock supports configurable responses for worktree, branch, merge operations
- **THEN** mock can simulate merge conflicts for conflict resolution testing

#### Scenario: Agent mock provider
- **WHEN** AgentProvider is used in tests
- **THEN** MockAgentProvider implements same interface
- **THEN** mock supports simulated output streaming
- **THEN** mock supports configurable question events
- **THEN** mock supports completion with configurable results

#### Scenario: Beads mock client
- **WHEN** BeadsClient is used in tests
- **THEN** MockBeadsClient implements same interface
- **THEN** mock returns configurable task lists
- **THEN** mock tracks status update calls

#### Scenario: Test utilities
- **WHEN** writing integration tests
- **THEN** test helpers exist for creating mock sessions
- **THEN** test helpers exist for asserting on event emissions
- **THEN** test helpers exist for simulating time passage (fake timers)

#### Scenario: E2E test harness
- **WHEN** E2E tests run
- **THEN** VSCode Extension Test framework is configured
- **THEN** tests can spawn extension in headless VSCode
- **THEN** fixture workspaces are available for common scenarios

