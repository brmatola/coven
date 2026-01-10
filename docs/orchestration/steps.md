# Step Types

Coven supports four step types: agent, script, loop, and merge.

## Agent Steps

Agent steps invoke an AI agent with a rendered spell (prompt).

```yaml
- name: implement
  type: agent
  spell: implement           # Spell name or inline content
  input:                     # Variables passed to spell template
    bead: "{{.bead}}"
    context: "Additional context"
  output: implementation     # Store result under this alias
  timeout: 15m               # Default: 15m
  when: "{{.previous.success}}"  # Optional condition
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `spell` | Yes | Spell name (from `.coven/spells/`) or inline content |
| `input` | No | Variables to pass to the spell template |
| `output` | No | Alias for storing the result |
| `timeout` | No | Max execution time (default: 15m) |
| `when` | No | Condition for execution |

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

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the agent completed successfully |
| `summary` | string | Human-readable summary of work done |
| `outputs` | object | Structured data for subsequent steps |
| `error` | string | Error message if `success` is false |

The `outputs` object becomes available as `{{.step_name.outputs.key}}` in subsequent steps.

---

## Script Steps

Script steps execute shell commands in the worktree.

```yaml
- name: run-tests
  type: script
  command: "npm test"
  timeout: 5m          # Default: 5m
  on_fail: continue    # continue | block
  on_success: exit_loop  # Only valid inside loops
  when: "{{.previous.success}}"
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `command` | Yes | Shell command to execute |
| `timeout` | No | Max execution time (default: 5m) |
| `on_fail` | No | Action on failure: `continue` or `block` (default) |
| `on_success` | No | Action on success: `exit_loop` (only in loops) |
| `when` | No | Condition for execution |

### Failure Handling

- `on_fail: block` (default) - Block workflow immediately
- `on_fail: continue` - Continue workflow, `{{.previous.failed}}` becomes `true`

### Exit Loop

Inside a loop, `on_success: exit_loop` exits the loop when the script succeeds:

```yaml
- name: verify
  type: script
  command: "npm test"
  on_success: exit_loop
```

---

## Loop Steps

Loop steps repeat nested steps until a condition is met or max iterations is reached.

```yaml
- name: test-fix-loop
  type: loop
  max_iterations: 5
  on_max_iterations: block
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

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `steps` | Yes | Nested steps to repeat |
| `max_iterations` | No | Maximum loop iterations |
| `on_max_iterations` | No | Action when max reached: `block`, `exit`, `continue` |

### Exit Conditions

Loops exit when:
- A step sets `on_success: exit_loop` and succeeds
- `max_iterations` is reached

### Max Iterations Actions

| Action | Behavior |
|--------|----------|
| `block` | Block workflow for manual intervention |
| `exit` | Exit loop and continue workflow |
| `continue` | Same as `exit` |

### Loop Context Variables

Inside loops, special variables are available:

| Variable | Description |
|----------|-------------|
| `{{.previous.success}}` | Whether last step in iteration succeeded |
| `{{.previous.failed}}` | Whether last step in iteration failed |
| `{{.previous.output}}` | Output from last step |
| `{{.loop_entry}}` | State snapshot before loop started |

The `{{.loop_entry}}` variable preserves context from before the loop, useful when you need to reference the original state across iterations.

---

## Merge Steps

Merge steps commit worktree changes and merge them to main.

```yaml
- name: merge-changes
  type: merge
  require_review: true  # true (default) | false
  timeout: 5m
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `require_review` | No | Whether to pause for human review (default: true) |
| `timeout` | No | Max time for merge operation |

### Review Mode (`require_review: true`)

When review is required (the default):

1. Workflow pauses at `pending_merge` status
2. Bead status becomes `blocked`
3. User reviews changes via API or UI
4. Approving merges changes and continues workflow
5. Rejecting blocks the workflow

Available actions when pending:
- `approve-merge` - Merge and continue
- `reject-merge` - Block workflow

### Auto-merge Mode (`require_review: false`)

When review is not required:

1. Changes are committed automatically
2. Worktree is merged to main
3. Workflow continues without pausing

### Conflict Detection

When approving a merge, conflicts with main are detected:

```bash
POST /workflows/{id}/approve-merge
```

Response if conflicts exist:
```json
{
  "status": "conflicts",
  "hasConflicts": true,
  "conflictFiles": ["src/auth.ts", "src/config.ts"]
}
```

The workflow remains blocked until conflicts are resolved.
