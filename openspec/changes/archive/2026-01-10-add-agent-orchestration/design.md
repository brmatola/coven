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
- Four primitives only: agent, script, loop, merge
- Spells as composable prompt templates (file or inline)
- Labels drive grimoire selection with fallbacks
- Quality loop pattern for test + review iteration
- Simple bead lifecycle (open → in_progress → closed/blocked)
- Clear intervention signaling when max retries hit
- Dry-run mode for validating grimoires before execution

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

### Agent Output Schema

Agents must produce structured JSON output for workflow integration. The output enables:
- Success/failure determination
- Passing data to subsequent steps
- Actionable information when blocked

```json
{
  "success": true,
  "summary": "Implemented login feature with tests",
  "outputs": {
    "files_changed": ["src/auth/login.ts", "src/auth/login.test.ts"],
    "custom_field": "any value needed by next step"
  },
  "error": null
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes | Whether the step achieved its goal |
| `summary` | string | Yes | Human-readable description of what happened |
| `outputs` | object | No | Key-value pairs available to subsequent steps as `{{.step_name.outputs.key}}` |
| `error` | string | No | Error message if `success` is false |

**Agent Contract**: Spells must instruct the agent to output this JSON at the end:

```markdown
# .coven/spells/implement.md

... implementation instructions ...

## Output Format
When complete, output a JSON block:
\`\`\`json
{
  "success": true/false,
  "summary": "what you did",
  "outputs": { ... any data for next steps ... },
  "error": "if failed, why"
}
\`\`\`
```

**Parsing**: The workflow engine extracts the last JSON code block from agent output matching the schema.

### Agent System Prompt

Every agent invocation is wrapped with a system prompt that enforces the output contract. Spells provide task-specific instructions; the system prompt provides the execution framework.

```markdown
# .coven/system-prompt.md (built-in, can override)

You are executing a workflow step for Coven, an autonomous development system.

## Context
- Workflow: {{.workflow.name}}
- Step: {{.step.name}}
- Bead: {{.bead.title}} ({{.bead.id}})

## Your Task
{{.spell_content}}

## Output Contract (REQUIRED)
When you complete your task, you MUST output a JSON block as your final output:

\`\`\`json
{
  "success": true | false,
  "summary": "Brief description of what you accomplished or why you failed",
  "outputs": {
    // Any data the next step might need (optional)
  },
  "error": "Error message if success is false (optional)"
}
\`\`\`

Rules:
- Output this JSON block LAST, after all your work is complete
- Set success=false if you could not accomplish the task
- Include relevant data in outputs that subsequent steps may need
- Be specific in the summary - it will be logged and shown to users
```

**Composition**: Final agent prompt = System Prompt (rendered) + Spell Content (rendered)

The system prompt is rendered first with workflow context, then the spell is rendered and injected at `{{.spell_content}}`.

### Core Types

```go
// AgentOutput is the structured result from an agent step
type AgentOutput struct {
    Success bool              `json:"success"`
    Summary string            `json:"summary"`
    Outputs map[string]any    `json:"outputs,omitempty"`
    Error   *string           `json:"error,omitempty"`
}

// Grimoire defines a workflow for one unit of work
type Grimoire struct {
    Name        string `yaml:"name"`
    Description string `yaml:"description"`
    Steps       []Step `yaml:"steps"`
}

// Step is a unit of work in a grimoire
type Step struct {
    Name    string   `yaml:"name"`
    Type    StepType `yaml:"type"`  // agent, script, loop, merge
    Timeout string   `yaml:"timeout"` // Duration: "30s", "5m", "1h"

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

    // For merge steps
    RequireReview bool `yaml:"require_review"` // Default: true (conflicts always block)

    // Conditional execution
    When string `yaml:"when"` // {{.previous.failed}}, {{.needs_fixes}}
}

// WorkflowContext carries state through execution
type WorkflowContext struct {
    WorkflowID  string
    BeadID      string
    Grimoire    string
    Variables   map[string]any  // Step outputs
    CurrentStep int
    Status      WorkflowStatus  // running, blocked, completed, failed, pending_merge
    Error       *string
}

// WorkflowStatus represents the current state of a workflow
type WorkflowStatus string

const (
    WorkflowRunning      WorkflowStatus = "running"
    WorkflowBlocked      WorkflowStatus = "blocked"
    WorkflowCompleted    WorkflowStatus = "completed"
    WorkflowFailed       WorkflowStatus = "failed"
    WorkflowPendingMerge WorkflowStatus = "pending_merge"  // Waiting for user to approve merge
    WorkflowCancelled    WorkflowStatus = "cancelled"
)
```

