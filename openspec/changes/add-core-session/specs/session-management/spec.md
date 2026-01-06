## ADDED Requirements

### Requirement: Session Lifecycle
The system SHALL manage a single active Coven session per workspace with defined lifecycle states.

#### Scenario: Start new session
- **WHEN** user starts a session with a feature branch name
- **THEN** CovenSession initializes with the specified branch
- **THEN** TaskManager and FamiliarManager are initialized
- **THEN** session state becomes "active"

#### Scenario: Stop session gracefully
- **WHEN** user stops an active session
- **THEN** all active familiars are terminated
- **THEN** pending work is preserved for recovery
- **THEN** session state becomes "inactive"

#### Scenario: Session auto-recovery
- **WHEN** VSCode restarts with a previously active session
- **THEN** session is automatically restored without prompting
- **THEN** task states and pending reviews are restored
- **THEN** orphan recovery process is initiated for any in-flight familiars

### Requirement: Session State Access
The system SHALL provide a consistent snapshot of session state via `getState()` method.

#### Scenario: State snapshot
- **WHEN** any component calls `getState()`
- **THEN** an immutable snapshot of current state is returned
- **THEN** snapshot includes tasks grouped by status, active familiars, and pending questions

#### Scenario: State change events
- **WHEN** session state changes (task status, familiar status, etc.)
- **THEN** appropriate events are emitted
- **THEN** UI components can subscribe and update reactively

### Requirement: Session Configuration
The system SHALL load and persist session configuration including feature branch, max concurrent agents, and workflow settings.

#### Scenario: Configuration persistence
- **WHEN** session is started with configuration
- **THEN** configuration is persisted to workspace storage
- **THEN** configuration is restored on session recovery

#### Scenario: Configuration update
- **WHEN** user changes session settings during active session
- **THEN** changes take effect immediately where possible
- **THEN** changes requiring restart prompt user appropriately

### Requirement: Orphan Familiar Recovery
The system SHALL attempt to recover orphaned familiars from crashed or restarted sessions rather than discarding their work.

#### Scenario: Agent process still running
- **WHEN** session recovers and detects a worktree with a still-running agent process
- **THEN** the system reconnects to the agent's output stream
- **THEN** familiar status is restored to "working"
- **THEN** monitoring resumes as if uninterrupted

#### Scenario: Agent dead with uncommitted work
- **WHEN** session recovers and detects a worktree with uncommitted changes but no running agent
- **THEN** user is notified of the orphaned work
- **THEN** user can choose to spawn a new agent to continue the task
- **THEN** new agent receives context about prior work via git diff

#### Scenario: Agent dead with committed but unmerged work
- **WHEN** session recovers and detects a worktree with commits not merged to feature branch
- **THEN** task status is set to "review"
- **THEN** user can review and approve the completed work

#### Scenario: Clean orphan worktree
- **WHEN** session recovers and detects a worktree with no uncommitted or unmerged changes
- **THEN** worktree is cleaned up automatically
- **THEN** task status is determined by last persisted state
