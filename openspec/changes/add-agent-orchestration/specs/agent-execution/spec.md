# Agent Execution Specification Delta

## MODIFIED Requirements

### Requirement: Agent Profiles
The system SHALL support agent profiles defining prompt templates and behavior for different task types.

Profiles are now defined via the agent-roles capability. See `specs/agent-roles/spec.md` for role definition details.

#### Scenario: Default profile
- **WHEN** task has no specific profile assigned
- **THEN** default role ("implement") is used
- **THEN** role is resolved via agent-roles role selection rules
- **THEN** prompt is built using role's template with context injection

#### Scenario: Profile selection by task type
- **WHEN** task has a type (feature, bug, refactor, test)
- **THEN** matching role is selected via agent-roles type mapping
- **THEN** role tailors system prompt for the task type
- **THEN** role-specific guidelines are included in prompt

#### Scenario: Profile content structure
- **WHEN** profile (role) is applied
- **THEN** prompt includes: role-specific instructions, task context, acceptance criteria, repo context
- **THEN** prompt is structured according to role's template
- **THEN** context sections are populated by context gatherers

#### Scenario: Custom profile override
- **WHEN** task specifies a custom role override in metadata
- **THEN** specified role is used instead of type-based selection
- **THEN** custom roles from `.coven/roles/` are supported
- **THEN** task context is still injected into the role's template

### Requirement: Context Injection
The system SHALL inject relevant context into agent prompts to improve task success.

Context is gathered by dedicated context gatherer components and rendered into role templates.

#### Scenario: Task context injection
- **WHEN** agent is spawned for a task
- **THEN** prompt includes: task title, description, acceptance criteria
- **THEN** acceptance criteria are formatted as a checklist
- **THEN** if task was previously attempted, include prior attempt summary

#### Scenario: Repository context hints
- **WHEN** agent is spawned
- **THEN** prompt includes: directory structure (tree output), relevant file paths
- **THEN** relevant files are identified via keyword extraction from task description
- **THEN** context is limited by configurable budget (relevant_files_limit)
- **THEN** excluded paths (node_modules, dist, .git) are omitted

#### Scenario: Session context
- **WHEN** multiple agents are working in parallel
- **THEN** each agent's prompt includes summary of other active tasks
- **THEN** summary includes task titles and affected areas
- **THEN** helps agents avoid conflicting changes

#### Scenario: Custom instructions injection
- **WHEN** `.coven/config.json` contains `context.custom_instructions`
- **THEN** custom instructions are injected into all agent prompts
- **THEN** custom instructions appear in a dedicated "Project-Specific Instructions" section

#### Scenario: Prior attempt context
- **WHEN** a task has been attempted previously by an agent
- **THEN** the prompt includes a summary of the prior attempt
- **THEN** summary includes: what was tried, why it failed/was blocked
- **THEN** enables agent to avoid repeating failed approaches

## ADDED Requirements

### Requirement: Review Agent Workflow
The system SHALL spawn a review agent after implementation completes to validate changes.

#### Scenario: Review agent triggered
- **WHEN** an implementation agent completes successfully
- **AND** review mode is not "disabled"
- **THEN** a review agent SHALL be spawned
- **THEN** the review agent uses the "review" role

#### Scenario: Review agent context
- **WHEN** review agent is spawned
- **THEN** prompt includes: original task context, git diff of changes
- **THEN** prompt includes review checklist (tests, patterns, security, completeness)
- **THEN** review agent has access to the same worktree as implementation agent

#### Scenario: Review agent completion
- **WHEN** review agent completes
- **THEN** result includes: PASS/FAIL verdict, list of findings, suggestions
- **THEN** findings are categorized by severity (error, warning, info)
- **THEN** result is reported via event stream

### Requirement: Review Modes
The system SHALL support configurable review modes controlling strictness.

| Mode | Behavior |
|------|----------|
| `strict` | All checks must pass, manual approval required |
| `normal` | Errors block, warnings reported, manual approval required |
| `yolo` | Warnings only, auto-merge on no errors |
| `disabled` | No review agent, immediate merge available |

#### Scenario: Strict mode review
- **WHEN** review mode is "strict"
- **AND** review agent reports any findings (error or warning)
- **THEN** merge SHALL be blocked
- **THEN** user must manually approve or reject changes

#### Scenario: Normal mode review
- **WHEN** review mode is "normal"
- **AND** review agent reports errors
- **THEN** merge SHALL be blocked
- **WHEN** review agent reports only warnings
- **THEN** warnings are displayed but merge is available
- **THEN** user must manually approve

#### Scenario: Yolo mode review
- **WHEN** review mode is "yolo"
- **AND** review agent reports no errors
- **THEN** changes SHALL be auto-merged
- **AND** warnings are logged but do not block

#### Scenario: Disabled review mode
- **WHEN** review mode is "disabled"
- **THEN** no review agent is spawned after implementation
- **THEN** merge is available immediately upon implementation completion

### Requirement: Review Checks
The system SHALL perform automated checks as part of the review process.

#### Scenario: Build check
- **WHEN** review agent runs
- **AND** build check is enabled
- **THEN** build command is executed
- **THEN** build failure results in error-level finding

#### Scenario: Lint check
- **WHEN** review agent runs
- **AND** lint check is enabled
- **THEN** lint command is executed
- **THEN** lint failures result in warning-level findings

#### Scenario: Test coverage check
- **WHEN** review agent runs
- **AND** test coverage check is enabled
- **THEN** new code without tests is detected
- **THEN** missing tests result in configurable-severity findings

#### Scenario: E2E test check
- **WHEN** review agent runs
- **AND** E2E test check is enabled
- **AND** changes affect user-facing code
- **THEN** absence of E2E tests results in warning-level finding
