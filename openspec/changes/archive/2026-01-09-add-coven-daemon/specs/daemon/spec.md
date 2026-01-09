## ADDED Requirements

### Requirement: Daemon Lifecycle
The daemon SHALL manage its own lifecycle with clean startup and shutdown semantics.

#### Scenario: Daemon startup
- **WHEN** `covend --workspace=/path/to/repo` is invoked
- **THEN** daemon creates `.coven/covend.sock` Unix socket
- **THEN** daemon writes PID to `.coven/covend.pid`
- **THEN** daemon begins listening for HTTP requests on socket
- **THEN** daemon loads persisted state from `.coven/state.json` if exists

#### Scenario: Daemon already running
- **WHEN** `covend` is invoked but socket already exists and responds to health check
- **THEN** daemon exits with error "daemon already running"
- **THEN** existing daemon continues unaffected

#### Scenario: Stale socket cleanup
- **WHEN** `covend` starts and socket exists but health check fails
- **THEN** daemon removes stale socket file
- **THEN** daemon starts normally

#### Scenario: Graceful shutdown
- **WHEN** daemon receives SIGTERM or POST /shutdown
- **THEN** daemon stops accepting new connections
- **THEN** daemon stops all running agents gracefully
- **THEN** daemon persists current state to `.coven/state.json`
- **THEN** daemon removes socket and PID files
- **THEN** daemon exits with code 0

#### Scenario: Daemon crash recovery
- **WHEN** daemon crashes without cleanup
- **THEN** next startup detects stale socket via failed health check
- **THEN** daemon cleans up and starts fresh
- **THEN** state is recovered from `.coven/state.json`

### Requirement: Session Control
The daemon SHALL manage session state indicating whether work should be actively scheduled.

#### Scenario: Start session
- **WHEN** POST /session/start with featureBranch and optional maxAgents
- **THEN** session.started becomes true
- **THEN** session.featureBranch is set
- **THEN** beads polling loop begins
- **THEN** scheduler loop begins reconciling agents
- **THEN** SSE event `session.started` is emitted

#### Scenario: Stop session gracefully
- **WHEN** POST /session/stop
- **THEN** scheduler stops assigning new tasks
- **THEN** running agents receive SIGTERM
- **THEN** daemon waits up to 10 seconds for agents to exit
- **THEN** beads polling loop stops
- **THEN** session.started becomes false
- **THEN** SSE event `session.stopped` is emitted

#### Scenario: Force stop session
- **WHEN** POST /session/stop?force=1
- **THEN** running agents receive SIGKILL immediately
- **THEN** session.started becomes false
- **THEN** SSE event `session.stopped` is emitted with reason "force"

#### Scenario: Session persistence
- **WHEN** daemon restarts with persisted state showing started=true
- **THEN** session is restored to started state
- **THEN** orphaned agents are detected and recovered
- **THEN** beads polling and scheduler resume

### Requirement: Task Synchronization
The daemon SHALL synchronize task state from beads using `bd ready --json` and maintain a cached copy for instant queries.

#### Scenario: Initial task load
- **WHEN** session starts
- **THEN** daemon calls `bd ready --json` to get ready tasks
- **THEN** tasks are cached in memory
- **THEN** GET /tasks returns cached tasks instantly

#### Scenario: Polling sync
- **WHEN** session is active
- **THEN** daemon polls `bd ready --json` every 1 second
- **THEN** cache is updated with new results
- **THEN** SSE event `tasks.changed` is emitted if tasks differ

#### Scenario: Immediate sync on state change
- **WHEN** agent completes or fails
- **THEN** daemon immediately polls `bd ready --json`
- **THEN** ensures UI reflects latest task state

#### Scenario: Task filtering by beads
- **WHEN** scheduler needs ready tasks
- **THEN** daemon uses cached results from `bd ready --json`
- **THEN** beads has already filtered by: status=open, dependencies satisfied
- **THEN** daemon does not duplicate dependency logic

### Requirement: Task State Updates
The daemon SHALL update task state in beads when agent status changes.

#### Scenario: Agent starts task
- **WHEN** scheduler assigns agent to task
- **THEN** daemon calls `bd update <taskId> --status=in_progress`
- **THEN** task is removed from ready queue on next poll

