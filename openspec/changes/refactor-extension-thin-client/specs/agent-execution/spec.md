## MODIFIED Requirements

### Requirement: Agent Spawning
The system SHALL delegate all agent spawning to the daemon.

#### Scenario: Start task triggers workflow
- **WHEN** user starts a task via extension
- **THEN** extension calls daemon API: POST /tasks/:id/start
- **THEN** daemon resolves grimoire for task
- **THEN** daemon creates worktree
- **THEN** daemon begins workflow execution
- **THEN** extension receives `workflow.started` SSE event

#### Scenario: Agent step execution
- **WHEN** workflow reaches agent step
- **THEN** daemon renders spell with context
- **THEN** daemon spawns claude process in worktree
- **THEN** extension receives `workflow.step_started` SSE event
- **THEN** extension receives `agent.started` SSE event

#### Scenario: Agent availability
- **WHEN** daemon starts
- **THEN** daemon verifies claude CLI is available
- **THEN** if not available, daemon logs error
- **THEN** agent steps will fail with clear error message

### Requirement: Output Streaming
The system SHALL receive agent output via daemon SSE events.

#### Scenario: Real-time output
- **WHEN** agent produces output
- **THEN** daemon captures and buffers output
- **THEN** daemon emits `agent.output` SSE event
- **THEN** extension appends output to detail panel
- **THEN** output channel updates in real-time

#### Scenario: Output history
- **WHEN** extension opens workflow detail after agent started
- **THEN** extension fetches GET /agents/:id/output
- **THEN** extension displays historical output
- **THEN** extension continues with live updates

### Requirement: Question Handling
The system SHALL handle questions via daemon API.

#### Scenario: Question detection
- **WHEN** daemon detects question in agent output
- **THEN** daemon stores question in question store
- **THEN** daemon emits `agent.question` SSE event
- **THEN** extension shows notification
- **THEN** extension adds to Questions sidebar section

#### Scenario: Answer delivery
- **WHEN** user answers question
- **THEN** extension calls POST /questions/:id/answer
- **THEN** daemon writes answer to agent stdin
- **THEN** agent continues execution
- **THEN** question removed from pending list

### Requirement: Agent Termination
The system SHALL terminate agents via daemon API.

#### Scenario: Cancel workflow
- **WHEN** user cancels workflow
- **THEN** extension calls POST /workflows/:id/cancel
- **THEN** daemon sends SIGTERM to agent process
- **THEN** if no exit in 10s, daemon sends SIGKILL
- **THEN** daemon cleans up worktree
- **THEN** extension receives `workflow.cancelled` event

#### Scenario: Stop specific agent
- **WHEN** extension needs to stop agent directly
- **THEN** extension calls POST /agents/:id/kill
- **THEN** daemon terminates agent process
- **THEN** workflow step fails
- **THEN** workflow may block or continue based on config

### Requirement: Agent Completion
The system SHALL receive completion via daemon events.

#### Scenario: Successful step completion
- **WHEN** daemon detects agent completion
- **THEN** daemon parses agent output JSON
- **THEN** daemon updates workflow state
- **THEN** daemon emits `workflow.step_completed` event
- **THEN** workflow proceeds to next step

#### Scenario: Agent failure
- **WHEN** agent exits non-zero or times out
- **THEN** daemon marks step as failed
- **THEN** daemon applies on_fail policy (block/continue)
- **THEN** daemon emits `workflow.step_completed` with error
- **THEN** if blocked, daemon emits `workflow.blocked`

#### Scenario: Workflow completion
- **WHEN** all steps complete successfully
- **THEN** daemon emits `workflow.completed` event
- **THEN** daemon updates bead status to closed
- **THEN** extension moves workflow to Completed section

### Requirement: Context Injection
The system SHALL rely on daemon for context injection.

#### Scenario: Spell rendering
- **WHEN** daemon executes agent step
- **THEN** daemon loads spell template
- **THEN** daemon injects bead context (title, description, etc)
- **THEN** daemon injects step context (previous outputs)
- **THEN** agent receives fully rendered prompt

#### Scenario: Step output mapping
- **WHEN** step has `output` field configured
- **THEN** daemon stores step output in context
- **THEN** subsequent steps can reference via `{{.step_name}}`

## REMOVED Requirements

### Requirement: Direct Process Management
**Reason**: Daemon handles all process management.
**Migration**: Extension uses daemon API instead of spawning processes.

The extension SHALL NOT:
- Spawn claude processes directly
- Manage agent stdin/stdout
- Track agent PIDs
- Handle agent timeouts

### Requirement: Extension-side Agent State
**Reason**: Daemon maintains agent state.
**Migration**: Extension reads agent state from daemon cache.

The extension SHALL NOT:
- Maintain FamiliarManager
- Track agent status locally
- Persist agent state to disk
