# Workflow Orchestration

Coven's daemon (`covend`) orchestrates AI agent workflows using **grimoires** (workflow definitions) and **spells** (prompt templates). This guide explains how to configure and use the orchestration system.

## Overview

When a bead (task) is picked up by the daemon, it:

1. Resolves which grimoire to use based on labels, type, or defaults
2. Creates a git worktree for isolated work
3. Executes the grimoire's steps sequentially
4. Manages merging changes back to main

## Directory Structure

```
.coven/
├── grimoires/           # User-defined workflow definitions
│   └── my-workflow.yaml
├── spells/              # User-defined prompt templates
│   └── implement.md
├── grimoire-mapping.json # Optional: type-to-grimoire mapping
├── logs/workflows/      # Execution logs (JSONL)
└── state/workflows/     # Workflow state for resume
```

## Grimoires

A grimoire is a YAML file defining a workflow as a sequence of steps.

### Basic Structure

```yaml
name: implement-feature
description: Implement a feature end-to-end
timeout: 2h  # Optional, default: 1h

steps:
  - name: implement
    type: agent
    spell: implement
    timeout: 15m

  - name: run-tests
    type: script
    command: "npm test"
    timeout: 5m
```

### Step Types

Coven supports four step types:

| Type | Purpose |
|------|---------|
| `agent` | Invoke an AI agent with a prompt |
| `script` | Run a shell command |
| `loop` | Repeat steps until condition or max iterations |
| `merge` | Merge worktree changes to main branch |

## Agent Steps

Agent steps invoke an AI agent with a rendered spell (prompt).

```yaml
- name: implement
  type: agent
  spell: implement           # Spell name (from .coven/spells/) or inline content
  input:                     # Variables passed to spell template
    bead: "{{.bead}}"
    context: "Additional context"
  output: implementation     # Store result under this alias
  timeout: 15m               # Default: 15m
  when: "{{.previous.success}}"  # Optional condition
```

### Agent Output Format

Agents must produce a JSON block at the end of their output:

```json
{
  "success": true,
  "summary": "Implemented the user authentication feature",
  "outputs": {
    "files_changed": ["src/auth.ts", "src/login.tsx"],
    "tests_added": 3
  },
  "error": null
}
```

The `outputs` object becomes available in subsequent steps as `{{.step_name.outputs.key}}`.

## Script Steps

Script steps execute shell commands in the worktree.

```yaml
- name: run-tests
  type: script
  command: "npm test"
  timeout: 5m          # Default: 5m
  on_fail: continue    # continue | block (default: block)
  on_success: exit_loop  # Only valid inside loops
```

### Failure Handling

- `on_fail: continue` - Continue workflow, `{{.previous.failed}}` becomes `true`
- `on_fail: block` (default) - Block workflow immediately

## Loop Steps

Loop steps repeat nested steps until a condition is met or max iterations is reached.

```yaml
- name: test-fix-loop
  type: loop
  max_iterations: 5
  on_max_iterations: block  # block | exit | continue
  steps:
    - name: run-tests
      type: script
      command: "npm test"
      on_fail: continue
      on_success: exit_loop

    - name: fix-failures
      type: agent
      spell: fix-tests
      when: "{{.previous.failed}}"
```

### Loop Exit Conditions

Loops exit when:
- A step sets `on_success: exit_loop` and succeeds
- `max_iterations` is reached

### Max Iterations Actions

- `block` - Block workflow for manual intervention
- `exit` - Exit loop and continue workflow
- `continue` - Same as `exit`

### Loop Context Variables

Inside loops:
- `{{.previous.success}}` - Whether the last step succeeded
- `{{.previous.failed}}` - Whether the last step failed
- `{{.loop_entry}}` - State snapshot before loop started

## Merge Steps

Merge steps commit worktree changes and merge them to main.

```yaml
- name: merge-changes
  type: merge
  require_review: true  # true (default) | false
  timeout: 5m
```

### Review Modes

**With Review (`require_review: true`):**
- Workflow pauses at `pending_merge` status
- User approves/rejects via API or UI
- Approving merges changes and continues workflow
- Rejecting blocks the workflow

**Auto-merge (`require_review: false`):**
- Changes are committed and merged automatically
- Workflow continues without pausing

### Merge API

```bash
# Approve merge (returns conflict info if any)
POST /workflows/{id}/approve-merge

# Reject merge
POST /workflows/{id}/reject-merge
```

## Spells (Prompt Templates)

Spells are Go templates that render into agent prompts.

### File-based Spells

Create `.coven/spells/implement.md`:

```markdown
# Task: {{.bead.title}}

## Description
{{.bead.body}}

## Requirements
- Implement the feature in the worktree
- Follow existing code patterns
- Add appropriate tests

{{if .previous}}
## Previous Step Result
{{.previous.output}}
{{end}}

## Output Format
Return a JSON block:
{"success": true, "summary": "...", "outputs": {...}}
```

### Inline Spells

You can also define spells inline in the grimoire:

```yaml
- name: implement
  type: agent
  spell: |
    Implement feature: {{.bead.title}}
    Return: {"success": true, "summary": "Done"}
```

### Template Variables

| Variable | Description |
|----------|-------------|
| `{{.bead}}` | Full bead object |
| `{{.bead.id}}` | Bead ID |
| `{{.bead.title}}` | Bead title |
| `{{.bead.body}}` | Bead description |
| `{{.bead.type}}` | Bead type (feature, bug, task) |
| `{{.bead.priority}}` | Bead priority |
| `{{.bead.labels}}` | Bead labels array |
| `{{.step_name}}` | Output from named step |
| `{{.step_name.output}}` | Raw output string |
| `{{.step_name.outputs.key}}` | Parsed JSON field |
| `{{.previous.success}}` | Previous step succeeded |
| `{{.previous.failed}}` | Previous step failed |
| `{{.previous.output}}` | Previous step output |

