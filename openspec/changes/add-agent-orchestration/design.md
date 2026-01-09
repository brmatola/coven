# Design: Workflow-Based Agent Orchestration

## Context

Coven's daemon can spawn agents in worktrees and merge changes back. The next layer is **workflow orchestration**: defining multi-step processes that combine agent work with script-based quality checks, enabling autonomous feature implementation.

### Key Insight
Claude Code already handles codebase navigation via CLAUDE.md/AGENTS.md. We don't reinvent that. Our value is in:
1. **Workflow composition**: Defining sequences of agent + script steps
2. **Quality loops**: Iterating until tests pass and reviews are clean
3. **Handoffs**: Passing context between steps cleanly
4. **Scheduling**: k8s-style pickup of ready work, N at a time

### Stakeholders
- **Developers**: Define and run workflows, review flagged work
- **Teams**: Share custom grimoires and spells via `.coven/`
- **Agents**: Execute steps, receive handoff context
- **Scheduler**: Picks up ready beads, runs grimoires, respects concurrency

## Goals / Non-Goals

### Goals
- Three primitives only: agent, script, loop
- Spells as composable prompt templates (file or inline)
- Labels drive grimoire selection with fallbacks
- Quality loop pattern for test + review iteration
- Simple bead lifecycle (open → in_progress → closed/blocked)
- Clear intervention signaling when max retries hit

### Non-Goals
- Complex DAG-based workflow engines
- Visual workflow builders
- Goto/branching (keep it linear with loops)
- Magic requeuing (grimoire is explicit about the full flow)

## Architecture

### Directory Structure

```
.coven/
├── config.json              # Global settings
├── grimoires/               # Workflow definitions
│   ├── implement-bead.yaml  # Built-in (can override)
│   ├── spec-to-beads.yaml   # Built-in
│   └── prepare-pr.yaml      # Built-in
└── spells/                  # Prompt templates
    ├── implement.md         # Built-in (can override)
    ├── review.md            # Built-in
    ├── fix-tests.md         # Built-in
    └── is-actionable.md     # Arbiter prompt

packages/daemon/internal/
├── workflow/                # Workflow engine (NEW)
│   ├── engine.go            # Workflow execution
│   ├── step.go              # Step executors (agent, script, loop)
│   ├── context.go           # Variable passing
│   └── state.go             # Workflow state
├── grimoire/                # Grimoire loading (NEW)
│   ├── loader.go            # Load from .coven/grimoires/
│   ├── parser.go            # YAML parsing
│   └── builtin/             # Embedded built-in grimoires
├── spell/                   # Spell loading (NEW)
│   ├── loader.go            # Load from .coven/spells/
│   ├── renderer.go          # Go template rendering
│   └── builtin/             # Embedded built-in spells
└── scheduler/               # Enhanced scheduler
    └── scheduler.go         # Grimoire selection, bead lifecycle
```

### Core Types

```go
// Grimoire defines a workflow for one unit of work
type Grimoire struct {
    Name        string `yaml:"name"`
    Description string `yaml:"description"`
    Steps       []Step `yaml:"steps"`
}

// Step is a unit of work in a grimoire
type Step struct {
    Name    string   `yaml:"name"`
    Type    StepType `yaml:"type"`  // agent, script, loop

    // For agent steps
    Spell   string            `yaml:"spell"`   // File ref or inline
    Input   map[string]string `yaml:"input"`
    Output  string            `yaml:"output"`

    // For script steps
    Command   string `yaml:"command"`
    OnFail    string `yaml:"on_fail"`    // continue, block
    OnSuccess string `yaml:"on_success"` // exit_loop

    // For loop steps
    Steps         []Step `yaml:"steps"`
    MaxIterations int    `yaml:"max_iterations"`
    OnMaxIter     string `yaml:"on_max_iterations"` // block

    // Conditional execution
    When string `yaml:"when"` // ${previous.failed}, ${needs_fixes}
}

// WorkflowContext carries state through execution
type WorkflowContext struct {
    WorkflowID  string
    BeadID      string
    Grimoire    string
    Variables   map[string]any  // Step outputs
    CurrentStep int
    Status      WorkflowStatus  // running, blocked, completed, failed
    Error       *string
}
```

### Step Types

| Type | Purpose | Key Fields |
|------|---------|------------|
| `agent` | Invoke agent with spell | `spell`, `input`, `output`, `when` |
| `script` | Run shell command | `command`, `on_fail`, `on_success` |
| `loop` | Repeat sub-steps | `steps`, `max_iterations`, `on_max_iterations` |

### Spells

Spells are Markdown files with Go template syntax:

```markdown
# .coven/spells/implement.md

You are implementing a feature.

## Task
{{.bead.title}}

## Description
{{.bead.description}}

## Acceptance Criteria
{{range .bead.acceptance_criteria}}
- {{.}}
{{end}}

## Instructions
- Write clean, maintainable code
- Include unit tests for new functionality
- Follow existing patterns in the codebase
```

