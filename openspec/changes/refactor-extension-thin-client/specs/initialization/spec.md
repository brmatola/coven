## NEW Requirements

### Requirement: Git Repository Detection
The extension SHALL verify the workspace is a git repository before initialization.

#### Scenario: Not a git repo
- **GIVEN** workspace is not a git repository
- **WHEN** extension activates
- **THEN** extension shows welcome view with "Initialize Git" option
- **THEN** clicking "Initialize Git" runs `git init`
- **THEN** extension prompts for next steps (beads, coven)

#### Scenario: Git repo exists
- **GIVEN** workspace is a git repository
- **WHEN** extension activates
- **THEN** extension proceeds to check for coven/beads

### Requirement: Component Detection
The extension SHALL detect which components are initialized.

#### Scenario: Check initialization state
- **WHEN** extension activates in git repo
- **THEN** extension checks for `.coven/` directory
- **THEN** extension checks for `.beads/` directory
- **THEN** extension checks for `openspec/` directory
- **THEN** extension determines initialization state

#### Scenario: Fully initialized
- **GIVEN** `.coven/`, `.beads/`, and `openspec/` all exist
- **WHEN** extension activates
- **THEN** extension connects to daemon normally
- **THEN** no initialization prompts shown

#### Scenario: Partially initialized
- **GIVEN** some components missing
- **WHEN** extension activates
- **THEN** extension shows setup view listing missing components
- **THEN** user can choose to initialize missing components

### Requirement: Coven Initialization
The extension SHALL initialize `.coven/` directory structure.

#### Scenario: Initialize coven
- **WHEN** user clicks "Initialize Coven"
- **THEN** extension creates `.coven/` directory
- **THEN** extension creates `.coven/config.yaml` with defaults
- **THEN** daemon auto-starts and copies default grimoires/spells
- **THEN** extension shows success message

#### Scenario: Config defaults
- **WHEN** `.coven/config.yaml` is created
- **THEN** config contains:
  ```yaml
  max_concurrent_agents: 2
  agent_command: claude
  ```
- **THEN** user can edit config manually for customization

### Requirement: Beads Initialization
The extension SHALL offer to initialize beads if missing.

#### Scenario: Beads not installed
- **GIVEN** `bd` command not found in PATH
- **WHEN** extension checks for beads
- **THEN** extension shows "Beads not installed" message
- **THEN** extension offers installation instructions or script
- **THEN** message includes link to beads documentation

#### Scenario: Initialize beads in workspace
- **GIVEN** beads is installed but `.beads/` missing
- **WHEN** user clicks "Initialize Beads"
- **THEN** extension runs `bd init` in workspace
- **THEN** extension waits for completion
- **THEN** extension shows success or error message

### Requirement: OpenSpec Initialization
The extension SHALL offer to initialize openspec if missing.

#### Scenario: OpenSpec not present
- **GIVEN** `openspec/` directory missing
- **WHEN** user clicks "Initialize OpenSpec"
- **THEN** extension runs `openspec init` in workspace
- **THEN** extension shows success or error message

#### Scenario: OpenSpec CLI not installed
- **GIVEN** `openspec` command not found
- **WHEN** user wants to initialize openspec
- **THEN** extension shows installation instructions
- **THEN** message includes link to openspec documentation

### Requirement: Setup View
The extension SHALL provide a setup/welcome view.

#### Scenario: Welcome view content
- **WHEN** workspace missing required components
- **THEN** extension shows welcome view in sidebar
- **THEN** view shows checklist of components:
  - [ ] Git repository
  - [ ] Beads (.beads/)
  - [ ] Coven (.coven/)
  - [ ] OpenSpec (openspec/) [optional]
- **THEN** each missing item has [Initialize] button

#### Scenario: Progressive initialization
- **WHEN** user initializes a component
- **THEN** checklist updates to show completion
- **THEN** next component becomes actionable
- **THEN** when all required complete, view transitions to main UI

#### Scenario: Skip optional components
- **GIVEN** openspec is optional
- **WHEN** beads and coven are initialized
- **THEN** extension can proceed without openspec
- **THEN** user can initialize openspec later via command

### Requirement: Initialization Commands
The extension SHALL provide commands for initialization.

#### Scenario: Command palette initialization
- **WHEN** user runs "Coven: Initialize Workspace"
- **THEN** extension shows setup wizard/view
- **THEN** wizard guides through missing components

#### Scenario: Individual component commands
- **WHEN** user runs "Coven: Initialize Beads"
- **THEN** extension runs beads initialization only
- **WHEN** user runs "Coven: Initialize OpenSpec"
- **THEN** extension runs openspec initialization only

### Requirement: Dependency Order
The extension SHALL respect initialization dependencies.

#### Scenario: Git required first
- **WHEN** git is not initialized
- **THEN** beads and coven buttons are disabled
- **THEN** tooltip explains "Git repository required"

#### Scenario: No strict order for beads/coven
- **GIVEN** git is initialized
- **WHEN** user wants to initialize
- **THEN** beads and coven can be initialized in any order
- **THEN** both work independently

### Requirement: Error Handling
The extension SHALL handle initialization errors gracefully.

#### Scenario: Command not found
- **WHEN** required CLI tool not in PATH
- **THEN** extension shows clear error message
- **THEN** message includes installation instructions
- **THEN** user can retry after installing

#### Scenario: Permission error
- **WHEN** initialization fails due to permissions
- **THEN** extension shows error with suggested fix
- **THEN** user can retry after fixing permissions

#### Scenario: Partial initialization failure
- **WHEN** initialization fails midway
- **THEN** extension shows what succeeded and what failed
- **THEN** user can retry failed step