### Step Types

| Type | Purpose | Key Fields |
|------|---------|------------|
| `agent` | Invoke agent with spell | `spell`, `input`, `output`, `when`, `timeout` |
| `script` | Run shell command | `command`, `on_fail`, `on_success`, `timeout` |
| `loop` | Repeat sub-steps | `steps`, `max_iterations`, `on_max_iterations` |
| `merge` | Merge worktree changes to main repo | `require_review` |

### Timeouts

All steps support timeout configuration to prevent runaway execution.

```yaml
- name: implement
  type: agent
  spell: implement
  timeout: 10m  # Duration string: 30s, 5m, 1h

- name: run-tests
  type: script
  command: "npm test"
  timeout: 5m
```

| Level | Default | Description |
|-------|---------|-------------|
| Step | `5m` for scripts, `15m` for agents | Per-step timeout |
| Workflow | `2h` | Overall workflow timeout |

When a timeout is reached:
- Agent steps: Process is killed, step marked failed
- Script steps: Process is killed, step marked failed
- Workflow timeout: Current step killed, workflow blocked

### Script Variable Escaping

Variables interpolated into script commands are **shell-escaped** to prevent command injection.

```yaml
# Safe: bead.id is escaped
command: "bd close {{.bead.id}}"
# If bead.id = "foo; rm -rf /" → command = "bd close 'foo; rm -rf /'"
```

Escaping uses single-quote wrapping with internal quote escaping. Variables are always treated as single arguments.

For cases requiring unescaped interpolation (advanced), use the `raw` function:
```yaml
command: "{{raw .custom_command}}"  # DANGEROUS: only for trusted sources
```

### Worktree Lifecycle

Each workflow executes in its own isolated git worktree. This ensures workflows don't interfere with each other or the main repository.

**Lifecycle**:
1. **Creation**: When scheduler picks up a bead, a worktree is created at `.worktrees/{bead-id}/`
2. **Execution**: All workflow steps execute within this worktree
3. **Merge**: The `merge` step requests merging changes back to main repo
4. **Cleanup**: After successful merge, worktree is deleted (in background process)

```
Scheduler picks up bead
        ↓
Create worktree (.worktrees/{bead-id}/)
        ↓
Run grimoire steps in worktree
        ↓
Merge step (requires human review by default)
        ↓
[User approves merge]
        ↓
Changes merged to main repo
        ↓
Worktree cleaned up (background)
```

**Multiple Ready Merges**: Multiple workflows may complete and be ready to merge simultaneously. Each merge requires explicit user action—there's no automatic queuing. Users can review and merge in any order.

### Merge Step

The `merge` step type handles merging workflow changes back to the main repository.

```yaml
- name: merge-changes
  type: merge
  require_review: true    # Default: true. User must approve before merge
```

| Field | Default | Description |
|-------|---------|-------------|
| `require_review` | `true` | If true, workflow pauses for human review before merging |

Merge conflicts always block the workflow for manual resolution.

**When `require_review: true`** (default):
1. Workflow emits `workflow.merge_pending` event
2. Workflow status becomes `pending_merge`
3. User reviews changes via API/UI
4. User approves → merge proceeds
5. User rejects → workflow blocks

**Merge Conflict Handling**:

When merge encounters conflicts, the workflow blocks and user must resolve manually. The blocked state includes conflict details (files, conflict markers) to help users understand what needs resolution.

Future enhancement: AI-assisted conflict resolution could be added post-MVP.

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

Steps reference outputs using Go template syntax `{{.variable}}`:

```yaml
- name: review
  type: agent
  spell: review
  output: findings

- name: check-actionable
  type: agent
  spell: is-actionable
  input:
    findings: "{{.findings}}"
  output: needs_fixes

- name: apply-fixes
  type: agent
  spell: apply-fixes
  when: "{{.needs_fixes}}"
```

**Variable Categories**:

| Variable | Description |
|----------|-------------|
| `{{.bead}}` | The bead being processed (id, title, description, etc.) |
| `{{.bead.id}}`, `{{.bead.title}}` | Bead fields |
| `{{.previous.output}}` | Previous step's AgentOutput or script stdout |
| `{{.previous.success}}` | Boolean, true if previous step succeeded |
| `{{.previous.failed}}` | Boolean, true if previous step failed |
| `{{.step_name}}` | Output from a named step |
| `{{.step_name.outputs.key}}` | Specific output field from agent step |
| `{{.loop_entry.output}}` | Output from step before loop started (see Loop Scoping) |
| `{{.loop_entry.success}}` | Success status from step before loop started |

### Variable Type Handling

Variables are rendered based on their underlying type (similar to JSON serialization):

| Type | Rendering |
|------|-----------|
| String | As-is |
| Number | String representation |
| Boolean | `"true"` or `"false"` |
| Array | JSON array: `["a", "b", "c"]` |
| Object | JSON object: `{"key": "value"}` |
| Null/Undefined | Empty string |

Examples:
```yaml
# If .findings.outputs.issues = ["bug1", "bug2"]
input:
  issues: "{{.findings.outputs.issues}}"
# Renders to: issues: '["bug1", "bug2"]'

# If .review.outputs.summary = "All good"
input:
  summary: "{{.review.outputs.summary}}"
# Renders to: summary: 'All good'
```

This enables passing structured data between steps while keeping YAML simple.

### Condition Evaluation

The `when` field evaluates to a boolean. **Only boolean values are accepted**—non-boolean values cause the workflow to fail.

```yaml
# Valid: .previous.failed is a boolean
when: "{{.previous.failed}}"

# Valid: .actionable.outputs.needs_fixes should be boolean
when: "{{.actionable.outputs.needs_fixes}}"
```

If a condition evaluates to a non-boolean (string, number, object), the workflow **fails immediately** with a clear error. This prevents subtle bugs from truthy/falsy coercion.

Agents must output boolean values for fields used in conditions:
```json
{
  "success": true,
  "outputs": {
    "needs_fixes": true,  // Boolean, not "true" string
    "issue_count": 3      // Number, not usable in 'when'
  }
}
```

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
      when: "{{.previous.failed}}"
      input:
        test_output: "{{.run_tests.output}}"

    # Review phase
    - name: review
      type: agent
      spell: review
      output: findings

    - name: check-actionable
      type: agent
      spell: is-actionable
      input:
        findings: "{{.findings.outputs.issues}}"
      output: actionable

    - name: apply-fixes
      type: agent
      spell: apply-review-fixes
      when: "{{.actionable.outputs.needs_fixes}}"
      input:
        issues: "{{.findings.outputs.issues}}"

    # Exit if clean
    - name: final-test
      type: script
      command: "npm test"
      on_success: exit_loop
```

Each iteration: test → fix if needed → review → fix if needed → test again → exit if pass.

If max iterations reached, grimoire blocks and user is notified.

### Loop Variable Scoping

Inside a loop, `{{.previous}}` and `{{.loop_entry}}` have distinct, consistent meanings:

| Variable | Meaning | Notes |
|----------|---------|-------|
| `{{.previous.*}}` | The step that just executed | Undefined on first step of first iteration |
| `{{.loop_entry.*}}` | The step that executed before the loop started | Always available inside loop |

**Important**: `{{.previous}}` does NOT change meaning based on iteration. On the first step of iteration 2+, `{{.previous}}` refers to the last step of the previous iteration.

Example: Access implementation output inside quality loop:
```yaml
- name: implement
  type: agent
  spell: implement
  output: implementation

- name: quality-loop
  type: loop
  steps:
    - name: run-tests        # First step: {{.previous}} is last step of prev iteration (or undefined on iter 1)
      type: script
      command: "npm test"

    - name: fix-tests
      type: agent
      spell: fix-tests
      input:
        # Access pre-loop context (always available)
        original_implementation: "{{.loop_entry.outputs.summary}}"
        # Access previous step in this iteration
        test_output: "{{.previous.output}}"
```

On first iteration, first step: use `{{.loop_entry}}` to access pre-loop context since `{{.previous}}` is undefined.

## Built-in Grimoires

### implement-bead

The core implementation workflow. See Quality Loop Pattern above for full definition.

### spec-to-beads

Converts an approved OpenSpec change proposal into actionable beads.

```yaml
# .coven/grimoires/spec-to-beads.yaml
name: spec-to-beads
description: "Parse an OpenSpec and create beads for implementation"