#### Scenario: Agent completes task
- **WHEN** agent signals successful completion
- **THEN** daemon calls `bd update <taskId> --status=review`
- **THEN** task appears in review state on next poll

#### Scenario: Agent fails task
- **WHEN** agent fails or times out
- **THEN** daemon calls `bd update <taskId> --label=blocked`
- **THEN** daemon adds comment with failure reason

### Requirement: Agent Scheduling
The daemon SHALL automatically schedule agents to work on ready tasks when session is started.

#### Scenario: Reconciliation loop
- **WHEN** session is started
- **THEN** scheduler runs reconciliation every 1 second
- **THEN** reconciliation compares: ready tasks vs running agents
- **THEN** if running < maxAgents and ready tasks exist, spawn agent

#### Scenario: Agent assignment
- **WHEN** scheduler decides to spawn agent for task
- **THEN** task status is updated via `bd update`
- **THEN** worktree is created for task
- **THEN** claude process is spawned in worktree
- **THEN** agent entry is added to state
- **THEN** SSE event `agent.spawned` is emitted

#### Scenario: Max agents respected
- **WHEN** running agents equals maxAgents
- **THEN** scheduler does not spawn additional agents
- **THEN** ready tasks wait until agent slot becomes available

#### Scenario: Task selection
- **WHEN** multiple ready tasks exist and agent slot available
- **THEN** first task from `bd ready --json` is selected
- **THEN** beads has already sorted by priority

### Requirement: Agent Execution
The daemon SHALL spawn, monitor, and manage claude agent processes.

#### Scenario: Agent spawning
- **WHEN** scheduler assigns task to agent
- **THEN** daemon creates git worktree at `.coven/worktrees/{taskId}`
- **THEN** daemon spawns `claude --print --verbose` in worktree
- **THEN** agent stdin/stdout/stderr are captured
- **THEN** agent process info is persisted for recovery

#### Scenario: Output streaming
- **WHEN** agent produces stdout output
- **THEN** output is buffered with sequence numbers
- **THEN** SSE event `agent.output` is emitted with chunk and seq
- **THEN** output buffer is capped at 10MB per agent (ring buffer)

#### Scenario: Completion detection
- **WHEN** agent process exits with code 0
- **THEN** daemon parses output for completion signal
- **THEN** task is updated via `bd update --status=review`
- **THEN** agent is removed from active agents
- **THEN** SSE event `agent.completed` is emitted

#### Scenario: Failure detection
- **WHEN** agent process exits with non-zero code
- **THEN** task is updated via `bd update --label=blocked`
- **THEN** agent is removed from active agents
- **THEN** SSE event `agent.failed` is emitted with error

#### Scenario: Agent timeout
- **WHEN** agent runs longer than configured timeout (default 10 minutes)
- **THEN** agent receives SIGTERM
- **THEN** if not exited after 10s, agent receives SIGKILL
- **THEN** task is marked as blocked with "timeout" reason
- **THEN** SSE event `agent.failed` is emitted

### Requirement: Question Handling
The daemon SHALL detect agent questions and route them for response.

#### Scenario: Question detection
- **WHEN** agent output contains question pattern
- **THEN** question is parsed and categorized
- **THEN** question is added to pendingQuestions
- **THEN** SSE event `agent.question` is emitted

#### Scenario: Question response
- **WHEN** POST /agents/:id/respond with response
- **THEN** response is written to agent's stdin
- **THEN** question is removed from pendingQuestions
- **THEN** agent continues execution

#### Scenario: Unanswered question timeout
- **WHEN** question remains unanswered for 5 minutes
- **THEN** SSE event `agent.question` is re-emitted as reminder
- **THEN** question remains pending until answered or agent terminated

### Requirement: State Queries
The daemon SHALL provide instant state queries from cached data.

#### Scenario: Full state query
- **WHEN** GET /state
- **THEN** complete RepoState is returned
- **THEN** response is from cache, no blocking I/O
- **THEN** response time is under 10ms

#### Scenario: Task list query
- **WHEN** GET /tasks
- **THEN** cached task list from `bd ready --json` is returned

#### Scenario: Agent list query
- **WHEN** GET /agents
- **THEN** running agents are returned
- **THEN** includes pid, taskId, status, lastOutput

