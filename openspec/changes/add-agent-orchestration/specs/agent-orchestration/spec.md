# Agent Orchestration Specification

## ADDED Requirements

### Requirement: Grimoire Definition
The system SHALL support grimoire definitions that specify workflows for processing beads.

A grimoire operates on **one bead** at a time. The scheduler handles parallelism.

#### Scenario: Grimoire structure
- **GIVEN** a grimoire YAML file
- **THEN** it SHALL contain: name, description, steps array
- **AND** each step SHALL have: name, type, and type-specific fields

#### Scenario: Grimoire loaded from built-in
- **WHEN** the daemon starts
- **THEN** built-in grimoires SHALL be available (implement-bead, spec-to-beads, prepare-pr)

#### Scenario: Grimoire loaded from user directory
- **WHEN** a YAML file exists in `.coven/grimoires/`
- **THEN** the grimoire SHALL be loaded and available
- **AND** user grimoires SHALL override built-in grimoires of the same name

### Requirement: Step Types
The system SHALL support three step types for composing workflows.

| Step Type | Purpose |
|-----------|---------|
| `agent` | Invoke agent with a spell |
| `script` | Run shell command |
| `loop` | Repeat sub-steps until condition |

#### Scenario: Agent step execution
- **WHEN** a step with type `agent` executes
- **THEN** an agent SHALL be spawned with the rendered spell
- **AND** agent output SHALL be captured as step output
- **AND** workflow SHALL wait for agent completion

#### Scenario: Script step execution
- **WHEN** a step with type `script` executes
- **THEN** the command SHALL be run in a shell
- **AND** stdout/stderr SHALL be captured as output
- **AND** `on_fail` and `on_success` handlers SHALL be evaluated

#### Scenario: Loop step execution
- **WHEN** a step with type `loop` executes
- **THEN** nested steps SHALL execute sequentially
- **AND** loop SHALL repeat until `exit_loop` or `max_iterations`
- **WHEN** `max_iterations` is reached
- **THEN** `on_max_iterations` action SHALL be taken (e.g., block)

### Requirement: Spell Templates
The system SHALL support spell templates for agent prompts.

Spells are Markdown files with Go template syntax (`{{.variable}}`).

#### Scenario: Spell loaded from file
- **WHEN** a step references spell by name (no newlines)
- **THEN** the system SHALL look for `.coven/spells/{name}.md`
- **AND** fall back to built-in spells if not found

#### Scenario: Inline spell
- **WHEN** a step's spell field contains newlines
- **THEN** the spell SHALL be treated as inline content
- **AND** no file lookup SHALL occur

#### Scenario: Spell rendering
- **WHEN** a spell is rendered
- **THEN** workflow context variables SHALL be available
- **AND** `{{.bead}}` SHALL contain the current bead
- **AND** `{{.variable}}` SHALL resolve step outputs

### Requirement: Grimoire Selection
The system SHALL select grimoires based on bead labels with fallbacks.

#### Scenario: Label-based selection
- **GIVEN** a bead with label `grimoire:custom-flow`
- **WHEN** scheduler processes the bead
- **THEN** the `custom-flow` grimoire SHALL be used

#### Scenario: Type mapping fallback
- **GIVEN** a bead without grimoire label
- **AND** config maps type `feature` to `implement-bead`
- **WHEN** bead has type `feature`
- **THEN** the `implement-bead` grimoire SHALL be used

#### Scenario: Default fallback
- **GIVEN** a bead without grimoire label
- **AND** no type mapping matches
- **THEN** the default grimoire from config SHALL be used

### Requirement: Variable Passing
The system SHALL support passing data between steps via variables.

Variables use `${name}` syntax in YAML fields.

#### Scenario: Step output stored
- **WHEN** a step has `output: findings`
- **AND** step completes
- **THEN** step result SHALL be stored as `${findings}`

#### Scenario: Variable in input
- **WHEN** a step has `input: { data: "${findings}" }`
- **THEN** `${findings}` SHALL resolve to stored value
- **AND** resolved value SHALL be passed to step

#### Scenario: Special variables
- **THEN** `${bead}` SHALL contain the current bead
- **AND** `${previous.output}` SHALL contain previous step's output
- **AND** `${previous.failed}` SHALL be true if previous step failed

### Requirement: Conditional Execution
The system SHALL support conditional step execution.

#### Scenario: When condition true
- **GIVEN** a step with `when: ${previous.failed}`
- **AND** previous step failed
- **THEN** step SHALL execute

#### Scenario: When condition false
- **GIVEN** a step with `when: ${previous.failed}`
- **AND** previous step succeeded
- **THEN** step SHALL be skipped

