# agent-orchestration Specification

## Purpose
TBD - created by archiving change add-agent-orchestration. Update Purpose after archive.
## Requirements
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
The system SHALL support four step types for composing workflows.

| Step Type | Purpose |
|-----------|---------|
| `agent` | Invoke agent with a spell |
| `script` | Run shell command |
| `loop` | Repeat sub-steps until condition |
| `merge` | Merge worktree changes to main repo |

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

#### Scenario: Merge step execution
- **WHEN** a step with type `merge` executes
- **AND** `require_review` is true (default)
- **THEN** workflow status SHALL be set to `pending_merge`
- **AND** `workflow.merge_pending` event SHALL be emitted
- **AND** workflow SHALL wait for user approval

#### Scenario: Merge approval
- **WHEN** user approves merge via API
- **THEN** worktree changes SHALL be merged to main repo
- **AND** workflow SHALL continue to next step

#### Scenario: Merge rejection
- **WHEN** user rejects merge via API
- **THEN** workflow SHALL be blocked
- **AND** bead status SHALL be set to `blocked`

#### Scenario: Merge conflict
- **WHEN** merge encounters conflicts
- **THEN** workflow SHALL be blocked
- **AND** user SHALL be notified with conflict details (files, conflict markers)
- **AND** user must resolve conflicts manually before retrying

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
The system SHALL support passing data between steps via Go template syntax.

Variables use `{{.name}}` syntax in YAML fields and spell templates.

#### Scenario: Step output stored
- **WHEN** a step has `output: findings`
- **AND** step completes
- **THEN** step result SHALL be stored as `{{.findings}}`

#### Scenario: Variable in input
- **WHEN** a step has `input: { data: "{{.findings}}" }`
- **THEN** `{{.findings}}` SHALL resolve to stored value
- **AND** resolved value SHALL be passed to step

#### Scenario: Special variables
- **THEN** `{{.bead}}` SHALL contain the current bead
- **AND** `{{.bead.id}}`, `{{.bead.title}}` SHALL access bead fields
- **AND** `{{.previous.output}}` SHALL contain previous step's output
- **AND** `{{.previous.success}}` SHALL be true if previous step succeeded
- **AND** `{{.previous.failed}}` SHALL be true if previous step failed

#### Scenario: Agent output fields
- **WHEN** agent step completes with AgentOutput
- **THEN** `{{.step_name.success}}` SHALL contain success boolean
- **AND** `{{.step_name.summary}}` SHALL contain summary string
- **AND** `{{.step_name.outputs.key}}` SHALL access custom output fields

### Requirement: Conditional Execution
The system SHALL support conditional step execution with strict boolean evaluation.

#### Scenario: When condition true
- **GIVEN** a step with `when: "{{.previous.failed}}"`
- **AND** previous step failed
- **THEN** step SHALL execute

#### Scenario: When condition false
- **GIVEN** a step with `when: "{{.previous.failed}}"`
- **AND** previous step succeeded
- **THEN** step SHALL be skipped

#### Scenario: Non-boolean condition
- **GIVEN** a step with `when: "{{.some_value}}"`
- **AND** `.some_value` is not a boolean (string, number, object)
- **THEN** workflow SHALL fail immediately
- **AND** error message SHALL indicate type mismatch

### Requirement: Loop Variable Scoping
The system SHALL provide distinct, consistent scopes for accessing context inside loops.

#### Scenario: Previous step in iteration
- **GIVEN** a step inside a loop (not the first step)
- **THEN** `{{.previous.*}}` SHALL refer to the step that just executed

#### Scenario: Loop entry context
- **GIVEN** a step inside a loop
- **THEN** `{{.loop_entry.*}}` SHALL refer to the step that executed before the loop started
- **AND** `{{.loop_entry.output}}` SHALL contain that step's output
- **AND** `{{.loop_entry.success}}` SHALL contain that step's success status
- **AND** `{{.loop_entry}}` SHALL always be available inside the loop