steps:
  - name: analyze-spec
    type: agent
    spell: analyze-spec
    input:
      spec_path: "{{.bead.description}}"  # Bead description contains path to spec
    output: analysis

  - name: create-beads
    type: agent
    spell: create-beads
    input:
      tasks: "{{.analysis.outputs.tasks}}"
      dependencies: "{{.analysis.outputs.dependencies}}"
      spec_path: "{{.bead.description}}"
    output: created

  - name: verify-beads
    type: script
    command: "bd list --status=open | grep -c '{{.bead.id}}'"
    on_fail: block
```

**analyze-spec spell** extracts:
- Individual tasks with acceptance criteria
- Dependencies between tasks
- Testing requirements per task
- Suggested grimoire labels

**create-beads spell** runs `bd create` for each task with:
- Title from task
- Description with AC baked in
- `grimoire:implement-bead` label (or custom if specified)
- Dependencies via `bd dep add`

### prepare-pr

Prepares a completed worktree for PR submission.

```yaml
# .coven/grimoires/prepare-pr.yaml
name: prepare-pr
description: "Prepare changes for pull request"

steps:
  - name: verify-tests
    type: script
    command: "npm test"
    on_fail: block

  - name: generate-summary
    type: agent
    spell: pr-summary
    input:
      bead: "{{.bead}}"
      diff: "{{.diff}}"  # Injected by workflow engine
    output: summary

  - name: create-pr
    type: script
    command: |
      gh pr create \
        --title "{{.bead.title}}" \
        --body "{{.summary.outputs.body}}" \
        --base main
    on_fail: block
    output: pr_url

  - name: link-bead
    type: script
    command: "bd update {{.bead.id}} --labels='pr:{{.pr_url.output}}'"
```

**pr-summary spell** generates:
- Summary of changes
- Test plan
- Link back to bead
- Any notable decisions or trade-offs

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

## Workflow State Persistence

Workflows must survive daemon restarts. State is persisted to enable resumption from the last completed step.

### State File

```
.coven/state/
└── workflows/
    └── {workflow-id}.json    # One file per active workflow
```

### Persisted State

```go
type PersistedWorkflowState struct {
    WorkflowID     string                 `json:"workflow_id"`
    BeadID         string                 `json:"bead_id"`
    Grimoire       string                 `json:"grimoire"`
    Status         WorkflowStatus         `json:"status"`
    CurrentStep    int                    `json:"current_step"`
    LoopState      *LoopState             `json:"loop_state,omitempty"`
    Variables      map[string]any         `json:"variables"`
    StepResults    []StepResult           `json:"step_results"`
    StartedAt      time.Time              `json:"started_at"`
    UpdatedAt      time.Time              `json:"updated_at"`
    BlockedReason  *string                `json:"blocked_reason,omitempty"`
}

type LoopState struct {
    StepIndex      int  `json:"step_index"`      // Which step in the loop
    Iteration      int  `json:"iteration"`       // Current iteration (0-indexed)
    EntryVariables any  `json:"entry_variables"` // loop_entry context
}

type StepResult struct {
    Name      string        `json:"name"`
    Status    string        `json:"status"`  // completed, failed, skipped
    Output    *AgentOutput  `json:"output,omitempty"`
    Duration  time.Duration `json:"duration"`
}
```

### Persistence Points

State is persisted:
1. After each step completes (success or failure)
2. At loop iteration boundaries
3. When workflow blocks

### Resumption

On daemon startup:
1. Scan `.coven/state/workflows/` for active workflows
2. For each with status `running`:
   - Reload grimoire definition
   - Restore variables from `StepResults`
   - Resume from `CurrentStep` (re-execute that step)
3. For blocked workflows: remain blocked until user action

### Cleanup

- Completed workflows: state file deleted after configurable retention (default: 7 days)
- Blocked workflows: state file retained until resolved

## Workflow REST API

The daemon exposes workflow management alongside existing task/agent endpoints.

### New Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/workflows` | GET | List all workflows (active, blocked, recent) |
| `/workflows/:id` | GET | Get workflow details and current state |
| `/workflows/:id/log` | GET | Stream or fetch workflow log file |
| `/workflows/:id/cancel` | POST | Cancel running workflow |
| `/workflows/:id/retry` | POST | Retry blocked workflow (re-run from blocked step) |
| `/workflows/:id/restart` | POST | Restart workflow from beginning |

### Workflow List Response