#### Scenario: Output buffer query
- **WHEN** GET /agents/:id/output?since=42
- **THEN** output chunks with seq > 42 are returned
- **THEN** enables efficient incremental fetching

### Requirement: Event Streaming
The daemon SHALL provide SSE event stream for real-time updates.

#### Scenario: Client subscription
- **WHEN** GET /events with Accept: text/event-stream
- **THEN** connection is kept open
- **THEN** events are pushed as they occur
- **THEN** connection ID is logged for debugging

#### Scenario: Event delivery
- **WHEN** state changes (agent spawned, output, question, etc.)
- **THEN** event is broadcast to all connected SSE clients
- **THEN** event includes type and JSON data

#### Scenario: Heartbeat
- **WHEN** 30 seconds elapse without events
- **THEN** `state.snapshot` event is sent with full state
- **THEN** keeps connection alive and enables recovery

#### Scenario: Client disconnect
- **WHEN** SSE client disconnects
- **THEN** connection resources are cleaned up
- **THEN** daemon continues operating normally

### Requirement: Worktree Management
The daemon SHALL manage git worktrees for agent isolation.

#### Scenario: Worktree creation
- **WHEN** agent is assigned to task
- **THEN** worktree is created at `.coven/worktrees/{taskId}`
- **THEN** worktree is based on current feature branch HEAD
- **THEN** worktree has unique branch name `coven/{taskId}`

#### Scenario: Worktree cleanup on completion
- **WHEN** task completes and is approved
- **THEN** worktree branch is merged to feature branch
- **THEN** worktree is removed via `git worktree remove`

#### Scenario: Worktree cleanup on failure
- **WHEN** task fails or is reverted
- **THEN** worktree is removed without merging
- **THEN** worktree branch is deleted

#### Scenario: Orphan worktree detection
- **WHEN** daemon starts
- **THEN** daemon scans `.coven/worktrees/` for orphans
- **THEN** orphans with uncommitted work trigger recovery flow
- **THEN** orphans without changes are cleaned up

### Requirement: Health and Observability
The daemon SHALL provide health check and logging for observability.

#### Scenario: Health check
- **WHEN** GET /health
- **THEN** 200 OK is returned if daemon is healthy
- **THEN** response includes version and uptime

#### Scenario: Version check
- **WHEN** GET /version
- **THEN** daemon version string is returned
- **THEN** extension uses this to detect version mismatch

#### Scenario: Structured logging
- **WHEN** daemon operates
- **THEN** logs are written to `.coven/covend.log`
- **THEN** logs are structured JSON (one per line)
- **THEN** logs include timestamp, level, message, context

#### Scenario: Log rotation
- **WHEN** log file exceeds 10MB
- **THEN** log is rotated to `.coven/covend.log.1`
- **THEN** old rotated logs are deleted after 7 days

### Requirement: Test Coverage
The daemon SHALL maintain comprehensive test coverage for reliability.

#### Scenario: Unit test coverage
- **WHEN** `make test` is run
- **THEN** unit tests execute with coverage measurement
- **THEN** coverage MUST be at least 80% of statements
- **THEN** build fails if coverage threshold not met

#### Scenario: Unit test scope
- **WHEN** unit tests run
- **THEN** tests cover: state management, beads client, scheduler logic, output buffering
- **THEN** tests use mocks for external dependencies (bd CLI, claude process, git)
- **THEN** tests are fast (complete in under 30 seconds)

#### Scenario: E2E test coverage
- **WHEN** `make test-e2e` is run
- **THEN** functional tests exercise the daemon via HTTP API
- **THEN** tests verify full workflows: session start → agent spawn → completion → task update
- **THEN** tests use real beads database and real git operations
- **THEN** tests may use mock agent (fast completion) or real claude (slow, optional)

#### Scenario: E2E test isolation
- **WHEN** E2E tests run
- **THEN** each test creates isolated temp directory with git repo
- **THEN** each test initializes fresh beads database
- **THEN** tests clean up temp directories after completion
- **THEN** tests can run in parallel without interference

#### Scenario: CI integration
- **WHEN** code is pushed to repository
- **THEN** CI runs both unit tests and E2E tests
- **THEN** PR cannot merge if tests fail
- **THEN** coverage report is generated and visible
