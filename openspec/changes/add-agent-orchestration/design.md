# Design: Workflow-Based Agent Orchestration

## Context

Coven's daemon can spawn agents in worktrees and merge changes back. The next layer is **workflow orchestration**: defining multi-step processes that combine agent work with script-based quality gates, enabling autonomous feature implementation from spec to PR.

### Key Insight
Claude Code already handles codebase navigation via CLAUDE.md/AGENTS.md. We don't reinvent that. Our value is in:
1. **Workflow composition**: Defining sequences of agent + script steps
2. **Review loops**: Iterating until quality is acceptable
3. **Handoffs**: Passing context between steps cleanly
4. **Gates**: Script-based quality checkpoints that block or allow progression

### Stakeholders
- **Developers**: Define and run workflows, review results
- **Teams**: Share custom workflows via `.coven/grimoires/`
- **Agents**: Execute steps, receive handoff context
- **Daemon**: Orchestrates workflow execution

## Goals / Non-Goals

### Goals
- Composable workflow primitives (agent, agent-loop, parallel-agents, script, gate)
- Built-in grimoires for common patterns (spec→beads, implement+review, prepare-pr)
- User-definable custom grimoires in YAML
- Clean handoffs with context between steps
- Review loops with arbiter pattern (separate agent judges actionability)
- Clear intervention signaling when human needed

### Non-Goals
- Complex DAG-based workflow engines (keep it sequential with fan-out)
- Visual workflow builders (YAML is the interface)
- Cross-repository workflows (single repo focus)
- Real-time collaboration on workflows

## Architecture

### Directory Structure

```
.coven/
├── config.json              # Global settings
└── grimoires/               # Workflow definitions
    ├── spec-to-beads.yaml   # Built-in (can override)
    ├── implement-bead.yaml  # Built-in
    ├── review-loop.yaml     # Built-in
    ├── prepare-pr.yaml      # Built-in
    └── custom-*.yaml        # User-defined

packages/daemon/internal/
├── workflow/                # Workflow engine (NEW)
│   ├── engine.go            # Workflow execution
│   ├── step.go              # Step interface and implementations
│   ├── context.go           # Workflow context and variable passing
│   └── state.go             # Workflow state persistence
├── grimoire/                # Grimoire loading (NEW)
│   ├── loader.go            # Load from .coven/grimoires/
│   ├── parser.go            # YAML parsing
│   ├── validator.go         # Schema validation
│   └── builtin.go           # Embedded built-in grimoires
├── prompts/                 # Prompt templates (NEW)
│   ├── spec-to-beads.md     # Convert openspec to beads
│   ├── implement-bead.md    # Implement a single bead
│   ├── review-changes.md    # Review agent prompt
│   ├── is-actionable.md     # Arbiter prompt
│   └── prepare-pr.md        # PR preparation prompt
└── scheduler/               # Enhanced to support workflows
    └── scheduler.go         # Workflow step scheduling
```

### Core Types

```go
// Grimoire defines a multi-step workflow
type Grimoire struct {
    Name        string            `yaml:"name"`
    Description string            `yaml:"description"`
    Trigger     string            `yaml:"trigger"`  // manual, on_event
    Input       []InputDef        `yaml:"input"`
    Steps       []Step            `yaml:"steps"`
}

// Step is a single unit of work in a workflow
type Step struct {
    Name          string            `yaml:"name"`
    Type          StepType          `yaml:"type"`  // agent, agent-loop, parallel-agents, script, gate
    Prompt        string            `yaml:"prompt"`
    Command       string            `yaml:"command"`
    Input         map[string]string `yaml:"input"`
    Output        string            `yaml:"output"`

    // For parallel-agents
    ForEach       string            `yaml:"for_each"`
    MaxConcurrent int               `yaml:"max_concurrent"`

    // For agent-loop
    MaxIterations int               `yaml:"max_iterations"`
    ExitWhen      string            `yaml:"exit_when"`
    ArbiterPrompt string            `yaml:"arbiter_prompt"`

    // For gates
    OnFail        string            `yaml:"on_fail"`  // block, retry, escalate
    Message       string            `yaml:"message"`
}

// WorkflowContext carries state through workflow execution
type WorkflowContext struct {
    WorkflowID    string
    GrimoireName  string
    Input         map[string]any
    Variables     map[string]any  // Step outputs
    CurrentStep   int
    Status        WorkflowStatus
    StartedAt     time.Time
    CompletedAt   *time.Time
    Error         *string
}
```

### Step Types

| Type | Purpose | Execution |
|------|---------|-----------|
| `agent` | Single agent invocation | Spawn agent with prompt, wait for completion |
| `agent-loop` | Repeated agent until condition | Loop with arbiter checking exit condition |
| `parallel-agents` | Fan-out to N agents | Spawn multiple agents, wait for all |
| `script` | Run shell command | Execute command, capture output |
| `gate` | Quality checkpoint | Run command, block if non-zero exit |

### Workflow Execution Flow

```
User triggers grimoire
        ↓
Load grimoire definition
        ↓
Initialize WorkflowContext with input
        ↓
┌─────────────────────────────────────┐
│ For each step:                      │
│   1. Resolve input variables        │
│   2. Execute step (type-dependent)  │
│   3. Store output in context        │
│   4. Check for failure/intervention │
└─────────────────────────────────────┘
        ↓
Workflow complete or blocked
```

### Agent-Loop with Arbiter Pattern

The review loop uses two agents:
1. **Review Agent**: Examines changes, produces findings
2. **Arbiter Agent**: Judges if findings are actionable

