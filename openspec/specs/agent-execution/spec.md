# agent-execution Specification

## Purpose
TBD - created by archiving change add-claude-agent-integration. Update Purpose after archive.
## Requirements
### Requirement: Agent Spawning
The system SHALL spawn Claude Code CLI processes to execute tasks in isolated worktrees.

Agent spawning is integrated with the workflow engine via the `agent` step type.

#### Scenario: Spawn agent for workflow step
- **WHEN** a workflow step of type `agent` executes
- **THEN** an agent SHALL be spawned with the rendered spell
- **AND** agent working directory SHALL be the bead's worktree
- **AND** output SHALL be captured for workflow context

#### Scenario: Agent working directory
- **WHEN** agent is spawned
- **THEN** agent's working directory is set to the bead's worktree
- **THEN** CLAUDE.md/AGENTS.md in the worktree guide agent behavior

### Requirement: Output Streaming
The system SHALL stream agent output in real-time for display and analysis.

#### Scenario: Real-time output
- **WHEN** agent produces output
- **THEN** output is streamed to registered callbacks
- **THEN** output is buffered for later retrieval

#### Scenario: Output parsing
- **WHEN** output is received
- **THEN** system detects agent status changes (thinking, writing, running commands)
- **THEN** system detects completion signals
- **THEN** system detects questions requiring response

### Requirement: Question Handling
The system SHALL detect when agents ask questions and route them for human response.

#### Scenario: Question detection
- **WHEN** agent asks a question in output
- **THEN** question is parsed and categorized
- **THEN** suggested responses are extracted if present
- **THEN** onQuestion callback is invoked with structured data

#### Scenario: Response injection
- **WHEN** human provides response to question
- **THEN** response is written to agent's stdin
- **THEN** agent continues execution

#### Scenario: Permission request
- **WHEN** agent requests permission (e.g., run npm install)
- **THEN** question type is set to "permission"
- **THEN** quick actions include Allow, Deny, Allow All

### Requirement: Agent Termination
The system SHALL support graceful and forced agent termination.

#### Scenario: Graceful termination
- **WHEN** termination is requested
- **THEN** SIGTERM is sent to agent process
- **THEN** system waits up to 10 seconds for graceful exit

#### Scenario: Forced termination
- **WHEN** agent does not exit after SIGTERM timeout
- **THEN** SIGKILL is sent to force termination
- **THEN** any partial work in worktree is preserved

#### Scenario: Timeout termination
- **WHEN** agent exceeds configured timeout without progress
- **THEN** agent is terminated
- **THEN** task is marked as blocked with timeout reason

### Requirement: Agent Completion
The system SHALL detect when agents complete their tasks successfully.

#### Scenario: Successful completion
- **WHEN** agent signals task completion
- **THEN** onComplete callback is invoked with result
- **THEN** result includes summary and list of changed files
- **THEN** familiar status transitions to merging

#### Scenario: Agent failure
- **WHEN** agent exits with error or reports inability to complete
- **THEN** onComplete callback is invoked with failure result
- **THEN** task is marked as blocked with error details

### Requirement: MCP Server Configuration
The system SHALL support configuring MCP servers to extend agent capabilities.

#### Scenario: Session-level MCP servers
- **WHEN** session is configured with default MCP servers
- **THEN** all agents spawned in the session use those MCP servers
- **THEN** MCP servers are passed via Claude CLI flags

#### Scenario: Task-specific MCP servers
- **WHEN** a task specifies additional MCP servers (e.g., puppeteer for UI tasks)
- **THEN** task's agent is spawned with session defaults plus task-specific servers
- **THEN** task-level servers override session defaults if conflicting

#### Scenario: MCP server availability check
- **WHEN** agent is about to spawn with MCP servers
- **THEN** system verifies MCP server packages are installed
- **THEN** warning is shown if required MCP server is unavailable

#### Scenario: Common MCP server presets
- **WHEN** user configures session
- **THEN** common presets are available: filesystem, puppeteer, github
- **THEN** presets provide sensible default configurations

### Requirement: Agent Profiles
The system SHALL support agent profiles via spells.

**Note**: Profiles are now managed via spells in `.coven/spells/`. Each workflow step specifies a spell (file or inline).

#### Scenario: Spell as profile
- **WHEN** a workflow step specifies `spell: implement`
- **THEN** `.coven/spells/implement.md` SHALL be loaded
- **AND** template variables SHALL be rendered
- **AND** rendered content becomes agent prompt

#### Scenario: Inline spell
- **WHEN** a step's spell contains newlines
- **THEN** content SHALL be used directly as template
- **AND** no file lookup SHALL occur

### Requirement: Context Injection
The system SHALL inject workflow context into agent prompts via spell templates.

**Note**: We rely on Claude Code's CLAUDE.md/AGENTS.md for codebase navigation. Context injection is via spell template variables using Go template syntax `{{.variable}}`.

#### Scenario: Bead context in spell
- **WHEN** spell template contains `{{.bead.title}}`
- **THEN** current bead's title SHALL be rendered

#### Scenario: Previous step output in spell
- **WHEN** spell template contains `{{.test_output}}`
- **AND** workflow context has `test_output` variable
- **THEN** variable value SHALL be rendered

### Requirement: Agent System Prompt
The system SHALL wrap all agent invocations with a system prompt that enforces the output contract.

#### Scenario: System prompt composition
- **WHEN** agent is spawned
- **THEN** system prompt SHALL be rendered with workflow context
- **AND** spell content SHALL be injected into system prompt at `{{.spell_content}}`
- **AND** final prompt = rendered system prompt

#### Scenario: System prompt override
- **WHEN** `.coven/system-prompt.md` exists
- **THEN** user's system prompt SHALL be used instead of built-in
- **AND** user prompt MUST include `{{.spell_content}}` placeholder

### Requirement: Agent Output Schema
The system SHALL require agents to produce structured JSON output.

#### Scenario: Agent output format
- **WHEN** agent completes
- **THEN** agent's output SHALL include a JSON block with:
  - `success`: boolean indicating task completion
  - `summary`: human-readable description
  - `outputs`: key-value pairs for subsequent steps (optional)
  - `error`: error message if failed (optional)

#### Scenario: Output parsing
- **WHEN** agent output is captured
- **THEN** the system SHALL extract the last JSON code block
- **AND** parse it as AgentOutput schema
- **AND** make fields available as `{{.step_name.success}}`, `{{.step_name.outputs.key}}`

#### Scenario: Missing output
- **WHEN** agent output contains no valid JSON block
- **THEN** step SHALL be marked as failed
- **AND** `{{.previous.failed}}` SHALL be true

### Requirement: Workflow Step Integration
The system SHALL execute agents as workflow steps.

#### Scenario: Agent step captures output
- **WHEN** agent step completes
- **THEN** agent's AgentOutput SHALL be captured
- **AND** output SHALL be stored in workflow context
- **AND** output SHALL be available as `{{.step_name}}` or via `output` field

#### Scenario: Agent step failure
- **WHEN** agent step fails or times out
- **THEN** failure SHALL be reported to workflow engine
- **AND** `{{.previous.failed}}` SHALL be true for next step
- **AND** `{{.previous.success}}` SHALL be false

