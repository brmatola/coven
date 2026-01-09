## MODIFIED Requirements

### Requirement: Agent Spawning
The system SHALL delegate agent spawning to the daemon rather than spawning processes directly.

#### Scenario: Spawn agent for task
- **WHEN** user starts a task via extension
- **THEN** extension calls daemon API: POST /tasks/:id/start
- **THEN** daemon spawns claude process in worktree
- **THEN** extension receives `agent.spawned` SSE event
- **THEN** extension updates UI to show task as "working"

#### Scenario: Agent working directory
- **WHEN** agent is spawned by daemon
- **THEN** daemon creates worktree and sets agent working directory
- **THEN** extension has no direct access to agent process

#### Scenario: Agent availability check
- **WHEN** extension activates
- **THEN** extension verifies daemon is running (health check)
- **THEN** if daemon not running, extension auto-starts daemon
- **THEN** daemon handles `claude` command availability check

### Requirement: Output Streaming
The system SHALL receive agent output via daemon SSE events rather than direct process capture.

#### Scenario: Real-time output
- **WHEN** agent produces output
- **THEN** daemon captures output and emits `agent.output` SSE event
- **THEN** extension receives event and appends to output channel
- **THEN** sequence numbers ensure no output is missed

#### Scenario: Output parsing
- **WHEN** daemon receives agent output
- **THEN** daemon detects status changes and completion signals
- **THEN** daemon emits appropriate events (`agent.question`, `agent.completed`)
- **THEN** extension reacts to events for UI updates

#### Scenario: Historical output fetch
- **WHEN** extension reconnects or opens output channel late
- **THEN** extension fetches historical output via GET /agents/:id/output?since=0
- **THEN** output channel shows full history

### Requirement: Question Handling
The system SHALL handle questions via daemon API rather than direct stdin access.

#### Scenario: Question detection
- **WHEN** daemon detects question in agent output
- **THEN** daemon emits `agent.question` SSE event
- **THEN** extension shows notification or modal to user

#### Scenario: Response injection
- **WHEN** user provides response to question
- **THEN** extension calls daemon API: POST /agents/:id/respond
- **THEN** daemon writes response to agent stdin
- **THEN** agent continues execution

#### Scenario: Permission request
- **WHEN** agent requests permission
- **THEN** daemon parses question and includes type in event
- **THEN** extension shows appropriate UI based on question type

### Requirement: Agent Termination
The system SHALL terminate agents via daemon API rather than direct process signals.

#### Scenario: Graceful termination
- **WHEN** user requests task stop
- **THEN** extension calls daemon API: POST /agents/:id/kill
- **THEN** daemon sends SIGTERM to agent process
- **THEN** extension receives `agent.completed` or `agent.failed` event

#### Scenario: Forced termination
- **WHEN** agent does not exit after SIGTERM timeout
- **THEN** daemon sends SIGKILL
- **THEN** extension receives `agent.failed` event

#### Scenario: Timeout termination
- **WHEN** daemon detects agent timeout
- **THEN** daemon terminates agent and emits `agent.failed` event
- **THEN** extension updates UI to show task as blocked

### Requirement: Agent Completion
The system SHALL receive completion notifications via daemon events.

#### Scenario: Successful completion
- **WHEN** daemon detects agent completion
- **THEN** daemon updates task in beads
- **THEN** daemon emits `agent.completed` SSE event
- **THEN** extension updates UI to show task in review

#### Scenario: Agent failure
- **WHEN** daemon detects agent failure
- **THEN** daemon updates task in beads
- **THEN** daemon emits `agent.failed` SSE event
- **THEN** extension updates UI to show task as blocked

### Requirement: MCP Server Configuration
The system SHALL pass MCP configuration to daemon for agent spawning.

#### Scenario: Session-level MCP servers
- **WHEN** session is started with MCP server configuration
- **THEN** configuration is passed to daemon via session start request
- **THEN** daemon applies MCP configuration when spawning agents

#### Scenario: Task-specific MCP servers
- **WHEN** task specifies MCP servers in beads metadata
- **THEN** daemon reads MCP config from task
- **THEN** daemon spawns agent with combined session + task MCP servers

### Requirement: Agent Profiles
The system SHALL delegate profile application to daemon.

#### Scenario: Default profile
- **WHEN** daemon spawns agent
- **THEN** daemon applies default profile from configuration
- **THEN** profile includes task description and acceptance criteria

#### Scenario: Profile selection by task type
- **WHEN** task has type in beads metadata
- **THEN** daemon selects matching profile
- **THEN** daemon tailors prompt for task type

### Requirement: Context Injection
The system SHALL rely on daemon for context injection.

#### Scenario: Task context injection
- **WHEN** daemon spawns agent for task
- **THEN** daemon reads task details from beads
- **THEN** daemon injects context into agent prompt

#### Scenario: Repository context hints
- **WHEN** daemon spawns agent
- **THEN** daemon can include file hints based on task description
- **THEN** extension does not need to provide context directly

## REMOVED Requirements

### Requirement: Direct Process Management
**Reason**: Daemon handles all process management.
**Migration**: Extension uses daemon API instead of spawning processes.

The extension SHALL NOT spawn claude processes directly. All agent lifecycle management is delegated to the daemon.