```
┌─────────────────────────────────────────────┐
│ Agent Loop                                  │
│                                             │
│   Review Agent → findings                   │
│         ↓                                   │
│   Arbiter Agent → actionable? (yes/no)      │
│         ↓                                   │
│   if actionable && iterations < max:        │
│       Apply fixes (Review Agent)            │
│       Loop again                            │
│   else:                                     │
│       Exit loop                             │
└─────────────────────────────────────────────┘
```

This prevents infinite loops and handles subjective quality judgments.

### Variable Resolution

Steps reference outputs from previous steps using `${variable}` syntax:

```yaml
steps:
  - name: convert
    output: beads          # Stores result as "beads"

  - name: implement
    for_each: ${beads}     # References previous output
    output: implementations

  - name: review
    input:
      changes: ${implementations}  # References previous output
```

Variables are stored in `WorkflowContext.Variables` and resolved at step execution time.

### Built-in Prompts

Prompts are Markdown files with template variables:

```markdown
# .coven/prompts/spec-to-beads.md

You are converting an OpenSpec change proposal into actionable beads.

## Input
OpenSpec path: {{.openspec}}

## Instructions
1. Read the proposal.md, design.md, and tasks.md
2. For each logical unit of work, create a bead with:
   - Clear title describing the deliverable
   - Description with context needed for implementation
   - Acceptance criteria (testable conditions)
   - Testing requirements (unit tests, E2E tests expected)
   - Dependencies on other beads (if any)

3. Beads should be:
   - Small enough for one agent session (< 1 hour of work)
   - Self-contained (agent can complete without other beads)
   - Testable (clear definition of done)

## Output
Use `bd create` to create each bead. Include all context in the bead itself.
```

### Handoff Context

When one step completes, the next step receives:
1. **Explicit outputs**: Named variables from `output` field
2. **Implicit context**: WorkflowContext with full history
3. **Artifacts**: File paths, git refs, bead IDs

For agent steps, handoff context is injected into the prompt:

```markdown
## Previous Step: {{.previous_step.name}}
Result: {{.previous_step.output}}

## Your Task
{{.current_step.prompt}}
```

## Decisions

### Decision 1: YAML for Grimoires
**Choice**: Define workflows in YAML
**Alternatives**: JSON, code-based (Go DSL), visual builder
**Rationale**: YAML is human-readable, widely understood, git-friendly. Complex enough for our needs without over-engineering.

### Decision 2: Sequential Steps with Fan-out
**Choice**: Steps execute sequentially; `parallel-agents` is the only fan-out
**Alternatives**: Full DAG engine, arbitrary parallelism
**Rationale**: Keeps mental model simple. Most workflows are linear with one parallelization point (implement N beads). Can extend later if needed.

### Decision 3: Arbiter Pattern for Loops
**Choice**: Separate "arbiter" agent judges if loop should continue
**Alternatives**: Same agent decides, fixed iteration count, script-based check
**Rationale**: Fresh context avoids bias ("I just said this is fine, so it must be"). Separates "find issues" from "judge severity". More robust quality signal.

### Decision 4: Prompts as Markdown Files
**Choice**: Store prompts as .md files with template variables
**Alternatives**: Inline in YAML, Go templates, external service
**Rationale**: Markdown is readable, supports formatting, easy to edit. Template variables keep them reusable.

### Decision 5: Gates are Scripts
**Choice**: Quality gates are shell commands (exit 0 = pass)
**Alternatives**: Agent-based gates, built-in checks
**Rationale**: Leverages existing tooling (npm test, eslint, etc). Users already know how to write these. More reliable than agent judgment for objective criteria.

## Risks / Trade-offs

### Risk 1: Workflow Complexity
**Risk**: Users create overly complex workflows that are hard to debug
**Mitigation**: Start with simple primitives, good error messages, workflow visualization in UI

### Risk 2: Agent Loop Divergence
**Risk**: Review loops don't converge, burning tokens
**Mitigation**: Hard max_iterations limit, arbiter pattern, cost tracking per workflow

### Risk 3: Handoff Context Loss
**Risk**: Important context lost between steps
**Mitigation**: Explicit output naming, full context available to prompts, step history in WorkflowContext

### Risk 4: Gate Flakiness
**Risk**: Tests flaky, gates fail intermittently
**Mitigation**: Retry option for gates, clear error messages, don't block on warnings

## Migration Plan

### Phase 1: Workflow Engine Core
1. Define core types (Grimoire, Step, WorkflowContext)
2. Implement workflow engine with basic step execution
3. Support `agent` and `script` step types
4. Unit tests for engine

### Phase 2: Grimoire Loading
1. Implement YAML parser and validator
2. Embed built-in grimoires
3. Load custom grimoires from `.coven/grimoires/`
4. Unit tests for loading

### Phase 3: Advanced Steps
1. Implement `parallel-agents` with concurrency control
2. Implement `agent-loop` with arbiter pattern
3. Implement `gate` with failure handling
4. Integration tests

### Phase 4: Built-in Grimoires
1. Create `spec-to-beads` grimoire and prompt
2. Create `implement-bead` grimoire and prompt
3. Create `review-loop` grimoire with arbiter
4. Create `prepare-pr` grimoire
5. E2E tests for each built-in

### Phase 5: Integration
1. Wire grimoire execution into daemon API
2. Add workflow status to events/UI
3. Documentation
4. Full E2E test of spec→PR flow

## Open Questions

1. **Workflow Persistence**: How much workflow state to persist? Just current step, or full history?
2. **Cost Tracking**: Should we track token/cost per workflow for user visibility?
3. **Partial Completion**: If workflow fails mid-way, how to resume vs restart?
4. **Triggers**: Beyond manual, what events can trigger workflows? (openspec approval, bead creation, etc.)