```json
GET /workflows?status=active,blocked

{
  "workflows": [
    {
      "id": "wf-abc123",
      "bead_id": "coven-xyz",
      "bead_title": "Add login feature",
      "grimoire": "implement-bead",
      "status": "running",
      "current_step": "quality-loop",
      "progress": {
        "completed_steps": 2,
        "total_steps": 4,
        "loop_iteration": 1
      },
      "started_at": "2026-01-09T14:30:00Z",
      "updated_at": "2026-01-09T14:35:00Z"
    },
    {
      "id": "wf-def456",
      "bead_id": "coven-abc",
      "bead_title": "Fix auth bug",
      "grimoire": "implement-bead",
      "status": "blocked",
      "current_step": "quality-loop",
      "blocked_reason": "Max iterations (3) reached in quality-loop",
      "blocked_context": {
        "last_test_output": "3 tests failing: ...",
        "last_review_findings": "Security issue in password handling",
        "iteration_summaries": [
          "Iteration 1: Fixed 2/5 tests",
          "Iteration 2: Fixed 1/3 tests, review found auth issue",
          "Iteration 3: Auth issue persists"
        ]
      },
      "worktree": "/path/to/.worktrees/coven-abc",
      "started_at": "2026-01-09T13:00:00Z",
      "blocked_at": "2026-01-09T13:45:00Z"
    }
  ],
  "count": 2
}
```

### Workflow Detail Response

```json
GET /workflows/wf-abc123

{
  "id": "wf-abc123",
  "bead_id": "coven-xyz",
  "grimoire": "implement-bead",
  "status": "running",
  "worktree": "/path/to/.worktrees/coven-xyz",
  "steps": [
    {
      "name": "implement",
      "type": "agent",
      "status": "completed",
      "duration_ms": 120000,
      "output_summary": "Implemented login form and API endpoint"
    },
    {
      "name": "quality-loop",
      "type": "loop",
      "status": "running",
      "iteration": 2,
      "max_iterations": 3,
      "sub_steps": [
        {"name": "run-tests", "status": "completed", "exit_code": 1},
        {"name": "fix-tests", "status": "running"}
      ]
    }
  ],
  "variables": {
    "implement": {"success": true, "summary": "..."}
  },
  "started_at": "2026-01-09T14:30:00Z"
}
```

### Blocked Workflow Actions

When a workflow blocks, the API provides actionable context:

```json
POST /workflows/wf-def456/retry

{
  "action": "retry",
  "from_step": "quality-loop",  // Optional: default is blocked step
  "modified_inputs": {          // Optional: override variables
    "review_strictness": "lenient"
  }
}
```

**User workflow for blocked state:**
1. Receive notification (via SSE `workflow.blocked` event)
2. `GET /workflows/:id` to see blocked context
3. Inspect worktree manually if needed
4. Either:
   - Fix issue in worktree, then `POST /workflows/:id/retry`
   - Adjust inputs and `POST /workflows/:id/retry` with `modified_inputs`
   - Give up: `POST /workflows/:id/cancel`

### SSE Events (Extended)

New event types for workflow layer:

| Event | Payload |
|-------|---------|
| `workflow.started` | `{workflow_id, bead_id, grimoire}` |
| `workflow.step.started` | `{workflow_id, step_name, step_type}` |
| `workflow.step.completed` | `{workflow_id, step_name, status, duration_ms, summary}` |
| `workflow.loop.iteration` | `{workflow_id, step_name, iteration, reason}` |
| `workflow.blocked` | `{workflow_id, bead_id, reason, context, worktree}` |
| `workflow.completed` | `{workflow_id, bead_id, duration_ms, summary}` |
| `workflow.cancelled` | `{workflow_id, bead_id, cancelled_by}` |

### Integration with Existing API

The existing endpoints remain but gain workflow awareness:

- `GET /tasks` - Tasks now include `workflow_id` if actively being processed
- `GET /agents/:id` - Agents include `workflow_id` and `step_name`
- `POST /tasks/:id/start` - **Deprecated for workflow beads**; use scheduler auto-pickup

**New pattern**: Workflows are the primary abstraction. Tasks/agents are implementation details visible for debugging but not the control surface.

## Dry-Run Mode

Preview what a grimoire would do without executing. Validates configuration and helps debug grimoire definitions.

### Command

```bash
coven grimoire preview <grimoire-name> --bead=<bead-id>
```

### Output

