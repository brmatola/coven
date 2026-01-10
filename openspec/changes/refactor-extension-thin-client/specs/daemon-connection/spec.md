## NEW Requirements

### Requirement: Daemon Auto-Start
The extension SHALL automatically start the daemon when needed.

#### Scenario: Extension activates in coven-enabled workspace
- **GIVEN** workspace contains `.coven/` directory
- **WHEN** extension activates
- **THEN** extension attempts to connect to `.coven/covend.sock`
- **THEN** if socket responds, extension subscribes to SSE
- **THEN** if socket does not respond, extension starts bundled daemon

#### Scenario: Daemon not running
- **GIVEN** `.coven/covend.sock` does not respond
- **WHEN** extension needs to connect
- **THEN** extension locates daemon binary (bundled in extension)
- **THEN** extension spawns daemon process detached
- **THEN** extension waits for socket (max 5 seconds)
- **THEN** extension connects and subscribes to SSE

#### Scenario: Non-coven workspace
- **GIVEN** workspace does not contain `.coven/` directory
- **WHEN** extension activates
- **THEN** extension shows welcome view with "Initialize Coven" option
- **THEN** extension does not attempt to start daemon

#### Scenario: Startup failure
- **WHEN** daemon fails to start within 5 seconds
- **THEN** extension shows error notification
- **THEN** notification includes "View Logs" action
- **THEN** extension retries on user command

### Requirement: Connection Management
The extension SHALL maintain a persistent connection to the daemon.

#### Scenario: Successful connection
- **WHEN** extension connects to daemon socket
- **THEN** extension fetches initial state via GET /state
- **THEN** extension opens SSE connection to GET /events
- **THEN** extension emits 'connected' event
- **THEN** status bar shows connected indicator

#### Scenario: Connection lost
- **WHEN** SSE connection drops unexpectedly
- **THEN** extension attempts to reconnect (3 retries, 1s interval)
- **THEN** if reconnect succeeds, extension resumes normal operation
- **THEN** if reconnect fails, extension shows disconnected state
- **THEN** status bar shows disconnected indicator

#### Scenario: Daemon version mismatch
- **WHEN** extension connects and daemon version differs from bundled
- **THEN** extension shows notification with version info
- **THEN** user can choose to restart daemon with bundled version
- **THEN** if user accepts, extension shuts down daemon and restarts

### Requirement: SSE Event Subscription
The extension SHALL receive real-time updates via SSE.

#### Scenario: Initial state
- **WHEN** SSE connection opens
- **THEN** daemon sends `state.snapshot` event immediately
- **THEN** extension populates state cache
- **THEN** UI renders from cache

#### Scenario: State updates
- **WHEN** daemon emits any event
- **THEN** extension updates local state cache
- **THEN** extension emits corresponding internal event
- **THEN** UI components refresh as needed

#### Scenario: Heartbeat
- **WHEN** no events for 30 seconds
- **THEN** daemon sends `state.snapshot` heartbeat
- **THEN** extension confirms connection is alive

### Requirement: Cached State Access
The extension SHALL provide synchronous access to cached state.

#### Scenario: TreeView data access
- **WHEN** TreeDataProvider.getChildren() is called
- **THEN** provider reads from DaemonClient cache synchronously
- **THEN** no async operations block UI rendering
- **THEN** UI is always responsive

#### Scenario: State freshness
- **WHEN** SSE event updates cache
- **THEN** cache is immediately available
- **THEN** next UI refresh shows updated state

### Requirement: Daemon Lifecycle Commands
The extension SHALL provide commands for daemon control.

#### Scenario: Stop daemon
- **WHEN** user executes "Coven: Stop Daemon" command
- **THEN** extension calls POST /shutdown on daemon
- **THEN** daemon gracefully terminates all running agents
- **THEN** daemon saves workflow state for resumption
- **THEN** daemon exits
- **THEN** extension shows disconnected state

#### Scenario: Restart daemon
- **WHEN** user executes "Coven: Restart Daemon" command
- **THEN** extension stops daemon if running
- **THEN** extension starts daemon
- **THEN** extension reconnects

#### Scenario: View daemon logs
- **WHEN** user executes "Coven: View Daemon Logs" command
- **THEN** extension opens `.coven/logs/daemon.log` in editor

### Requirement: Binary Management
The extension SHALL bundle and manage the daemon binary.

#### Scenario: Binary extraction
- **WHEN** extension needs daemon binary
- **THEN** extension checks for binary at `~/.coven/bin/covend`
- **THEN** if not present or version differs, extension extracts from bundle
- **THEN** extension sets executable permissions

#### Scenario: Platform detection
- **WHEN** extracting binary
- **THEN** extension selects correct binary for platform
- **THEN** supported: darwin-arm64, darwin-amd64, linux-amd64, linux-arm64

### Requirement: Error Handling
The extension SHALL handle daemon errors gracefully.

#### Scenario: Daemon crashes
- **WHEN** daemon process exits unexpectedly
- **THEN** extension detects via SSE disconnection
- **THEN** extension shows error notification
- **THEN** notification offers "Restart Daemon" action

#### Scenario: API errors
- **WHEN** daemon API returns error
- **THEN** extension shows user-friendly error message
- **THEN** extension does not crash
- **THEN** extension remains in valid state

#### Scenario: Socket permission error
- **WHEN** socket file has wrong permissions
- **THEN** extension shows clear error message
- **THEN** message suggests remediation steps