### Template Functions

| Function | Example | Description |
|----------|---------|-------------|
| `default` | `{{default "N/A" .value}}` | Default if empty |
| `join` | `{{join ", " .items}}` | Join array elements |
| `upper` | `{{upper .text}}` | Uppercase |
| `lower` | `{{lower .text}}` | Lowercase |
| `trim` | `{{trim .text}}` | Trim whitespace |
| `indent` | `{{indent 4 .text}}` | Indent lines |
| `quote` | `{{quote .text}}` | Quote string |

### Spell Partials (Includes)

Include other spells with variable passing:

```markdown
{{include "common-rules.md" context=.bead}}
```

## Grimoire Selection

When a bead is picked up, the daemon selects a grimoire using this priority:

1. **Explicit label**: `grimoire:workflow-name` label on the bead
2. **Type mapping**: Configured in `.coven/grimoire-mapping.json`
3. **Default**: From config or built-in `implement-bead`

### Grimoire Mapping Config

Create `.coven/grimoire-mapping.json`:

```json
{
  "default": "implement-bead",
  "by_type": {
    "feature": "implement-feature",
    "bug": "bugfix-workflow",
    "task": "implement-bead"
  }
}
```

### Using Labels

```bash
bd create --title="Add auth" --type=feature --label=grimoire:strict-implement
```

## Conditional Execution

Steps can have `when` conditions:

```yaml
- name: fix-failures
  type: agent
  spell: fix-tests
  when: "{{.previous.failed}}"
```

Conditions must evaluate to a boolean. Non-boolean values cause an error.

Common patterns:
- `when: "{{.previous.failed}}"` - Run if previous step failed
- `when: "{{.previous.success}}"` - Run if previous step succeeded
- `when: "{{not .previous.success}}"` - Negate a condition

## Timeouts

| Scope | Default | Config |
|-------|---------|--------|
| Workflow | 1 hour | `timeout` on grimoire |
| Agent step | 15 minutes | `timeout` on step |
| Script step | 5 minutes | `timeout` on step |

Format: Go duration strings (`15m`, `2h`, `30s`)

## Workflow State & Resume

Workflow state is persisted after each step to `.coven/state/workflows/`. If the daemon restarts, workflows resume from the last completed step.

## Logging

Execution logs are written as JSONL to `.coven/logs/workflows/{workflow-id}.jsonl`:

```jsonl
{"event":"workflow_start","workflow_id":"abc123","grimoire":"implement-feature"}
{"event":"step_start","step":"implement","type":"agent"}
{"event":"step_end","step":"implement","success":true,"duration":"45s"}
{"event":"workflow_end","status":"completed"}
```

## Workflow API

| Endpoint | Description |
|----------|-------------|
| `GET /workflows` | List active/blocked workflows |
| `GET /workflows/{id}` | Get workflow state |
| `POST /workflows/{id}/cancel` | Cancel workflow |
| `POST /workflows/{id}/approve-merge` | Approve pending merge |
| `POST /workflows/{id}/reject-merge` | Reject merge |
| `POST /workflows/{id}/retry` | Retry blocked workflow |
| `GET /workflows/{id}/log` | Get execution log |

## Example: Implement-Test-Fix Pattern

A common pattern that implements, tests, and iterates on failures:

```yaml
name: implement-with-tests
description: Implement feature with test verification
timeout: 2h

steps:
  - name: implement
    type: agent
    spell: implement
    input:
      bead: "{{.bead}}"
    timeout: 20m

  - name: test-loop
    type: loop
    max_iterations: 3
    on_max_iterations: block
    steps:
      - name: run-tests
        type: script
        command: "npm test"
        on_fail: continue
        timeout: 5m

      - name: fix-tests
        type: agent
        spell: fix-tests
        when: "{{.previous.failed}}"
        input:
          bead: "{{.bead}}"
          test_output: "{{.run-tests.output}}"
        timeout: 15m

      - name: verify
        type: script
        command: "npm test"
        on_success: exit_loop
        timeout: 5m

  - name: merge
    type: merge
    require_review: false
```

## Example: Multi-Stage Review

A workflow with multiple checkpoints:

```yaml
name: reviewed-implementation
description: Implementation with staged reviews
timeout: 3h

steps:
  - name: implement
    type: agent
    spell: implement
    timeout: 30m

  - name: checkpoint-1
    type: merge
    require_review: true

  - name: add-tests
    type: agent
    spell: add-tests
    timeout: 20m

  - name: run-tests
    type: script
    command: "npm test"
    timeout: 10m

  - name: final-merge
    type: merge
    require_review: true
```

## Troubleshooting

### Workflow stuck at blocked

Check the workflow status:
```bash
curl http://localhost:8080/workflows/{id}
```

Common causes:
- Loop hit max_iterations with `on_max_iterations: block`
- Merge step waiting for review
- Step failed with default `on_fail: block`

### Agent output not parsed

Ensure the agent outputs valid JSON with the required schema:
```json
{"success": true, "summary": "...", "outputs": {...}}
```

### Spell template errors

Check that:
- All referenced variables exist in context
- Template syntax is valid Go templates
- Spell file exists in `.coven/spells/`

### Resume after daemon restart

Workflows automatically resume. Check state files:
```bash
ls .coven/state/workflows/
```
