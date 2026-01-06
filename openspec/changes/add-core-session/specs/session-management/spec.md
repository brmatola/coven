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

#### Scenario: Session recovery
- **WHEN** VSCode restarts with a previously active session
- **THEN** user is prompted to resume or discard the session
- **THEN** choosing resume restores task states and pending reviews

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