```
Grimoire: implement-bead
Bead: coven-xyz (Add login feature)
Worktree: .worktrees/coven-xyz (would be created)

Steps:
  1. [agent] implement
     Spell: implement.md (resolved from .coven/spells/)
     Input: { bead: {id: "coven-xyz", title: "Add login feature", ...} }

  2. [loop] quality-loop (max 3 iterations)
     2.1. [script] run-tests
          Command: npm test
          On fail: continue

     2.2. [agent] fix-tests
          When: {{.previous.failed}}
          Spell: fix-tests.md
          Input: { test_output: "{{.run_tests.output}}" }

     2.3. [agent] review
          Spell: review.md
          Output: → findings

     2.4. [agent] check-actionable
          Spell: is-actionable.md
          Input: { findings: "{{.findings.outputs.issues}}" }
          Output: → actionable

     2.5. [agent] apply-fixes
          When: {{.actionable.outputs.needs_fixes}}
          Spell: apply-review-fixes.md

     2.6. [script] final-test
          Command: npm test
          On success: exit_loop

  3. [merge] merge-changes
     Require review: true

Validation: ✓ All templates valid
            ✓ All spell references resolved
            ✓ No undefined variables in static context
```

### What It Validates

| Check | Description |
|-------|-------------|
| Grimoire resolution | Label → type mapping → default |
| Spell resolution | File exists or is inline |
| Template syntax | Go templates parse correctly |
| Static variable refs | Variables like `{{.bead.id}}` exist |
| Step structure | Required fields present, types valid |

### What It Can't Validate

- Runtime variable values (e.g., `{{.previous.output}}`)
- Agent output schema compliance
- Whether tests will pass
- Actual execution time

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

JSONL format capturing hierarchy of primitive calls and agent internal state:

```jsonl
{"ts":"2026-01-09T14:30:00Z","type":"workflow.start","workflow_id":"wf-abc123","bead_id":"coven-xyz","grimoire":"implement-bead"}
{"ts":"2026-01-09T14:30:01Z","type":"step.start","step":"implement","step_type":"agent","spell":"implement"}
{"ts":"2026-01-09T14:30:01Z","type":"step.input","step":"implement","input":{"bead":{"id":"coven-xyz","title":"Add login"}}}
{"ts":"2026-01-09T14:30:02Z","type":"agent.thinking","step":"implement","content":"I need to implement a login feature..."}
{"ts":"2026-01-09T14:30:05Z","type":"agent.tool_call","step":"implement","tool":"Read","input":{"file_path":"/src/auth/login.ts"}}
{"ts":"2026-01-09T14:30:06Z","type":"agent.tool_result","step":"implement","tool":"Read","output":"...file contents...","duration_ms":1000}
{"ts":"2026-01-09T14:30:10Z","type":"agent.tool_call","step":"implement","tool":"Edit","input":{"file_path":"/src/auth/login.ts","old_string":"...","new_string":"..."}}
{"ts":"2026-01-09T14:30:11Z","type":"agent.tool_result","step":"implement","tool":"Edit","output":"File updated","duration_ms":500}
{"ts":"2026-01-09T14:30:15Z","type":"agent.tool_call","step":"implement","tool":"Bash","input":{"command":"npm test"}}
{"ts":"2026-01-09T14:30:25Z","type":"agent.tool_result","step":"implement","tool":"Bash","output":"...test output...","exit_code":0,"duration_ms":10000}
{"ts":"2026-01-09T14:35:00Z","type":"step.output","step":"implement","summary":"Implemented login feature","tokens":{"input":1500,"output":3200}}
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
| `agent.thinking` | agent reasoning/thinking content |
| `agent.tool_call` | tool name, input parameters |
| `agent.tool_result` | tool output, duration, exit code (for Bash) |
| `step.output` | summary, token usage |
| `step.end` | status (success/failed/skipped), duration |
| `loop.iteration` | iteration number, reason for continue/exit |
| `workflow.end` | final status, total tokens, total duration |

### Agent Event Parsing

Claude CLI outputs structured events that we parse and log:
- **Thinking blocks**: Agent's reasoning before taking action
- **Tool calls**: Read, Write, Edit, Bash, Glob, Grep, etc.
- **Tool results**: Output from each tool invocation
- **Assistant messages**: Agent's text responses

This enables debugging questions like:
- "What files did the agent read before making changes?"
- "What command failed and why?"
- "What was the agent's reasoning when it made that decision?"

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
