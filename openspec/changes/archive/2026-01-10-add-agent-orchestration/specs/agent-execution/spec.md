# Agent Execution Specification Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
