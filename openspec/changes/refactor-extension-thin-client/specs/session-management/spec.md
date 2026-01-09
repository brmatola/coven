## MODIFIED Requirements

### Requirement: Session Lifecycle
The system SHALL manage session lifecycle via daemon API rather than directly.

#### Scenario: Start new session
- **WHEN** user starts a session with a feature branch name
- **THEN** extension calls daemon API: POST /session/start
- **THEN** daemon initializes session state
- **THEN** extension receives `session.started` SSE event
- **THEN** extension updates UI to show active session

#### Scenario: Stop session gracefully
- **WHEN** user stops an active session
- **THEN** extension calls daemon API: POST /session/stop
- **THEN** daemon terminates all agents gracefully
- **THEN** extension receives `session.stopped` SSE event
- **THEN** extension updates UI to show inactive session

#### Scenario: Session auto-recovery
- **WHEN** VSCode restarts with daemon running
- **THEN** extension connects to existing daemon
- **THEN** extension fetches current state via GET /state
- **THEN** UI reflects current session state without prompting
- **THEN** if daemon not running, extension starts daemon which recovers state

### Requirement: Session State Access
The system SHALL access session state from daemon cache rather than maintaining local state.

#### Scenario: State snapshot
- **WHEN** any component needs current state
- **THEN** component reads from DaemonClient cached state (sync operation)
- **THEN** cache is updated via SSE events
- **THEN** no blocking API calls for state queries

#### Scenario: State change events
- **WHEN** daemon state changes
- **THEN** daemon emits appropriate SSE event
- **THEN** extension updates local cache
- **THEN** extension emits internal event for UI refresh

### Requirement: Session Configuration
The system SHALL delegate configuration to daemon.

#### Scenario: Configuration persistence
- **WHEN** session is started with configuration
- **THEN** daemon persists configuration
- **THEN** extension does not maintain separate configuration state

#### Scenario: Configuration update
- **WHEN** user changes session settings
- **THEN** extension calls daemon API with new configuration
- **THEN** daemon applies changes
- **THEN** extension receives events reflecting new configuration

### Requirement: Configuration Schema
The system SHALL read configuration from daemon state rather than directly from file.

#### Scenario: Default configuration
- **WHEN** session starts without existing config
- **THEN** daemon creates default configuration
- **THEN** extension reads defaults from daemon state

#### Scenario: Config validation
- **WHEN** configuration is provided
- **THEN** daemon validates configuration
- **THEN** extension receives error response if invalid

#### Scenario: Config reload
- **WHEN** config file changes on disk
- **THEN** daemon detects change and reloads
- **THEN** daemon emits event with new configuration
- **THEN** extension updates without explicit reload

### Requirement: Orphan Familiar Recovery
The system SHALL delegate orphan recovery to daemon.

#### Scenario: Agent process still running
- **WHEN** daemon starts and detects running agent process
- **THEN** daemon reconnects to agent output
- **THEN** daemon emits `agent.spawned` event
- **THEN** extension shows agent as working

#### Scenario: Agent dead with uncommitted work
- **WHEN** daemon detects orphaned work in worktree
- **THEN** daemon notifies via event
- **THEN** extension can trigger re-spawn via daemon API

#### Scenario: Agent dead with committed but unmerged work
- **WHEN** daemon detects unmerged commits
- **THEN** daemon marks task as review
- **THEN** extension receives event and updates UI

#### Scenario: Clean orphan worktree
- **WHEN** daemon detects clean orphan worktree
- **THEN** daemon cleans up worktree
- **THEN** no extension intervention needed

### Requirement: Session Event Logging
The system SHALL rely on daemon for event logging.

#### Scenario: Event logging on state change
- **WHEN** any significant event occurs
- **THEN** daemon logs to `.coven/covend.log`
- **THEN** extension does not maintain separate logs

#### Scenario: Log viewer access
- **WHEN** user wants to inspect logs
- **THEN** extension can open daemon log file
- **THEN** or extension can stream logs via CLI: `coven daemon logs`

### Requirement: Robust Process Tracking
The system SHALL rely on daemon for process tracking.

#### Scenario: Process info persistence
- **WHEN** agent is spawned
- **THEN** daemon persists process info
- **THEN** extension does not track processes directly

#### Scenario: Process identity verification
- **WHEN** daemon recovers
- **THEN** daemon verifies process identity
- **THEN** extension trusts daemon's process state

## ADDED Requirements

### Requirement: Daemon Connection
The extension SHALL manage connection to the per-workspace daemon.

#### Scenario: Connect on activation
- **WHEN** extension activates in coven-enabled workspace
- **THEN** extension attempts to connect to `.coven/covend.sock`
- **THEN** if connection fails, extension auto-starts daemon
- **THEN** extension waits for daemon to be ready (max 5 seconds)

#### Scenario: Connection lost
- **WHEN** connection to daemon is lost
- **THEN** extension attempts to reconnect (3 retries, 1s interval)
- **THEN** if reconnect fails, extension shows error notification
- **THEN** user can manually restart daemon via command

#### Scenario: Daemon version mismatch
- **WHEN** extension connects and daemon version differs significantly
- **THEN** extension shows warning notification
- **THEN** user can choose to restart daemon with bundled version

### Requirement: Daemon Auto-Start
The extension SHALL automatically start the daemon when needed.

#### Scenario: Daemon not running
- **WHEN** extension activates and daemon socket does not respond
- **THEN** extension locates daemon binary (user-installed or bundled)
- **THEN** extension spawns daemon process detached
- **THEN** extension waits for socket to become available

#### Scenario: Binary installation
- **WHEN** daemon binary not found in PATH
- **THEN** extension extracts bundled binary to `~/.coven/bin/`
- **THEN** extension uses extracted binary

#### Scenario: Startup failure
- **WHEN** daemon fails to start within 5 seconds
- **THEN** extension shows error with daemon log path
- **THEN** user can view logs to diagnose

### Requirement: SSE Event Subscription
The extension SHALL maintain persistent SSE connection for real-time updates.

#### Scenario: Event subscription
- **WHEN** extension connects to daemon
- **THEN** extension opens SSE connection to GET /events
- **THEN** all state changes are received via this connection

#### Scenario: Event handling
- **WHEN** SSE event is received
- **THEN** extension updates local state cache
- **THEN** extension triggers UI refresh for affected views

#### Scenario: Connection keepalive
- **WHEN** no events for 30 seconds
- **THEN** daemon sends `state.snapshot` heartbeat
- **THEN** extension confirms connection is alive
- **THEN** extension can detect stale connection and reconnect

### Requirement: Cached State Access
The extension SHALL provide synchronous access to cached state for instant UI.

#### Scenario: TreeView data access
- **WHEN** TreeDataProvider.getChildren() is called
- **THEN** provider reads from DaemonClient.getState() synchronously
- **THEN** no async operations block UI rendering

#### Scenario: State freshness
- **WHEN** SSE event updates cache
- **THEN** cache is immediately available to UI
- **THEN** next UI refresh shows updated state

## REMOVED Requirements

### Requirement: Direct Task Manager
**Reason**: Daemon manages tasks via beads integration.
**Migration**: Extension queries daemon for task state.

### Requirement: Direct Familiar Manager
**Reason**: Daemon manages agent lifecycle.
**Migration**: Extension uses daemon API for agent operations.

### Requirement: In-Extension State Persistence
**Reason**: Daemon handles all state persistence.
**Migration**: Extension relies on daemon for state recovery.