#### Scenario: First step of first iteration
- **GIVEN** the first step in the first loop iteration
- **THEN** `{{.previous}}` SHALL be undefined
- **AND** accessing `{{.previous.*}}` SHALL fail or return empty
- **AND** `{{.loop_entry}}` SHALL be used to access pre-loop context

#### Scenario: First step of subsequent iterations
- **GIVEN** the first step in iteration N (where N > 1)
- **THEN** `{{.previous.*}}` SHALL refer to the last step of iteration N-1

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

### Requirement: Step Timeouts
The system SHALL support timeout configuration for steps to prevent runaway execution.

#### Scenario: Agent step timeout
- **GIVEN** an agent step with `timeout: 10m`
- **WHEN** agent execution exceeds 10 minutes
- **THEN** agent process SHALL be killed
- **AND** step SHALL be marked failed
- **AND** `{{.previous.failed}}` SHALL be true for next step

#### Scenario: Script step timeout
- **GIVEN** a script step with `timeout: 5m`
- **WHEN** script execution exceeds 5 minutes
- **THEN** script process SHALL be killed
- **AND** step SHALL be marked failed

#### Scenario: Default timeouts
- **WHEN** step does not specify timeout
- **THEN** agent steps SHALL default to 15 minutes
- **AND** script steps SHALL default to 5 minutes

#### Scenario: Workflow timeout
- **WHEN** overall workflow execution exceeds configured limit (default: 2h)
- **THEN** current step SHALL be killed
- **AND** workflow SHALL be blocked
- **AND** reason SHALL indicate timeout

### Requirement: Script Variable Escaping
The system SHALL shell-escape variables interpolated into script commands to prevent command injection.

#### Scenario: Variable escaping
- **GIVEN** a script step with `command: "bd close {{.bead.id}}"`
- **AND** `.bead.id` contains `foo; rm -rf /`
- **WHEN** command is rendered
- **THEN** `.bead.id` SHALL be shell-escaped
- **AND** rendered command SHALL treat it as a single argument

#### Scenario: Raw interpolation
- **GIVEN** a script step with `command: "{{raw .custom_command}}"`
- **WHEN** command is rendered
- **THEN** `.custom_command` SHALL NOT be escaped
- **AND** warning SHALL be logged about raw interpolation

### Requirement: Variable Type Rendering
The system SHALL render variables based on their underlying type.

#### Scenario: String rendering
- **WHEN** variable is a string
- **THEN** it SHALL be rendered as-is

#### Scenario: Array rendering
- **WHEN** variable is an array
- **THEN** it SHALL be rendered as JSON array: `["a", "b"]`

#### Scenario: Object rendering
- **WHEN** variable is an object
- **THEN** it SHALL be rendered as JSON object: `{"key": "value"}`

#### Scenario: Null rendering
- **WHEN** variable is null or undefined
- **THEN** it SHALL be rendered as empty string

### Requirement: Worktree Lifecycle
The system SHALL manage isolated worktrees for workflow execution.

#### Scenario: Worktree creation
- **WHEN** scheduler picks up a bead for processing
- **THEN** a worktree SHALL be created at `.worktrees/{bead-id}/`
- **AND** all workflow steps SHALL execute within this worktree

#### Scenario: Worktree cleanup
- **WHEN** merge completes successfully
- **THEN** worktree SHALL be deleted in background
- **AND** cleanup failure SHALL NOT block workflow completion

#### Scenario: Cancelled workflow cleanup
- **WHEN** workflow is cancelled
- **THEN** worktree MAY be retained for debugging
- **OR** cleaned up based on configuration

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

### Requirement: Workflow State Persistence
The system SHALL persist workflow state to survive daemon restarts.

#### Scenario: State file creation
- **WHEN** workflow starts
- **THEN** state SHALL be persisted to `.coven/state/workflows/{workflow-id}.json`

#### Scenario: State persistence points
- **WHEN** step completes (success or failure)
- **THEN** state SHALL be persisted with updated variables and step results
- **WHEN** loop iteration completes
- **THEN** state SHALL be persisted with iteration context

#### Scenario: Daemon restart resumption
- **WHEN** daemon starts
- **AND** running workflows exist in state directory
- **THEN** workflows SHALL be resumed from last completed step
- **AND** current step SHALL be re-executed