### Requirement: Script Handlers
The system SHALL support `on_fail` and `on_success` handlers for script steps.

#### Scenario: on_fail continue
- **GIVEN** a script step with `on_fail: continue`
- **WHEN** script exits non-zero
- **THEN** workflow SHALL continue to next step
- **AND** `${previous.failed}` SHALL be true

#### Scenario: on_fail block
- **GIVEN** a script step with `on_fail: block`
- **WHEN** script exits non-zero
- **THEN** workflow SHALL block
- **AND** bead SHALL be flagged for manual review

#### Scenario: on_success exit_loop
- **GIVEN** a script step inside a loop with `on_success: exit_loop`
- **WHEN** script exits zero
- **THEN** loop SHALL exit immediately
- **AND** workflow SHALL continue past the loop

### Requirement: Bead Lifecycle
The system SHALL manage bead status during workflow execution.

#### Scenario: Bead picked up
- **WHEN** scheduler picks up a ready bead
- **THEN** bead status SHALL be set to `in_progress`
- **AND** grimoire execution SHALL begin

#### Scenario: Workflow completes
- **WHEN** grimoire completes successfully
- **THEN** bead status SHALL be set to `closed`

#### Scenario: Workflow blocks
- **WHEN** grimoire triggers block action
- **THEN** bead status SHALL be set to `blocked`
- **AND** user SHALL be notified

### Requirement: Workflow Events
The system SHALL emit events for workflow state changes.

#### Scenario: Workflow started
- **WHEN** grimoire begins execution
- **THEN** `workflow.started` event SHALL be emitted
- **AND** event SHALL include: workflow ID, bead ID, grimoire name

#### Scenario: Step events
- **WHEN** step begins
- **THEN** `workflow.step.started` event SHALL be emitted
- **WHEN** step completes
- **THEN** `workflow.step.completed` event SHALL be emitted

#### Scenario: Workflow blocked
- **WHEN** workflow blocks
- **THEN** `workflow.blocked` event SHALL be emitted
- **AND** event SHALL include reason for blocking

### Requirement: Workflow Logging
The system SHALL log workflow execution to JSONL files for observability.

One log file per workflow run at `.coven/logs/workflows/{workflow-id}.jsonl`.

#### Scenario: Log file creation
- **WHEN** workflow starts
- **THEN** a new JSONL log file SHALL be created
- **AND** file SHALL be named `{workflow-id}.jsonl`

#### Scenario: Log captures hierarchy
- **WHEN** workflow executes
- **THEN** log SHALL capture: workflow start/end, step start/end, inputs, outputs
- **AND** loop iterations SHALL be logged with iteration number
- **AND** log structure SHALL reflect step hierarchy

#### Scenario: Log captures full output
- **WHEN** agent or script step completes
- **THEN** full stdout/stderr SHALL be logged
- **AND** exit codes SHALL be logged for scripts
- **AND** duration_ms SHALL be logged for each step

#### Scenario: Token tracking
- **WHEN** agent step completes
- **AND** Claude CLI provides token usage
- **THEN** input/output tokens SHALL be logged per step
- **AND** total tokens SHALL be aggregated at workflow end

#### Scenario: Agent internal state logging
- **WHEN** agent step executes
- **THEN** agent thinking/reasoning SHALL be logged as `agent.thinking`
- **AND** tool calls SHALL be logged as `agent.tool_call` with tool name and inputs
- **AND** tool results SHALL be logged as `agent.tool_result` with output and duration
- **AND** events SHALL be logged as they stream (not batched at end)

### Requirement: Spell Partials
The system SHALL support including spells within other spells with variable passing.

#### Scenario: Include with literal variables
- **GIVEN** a spell contains `{{include "partial.md" name="value"}}`
- **WHEN** spell is rendered
- **THEN** partial SHALL be loaded and rendered
- **AND** `{{.name}}` in partial SHALL resolve to "value"

#### Scenario: Include with context variables
- **GIVEN** a spell contains `{{include "partial.md" title={{.bead.title}}}}`
- **WHEN** spell is rendered
- **THEN** `{{.bead.title}}` SHALL be resolved first
- **AND** result SHALL be passed to partial as `{{.title}}`

#### Scenario: Partial resolution
- **WHEN** partial is referenced
- **THEN** system SHALL check `.coven/spells/{name}`
- **AND** fall back to built-in spells
- **AND** error if not found

#### Scenario: Nesting depth limit
- **WHEN** partials include other partials
- **THEN** nesting SHALL be limited (e.g., max 5 levels)
- **AND** cycles SHALL be detected and rejected