**Inline spells** for simple cases:
```yaml
- type: agent
  spell: |
    Fix the failing tests:
    {{.test_output}}
```

**Resolution order**:
1. If `spell` contains newlines → treat as inline
2. Else check `.coven/spells/{spell}.md`
3. Else check built-in spells

### Grimoire Selection

Beads specify grimoire via label:
```bash
bd create --title="Add login" --labels="grimoire:implement-bead"
```

**Resolution order**:
1. Check bead labels for `grimoire:*` → use that grimoire
2. Check config type mapping (`feature` → `implement-bead`)
3. Use default grimoire from config

```json
// .coven/config.json
{
  "grimoire": {
    "default": "implement-bead",
    "type_mapping": {
      "feature": "implement-bead",
      "bug": "implement-bead"
    }
  }
}
```

### Bead Lifecycle

Simple state machine:

```
open ──────► in_progress ──────► closed
                 │
                 └──────────────► blocked
```

| Status | Meaning |
|--------|---------|
| `open` | Ready to be picked up |
| `in_progress` | Actively being worked by grimoire |
| `blocked` | Needs manual intervention |
| `closed` | Done, merged |

Scheduler:
1. Query beads: `status=open`, no unmet dependencies
2. Pick up to N beads (concurrency limit)
3. Set `in_progress`, run grimoire
4. On success → `closed`
5. On `block` action → `blocked`, notify user

### Variable Resolution

Steps reference outputs using `${variable}` syntax:

```yaml
- name: review
  type: agent
  spell: review
  output: findings

- name: check-actionable
  type: agent
  spell: is-actionable
  input:
    findings: ${findings}
  output: needs_fixes

- name: apply-fixes
  type: agent
  spell: apply-fixes
  when: ${needs_fixes}
```

Special variables:
- `${bead}` - The bead being processed
- `${previous.output}` - Previous step's output
- `${previous.failed}` - Boolean, true if previous step failed

### Quality Loop Pattern

The standard pattern for test + review iteration:

```yaml
- name: quality-loop
  type: loop
  max_iterations: 3
  on_max_iterations: block
  steps:
    # Test phase
    - name: run-tests
      type: script
      command: "npm test"
      on_fail: continue

    - name: fix-tests
      type: agent
      spell: fix-tests
      when: ${previous.failed}

    # Review phase
    - name: review
      type: agent
      spell: review
      output: findings

    - name: check-actionable
      type: agent
      spell: is-actionable
      input:
        findings: ${findings}
      output: needs_fixes

    - name: apply-fixes
      type: agent
      spell: apply-review-fixes
      when: ${needs_fixes}

    # Exit if clean
    - name: final-test
      type: script
      command: "npm test"
      on_success: exit_loop
```

Each iteration: test → fix if needed → review → fix if needed → test again → exit if pass.

If max iterations reached, grimoire blocks and user is notified.

### Workflow Execution Flow

```
Scheduler picks up bead
        ↓
Resolve grimoire (label → type → default)
        ↓
Load grimoire definition
        ↓
Initialize WorkflowContext
        ↓
┌─────────────────────────────────────┐
│ For each step:                      │
│   1. Check `when` condition         │
│   2. Resolve input variables        │
│   3. Execute step (type-dependent)  │
│   4. Store output in context        │
│   5. Handle on_fail/on_success      │
└─────────────────────────────────────┘
        ↓
Workflow complete → close bead
   or blocked → flag for user
```

## Decisions

### Decision 1: Three Primitives Only
**Choice**: agent, script, loop
**Alternatives**: Add gate, conditional, parallel
**Rationale**: Minimal surface area. Scripts with `on_fail` cover gates. Loops cover iteration. Scheduler handles parallelism.

### Decision 2: Spells Separate from Grimoires
**Choice**: Prompts in `.coven/spells/`, referenced by name
**Alternatives**: Inline only, embedded in grimoire
**Rationale**: Reusable across grimoires, easy to override, readable. Inline option for quick stuff.

### Decision 3: Labels for Grimoire Selection
**Choice**: `grimoire:name` label on bead
**Alternatives**: Separate field, type-only mapping
**Rationale**: Flexible, no schema change, explicit per-bead control with fallbacks.

### Decision 4: No Goto
**Choice**: Linear with loops only
**Alternatives**: Goto, full state machine
**Rationale**: Simpler mental model. Loops handle iteration. If you need goto, your workflow is too complex.

### Decision 5: Block on Max Iterations
**Choice**: Flag for manual review, don't auto-retry forever
**Alternatives**: Infinite retry, auto-close as failed
**Rationale**: Prevents runaway costs. Human-in-loop for edge cases.