#### Scenario: Blocked workflow persistence
- **WHEN** workflow blocks
- **THEN** state SHALL include blocked reason and context
- **AND** state file SHALL be retained until resolved

#### Scenario: Completed workflow cleanup
- **WHEN** workflow completes successfully
- **THEN** state file MAY be deleted after retention period (default: 7 days)

### Requirement: Workflow REST API
The system SHALL expose workflow management via REST endpoints.

#### Scenario: List workflows
- **WHEN** `GET /workflows` is called
- **THEN** response SHALL include all active, blocked, and recent workflows
- **AND** each workflow SHALL include: id, bead_id, grimoire, status, progress

#### Scenario: Get workflow details
- **WHEN** `GET /workflows/:id` is called
- **THEN** response SHALL include full workflow state
- **AND** response SHALL include step-by-step progress with outputs
- **AND** response SHALL include worktree path

#### Scenario: Cancel workflow
- **WHEN** `POST /workflows/:id/cancel` is called
- **THEN** running agents SHALL be terminated
- **AND** workflow status SHALL be set to cancelled
- **AND** bead status SHALL revert to open

#### Scenario: Retry blocked workflow
- **WHEN** `POST /workflows/:id/retry` is called
- **AND** workflow status is blocked
- **THEN** workflow SHALL resume from blocked step
- **AND** `modified_inputs` MAY override context variables

#### Scenario: Approve merge
- **WHEN** `POST /workflows/:id/approve-merge` is called
- **AND** workflow status is `pending_merge`
- **THEN** merge SHALL proceed
- **AND** workflow SHALL continue to next step

#### Scenario: Reject merge
- **WHEN** `POST /workflows/:id/reject-merge` is called
- **AND** workflow status is `pending_merge`
- **THEN** workflow SHALL be blocked
- **AND** reason SHALL indicate user rejection

#### Scenario: Get workflow log
- **WHEN** `GET /workflows/:id/log` is called
- **THEN** JSONL log file SHALL be returned
- **AND** streaming MAY be supported for active workflows

### Requirement: Blocked State Notification
The system SHALL provide actionable context when workflows block.

#### Scenario: Blocked event payload
- **WHEN** `workflow.blocked` event is emitted
- **THEN** payload SHALL include:
  - `blocked_reason`: why the workflow blocked
  - `blocked_context`: relevant outputs (test failures, review findings)
  - `iteration_summaries`: summary of each loop iteration if in loop
  - `worktree`: path to inspect manually

#### Scenario: Blocked API response
- **WHEN** blocked workflow is retrieved via API
- **THEN** response SHALL include same context as blocked event
- **AND** response SHALL suggest possible actions (retry, cancel)

### Requirement: Dry-Run Mode
The system SHALL support previewing grimoire execution without actual execution.

#### Scenario: Dry-run command
- **WHEN** `coven grimoire preview <grimoire> --bead=<id>` is called
- **THEN** grimoire SHALL be resolved for the bead
- **AND** all spells SHALL be resolved (file or inline)
- **AND** step sequence SHALL be displayed with rendered inputs
- **AND** no agents or scripts SHALL execute

#### Scenario: Dry-run validation
- **WHEN** dry-run executes
- **THEN** template syntax SHALL be validated
- **AND** spell references SHALL be verified (exist or inline)
- **AND** static variable references SHALL be checked (e.g., `{{.bead.id}}`)
- **AND** step structure SHALL be validated (required fields, valid types)

#### Scenario: Dry-run output
- **WHEN** dry-run completes
- **THEN** output SHALL show:
  - Resolved grimoire name and source
  - Bead details
  - Step-by-step breakdown with types
  - Rendered spell references
  - Input variable mappings
  - Validation results (pass/fail with details)

#### Scenario: Dry-run validation failure
- **WHEN** dry-run finds invalid configuration
- **THEN** specific errors SHALL be reported
- **AND** exit code SHALL be non-zero
- **AND** errors SHALL include: file path, line number (if applicable), error description

