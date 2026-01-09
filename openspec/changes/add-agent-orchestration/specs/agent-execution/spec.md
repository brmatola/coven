# Agent Execution Specification Delta

## MODIFIED Requirements

### Requirement: Agent Spawning
The system SHALL spawn Claude Code CLI processes to execute tasks in isolated worktrees.

Agent spawning is now integrated with the workflow engine. Agents can be spawned directly for tasks or as part of workflow steps.

#### Scenario: Spawn agent for task
- **WHEN** a task is ready for execution
- **THEN** ClaudeAgent spawns a claude process in the task's worktree
- **THEN** the prompt includes task description and acceptance criteria from beads
- **THEN** output streaming begins immediately

#### Scenario: Spawn agent for workflow step
- **WHEN** a workflow step of type `agent` executes
- **THEN** an agent is spawned with the step's rendered prompt
- **THEN** the agent receives handoff context from previous steps
- **THEN** output is captured for the workflow context

#### Scenario: Agent working directory
- **WHEN** agent is spawned
- **THEN** agent's working directory is set to the task's worktree
- **THEN** agent has access only to files in that worktree
- **THEN** CLAUDE.md/AGENTS.md in the worktree guide agent behavior

### Requirement: Agent Profiles
The system SHALL support agent profiles defining prompt templates and behavior for different task types.

**Note**: Profiles are now managed via grimoires. Each grimoire step can specify a prompt template. Built-in prompts are provided for common patterns.

#### Scenario: Default profile
- **WHEN** a task is executed without a workflow
- **THEN** the default prompt template is used
- **THEN** prompt includes: task title, description, acceptance criteria

#### Scenario: Profile via grimoire step
- **WHEN** a workflow step specifies a prompt template
- **THEN** the template is loaded and rendered with step context
- **THEN** handoff context from previous steps is included

#### Scenario: Custom prompt templates
- **WHEN** a user creates `.coven/prompts/*.md` files
- **THEN** these templates are available for grimoire steps
- **THEN** templates support Go template syntax for variable injection

### Requirement: Context Injection
The system SHALL inject relevant context into agent prompts.

**Note**: We rely on Claude Code's CLAUDE.md/AGENTS.md for codebase navigation. Context injection focuses on workflow-specific handoffs.

#### Scenario: Task context injection
- **WHEN** agent is spawned for a task
- **THEN** prompt includes: task title, description, acceptance criteria
- **THEN** acceptance criteria come from the bead definition

#### Scenario: Workflow handoff context
- **WHEN** agent is spawned as part of a workflow
- **THEN** prompt includes outputs from previous workflow steps
- **THEN** relevant artifacts (file paths, bead IDs, git refs) are passed

#### Scenario: Prior attempt context
- **WHEN** a task has been attempted previously
- **THEN** the prompt MAY include a summary of the prior attempt
- **THEN** summary helps agent avoid repeating failed approaches

## ADDED Requirements

### Requirement: Workflow Step Integration
The system SHALL support agent execution as workflow steps.

#### Scenario: Agent step receives handoff
- **WHEN** an agent step executes in a workflow
- **THEN** the agent receives context from all previous steps
- **THEN** context is formatted according to the prompt template

#### Scenario: Agent step produces output
- **WHEN** an agent step completes
- **THEN** the agent's completion output is captured
- **THEN** output is stored in workflow context for subsequent steps

#### Scenario: Agent step failure
- **WHEN** an agent step fails or times out
- **THEN** the failure is reported to the workflow engine
- **THEN** the workflow MAY retry, block, or fail based on configuration

### Requirement: Review Agent Support
The system SHALL support review agents that evaluate changes made by other agents.

#### Scenario: Review agent spawning
- **WHEN** a workflow step invokes a review agent
- **THEN** the agent receives: original task context, git diff of changes
- **THEN** the agent uses a review-specific prompt template

#### Scenario: Review agent output
- **WHEN** a review agent completes
- **THEN** output includes: verdict (pass/fail), findings list, suggestions
- **THEN** findings are categorized by severity (error, warning, info)

#### Scenario: Arbiter agent spawning
- **WHEN** an agent-loop step invokes an arbiter
- **THEN** the arbiter receives: primary agent output, iteration history
- **THEN** the arbiter determines if findings are actionable
- **THEN** arbiter output is boolean (continue loop or exit)