## Risks / Trade-offs

### Risk 1: Loop Doesn't Converge
**Risk**: Quality loop keeps finding issues
**Mitigation**: Hard max_iterations limit, block action, cost visibility

### Risk 2: Spell Template Errors
**Risk**: Template syntax errors at runtime
**Mitigation**: Validate templates on load, clear error messages

### Risk 3: Complex Workflows
**Risk**: Users create deeply nested loops
**Mitigation**: Recommend flat patterns, document best practices

## Migration Plan

### Phase 1: Core Engine
1. Define types (Grimoire, Step, WorkflowContext)
2. Implement workflow engine with agent and script steps
3. Implement variable resolution
4. Unit tests

### Phase 2: Loop and Spells
1. Implement loop step type
2. Implement spell loader (file + inline)
3. Implement spell renderer (Go templates)
4. Unit tests

### Phase 3: Grimoire Loading
1. Implement grimoire loader
2. Embed built-in grimoires and spells
3. Implement label-based grimoire selection
4. Integration tests

### Phase 4: Built-ins
1. Create implement-bead grimoire with quality loop
2. Create spec-to-beads grimoire
3. Create all built-in spells
4. E2E tests

### Phase 5: Integration
1. Wire into scheduler (bead lifecycle)
2. Add workflow events to SSE
3. Add API endpoints
4. Full E2E test

## Workflow Logging

One log file per workflow run for observability and debugging.

### Log Location

```
.coven/logs/
└── workflows/
    └── {workflow-id}.jsonl    # One file per workflow run
```

### Log Structure

JSONL format capturing hierarchy of primitive calls:

```jsonl
{"ts":"2026-01-09T14:30:00Z","type":"workflow.start","workflow_id":"wf-abc123","bead_id":"coven-xyz","grimoire":"implement-bead"}
{"ts":"2026-01-09T14:30:01Z","type":"step.start","step":"implement","step_type":"agent","spell":"implement"}
{"ts":"2026-01-09T14:30:01Z","type":"step.input","step":"implement","input":{"bead":{"id":"coven-xyz","title":"Add login"}}}
{"ts":"2026-01-09T14:35:00Z","type":"step.output","step":"implement","output":"...agent stdout...","tokens":{"input":1500,"output":3200}}
{"ts":"2026-01-09T14:35:00Z","type":"step.end","step":"implement","status":"success","duration_ms":299000}
{"ts":"2026-01-09T14:35:01Z","type":"step.start","step":"quality-loop","step_type":"loop","iteration":1}
{"ts":"2026-01-09T14:35:02Z","type":"step.start","step":"run-tests","step_type":"script","command":"npm test"}
{"ts":"2026-01-09T14:35:10Z","type":"step.output","step":"run-tests","output":"...test output...","exit_code":1}
{"ts":"2026-01-09T14:35:10Z","type":"step.end","step":"run-tests","status":"failed","duration_ms":8000}
...
{"ts":"2026-01-09T14:45:00Z","type":"workflow.end","status":"completed","total_tokens":{"input":8500,"output":15000},"duration_ms":900000}
```

### What Gets Logged

| Event | Data |
|-------|------|
| `workflow.start` | workflow_id, bead_id, grimoire name |
| `step.start` | step name, type, spell/command, iteration (for loops) |
| `step.input` | resolved input variables passed to step |
| `step.output` | full stdout/stderr, exit code, token usage |
| `step.end` | status (success/failed/skipped), duration |
| `loop.iteration` | iteration number, reason for continue/exit |
| `workflow.end` | final status, total tokens, total duration |

### Token Tracking

If Claude CLI exposes token consumption (via `--usage` flag or output parsing):
- Capture per-agent-step: `{"tokens": {"input": N, "output": M}}`
- Aggregate at workflow end: `{"total_tokens": {"input": N, "output": M}}`

### Usage

Logs enable:
1. **Debugging**: Feed log to Claude for analysis when things break
2. **Optimization**: Identify slow steps, token-heavy spells
3. **Audit**: Understand what happened in each workflow run

## Spell Partials

Spells can include other spells with parameterized variables.

### Syntax

```markdown
{{include "common-guidelines.md" project="coven" style="functional"}}
```

Partials receive explicit variables, not implicit context:

```markdown
# .coven/spells/common-guidelines.md
You are working on the {{.project}} project.
Follow {{.style}} programming style.
```

### Variable Passing

Variables can be:
- Literal strings: `variable="value"`
- Context references: `variable={{.bead.title}}`

```markdown
{{include "task-context.md" title={{.bead.title}} description={{.bead.description}}}}
```

### Resolution

1. Check `.coven/spells/{name}.md`
2. Fall back to built-in spells
3. Error if not found

### Nesting

Partials can include other partials (with depth limit to prevent cycles).
