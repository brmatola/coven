# Agent Orchestration Specification

## ADDED Requirements

### Requirement: Grimoire Definition
The system SHALL support grimoire definitions that specify multi-step workflows.

A grimoire definition SHALL include:
- A unique name (kebab-case identifier)
- A human-readable description
- A trigger type (manual or event-based)
- A list of steps to execute sequentially
- Optional input parameters

#### Scenario: Grimoire loaded from built-in defaults
- **WHEN** the daemon starts
- **THEN** built-in grimoires SHALL be available (spec-to-beads, implement-bead, review-loop, prepare-pr)
- **AND** each grimoire SHALL have a complete step definition

#### Scenario: Grimoire loaded from custom file
- **WHEN** a YAML file exists in `.coven/grimoires/`
- **THEN** the grimoire SHALL be loaded and available for execution
- **AND** custom grimoires MAY override built-in grimoires of the same name

### Requirement: Step Types
The system SHALL support multiple step types for composing workflows.

| Step Type | Purpose |
|-----------|---------|
| `agent` | Single agent invocation with a prompt |
| `agent-loop` | Repeated agent invocations until exit condition |
| `parallel-agents` | Fan-out to multiple agents concurrently |
| `script` | Execute a shell command |
| `gate` | Quality checkpoint that blocks on failure |

#### Scenario: Agent step execution
- **WHEN** a step with type `agent` is executed
- **THEN** an agent SHALL be spawned with the specified prompt
- **AND** the agent output SHALL be captured as the step output
- **AND** the workflow SHALL wait for agent completion before proceeding

#### Scenario: Script step execution
- **WHEN** a step with type `script` is executed
- **THEN** the specified command SHALL be run in a shell
- **AND** stdout/stderr SHALL be captured as step output
- **AND** exit code 0 indicates success

#### Scenario: Gate step execution
- **WHEN** a step with type `gate` is executed
- **AND** the command exits with non-zero status
- **THEN** the workflow SHALL be blocked
- **AND** the user SHALL be notified of the failure

### Requirement: Parallel Agent Execution
The system SHALL support spawning multiple agents concurrently for a step.

#### Scenario: Fan-out to multiple agents
- **WHEN** a step with type `parallel-agents` is executed
- **AND** the `for_each` field references an array variable
- **THEN** one agent SHALL be spawned for each item in the array
- **AND** concurrent agents SHALL be limited by `max_concurrent`

#### Scenario: Parallel agent output aggregation
- **WHEN** all parallel agents complete
- **THEN** their outputs SHALL be aggregated into an array
- **AND** the array SHALL be stored in the step's output variable

#### Scenario: Partial failure handling
- **WHEN** some parallel agents fail while others succeed
- **THEN** the workflow MAY continue or block based on configuration
- **AND** both successes and failures SHALL be reported

### Requirement: Agent Loop with Arbiter
The system SHALL support iterative agent execution with an arbiter pattern.

The arbiter pattern uses two agents:
1. **Primary agent**: Performs the work (e.g., review, fix)
2. **Arbiter agent**: Judges if the loop should continue

#### Scenario: Agent loop iteration
- **WHEN** a step with type `agent-loop` is executed
- **THEN** the primary agent SHALL be invoked
- **THEN** the arbiter agent SHALL evaluate the primary agent's output
- **AND** if arbiter signals "actionable", the loop SHALL continue
- **AND** if arbiter signals "done", the loop SHALL exit

#### Scenario: Agent loop max iterations
- **WHEN** an agent loop reaches `max_iterations`
- **THEN** the loop SHALL exit regardless of arbiter verdict
- **AND** the workflow MAY proceed or block based on configuration

#### Scenario: Arbiter context
- **WHEN** the arbiter agent is invoked
- **THEN** it SHALL receive the primary agent's output
- **AND** it SHALL receive the iteration history
- **AND** it SHALL NOT have access to modify the work

### Requirement: Variable Passing
The system SHALL support passing outputs between steps via named variables.

Variables use `${variable}` syntax and are resolved at step execution time.

#### Scenario: Step output stored
- **WHEN** a step completes successfully
- **AND** the step has an `output` field
- **THEN** the step's result SHALL be stored under that variable name

#### Scenario: Variable resolution in input
- **WHEN** a step's input contains `${variable}`
- **THEN** the variable SHALL be resolved from previous step outputs
- **AND** if the variable is undefined, the workflow SHALL fail with error

#### Scenario: Variable resolution in for_each
- **WHEN** a `parallel-agents` step references `${array_var}` in `for_each`
- **THEN** the variable SHALL be resolved to an array
- **AND** one agent SHALL be spawned per array element

### Requirement: Workflow Execution
The system SHALL execute workflows as a sequence of steps with state tracking.

#### Scenario: Workflow start
- **WHEN** a workflow is triggered
- **THEN** a unique workflow ID SHALL be generated
- **AND** the workflow state SHALL be initialized
- **AND** execution SHALL begin with the first step

#### Scenario: Workflow completion
- **WHEN** all steps complete successfully
- **THEN** the workflow status SHALL be set to "completed"
- **AND** a completion event SHALL be emitted

#### Scenario: Workflow failure
- **WHEN** a step fails and cannot be recovered
- **THEN** the workflow status SHALL be set to "failed"
- **AND** the error details SHALL be recorded
- **AND** a failure event SHALL be emitted

#### Scenario: Workflow blocking
- **WHEN** a step requires user intervention
- **THEN** the workflow status SHALL be set to "blocked"
- **AND** an intervention request SHALL be emitted
- **AND** the workflow SHALL resume when intervention is provided

### Requirement: Workflow API
The system SHALL expose workflow operations via HTTP API.

#### Scenario: Start workflow
- **WHEN** POST /workflows is called with grimoire name and input
- **THEN** a new workflow instance SHALL be created
- **AND** the workflow ID SHALL be returned
- **AND** execution SHALL begin asynchronously

#### Scenario: Get workflow status
- **WHEN** GET /workflows/:id is called
- **THEN** the current workflow state SHALL be returned
- **AND** state includes: status, current step, variables, errors

#### Scenario: Cancel workflow
- **WHEN** DELETE /workflows/:id is called
- **THEN** the workflow SHALL be stopped
- **AND** any running agents SHALL be terminated
- **AND** status SHALL be set to "cancelled"

### Requirement: Workflow Events
The system SHALL emit real-time events for workflow state changes.

#### Scenario: Step started event
- **WHEN** a step begins execution
- **THEN** a `workflow.step.started` event SHALL be emitted
- **AND** the event SHALL include: workflow ID, step name, step type

#### Scenario: Step completed event
- **WHEN** a step completes
- **THEN** a `workflow.step.completed` event SHALL be emitted
- **AND** the event SHALL include: workflow ID, step name, output summary

#### Scenario: Intervention required event
- **WHEN** a workflow blocks waiting for user input
- **THEN** a `workflow.intervention.required` event SHALL be emitted
- **AND** the event SHALL include: workflow ID, reason, options
