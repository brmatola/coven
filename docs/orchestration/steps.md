# Step Types

Coven supports four step types: agent, script, loop, and merge. This guide covers each in detail.

## Common Fields

All step types share these fields:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | **Yes** | Unique identifier within the grimoire. Used to reference outputs. |
| `type` | **Yes** | One of: `agent`, `script`, `loop`, `merge` |
| `when` | No | Condition for execution. If false, step is skipped. |
| `timeout` | No | Max execution time. Format: Go duration (e.g., `5m`, `1h`) |

### The `when` Condition

Any step can have a conditional:

```yaml
- name: fix-failures
  type: agent
  spell: fix-tests
  when: "{{.previous.failed}}"
```

Common patterns:

```yaml
when: "{{.previous.failed}}"          # Previous step failed
when: "{{.previous.success}}"         # Previous step succeeded
when: "{{not .previous.success}}"     # Negate
when: "{{gt .loop_name.iteration 1}}" # After first iteration
when: "{{eq .task.type \"bug\"}}"     # Task type check
```

**Error on non-boolean:**
```
step "fix-failures" condition error: expected boolean, got string
```

### Referencing Step Outputs

Reference any previous step by name:

```yaml
- name: analyze
  type: agent
  spell: analyze

- name: implement
  type: agent
  spell: implement
  input:
    analysis: "{{.analyze.outputs.findings}}"  # Use analyze step's output
```

---

## Agent Steps

Agent steps invoke Claude with a rendered prompt (spell).

```yaml
- name: implement
  type: agent
  spell: implement           # Spell name or inline content
  input:                     # Variables passed to spell
    task: "{{.task}}"
    context: "Additional info"
  timeout: 15m
```

### Agent Step Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `spell` | **Yes** | — | Spell name (loads `.coven/spells/{name}.md`) or inline YAML string |
| `input` | No | — | Variables merged into spell template context |
| `timeout` | No | `15m` | Max execution time |
| `when` | No | — | Condition for execution |
| `on_fail` | No | `block` | Action on failure: `continue` or `block` |
| `on_success` | No | — | Action on success: `exit_loop` (only in loops) |

### Agent Output Format

**Critical:** Agents must return a JSON block at the end of their output:

```json
{
  "success": true,
  "summary": "Implemented user authentication",
  "outputs": {
    "files_changed": ["src/auth.ts", "src/login.tsx"],
    "tests_added": 3
  }
}
```

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `success` | **Yes** | boolean | `true` if completed successfully |
| `summary` | No | string | Human-readable summary |
| `outputs` | No | object | Structured data for subsequent steps |
| `error` | No | string | Error message when `success: false` |

**Accessing outputs in subsequent steps:**

```yaml
{{.implement.outputs.files_changed}}  # ["src/auth.ts", "src/login.tsx"]
{{.implement.outputs.tests_added}}    # 3
{{.implement.summary}}                # "Implemented user authentication"
```

### What If Agent Doesn't Return JSON?

The step fails:

```
step "implement" failed: agent output did not contain valid JSON block
```

The workflow blocks (or continues if `on_fail: continue`).

**Always include JSON instructions in your spell:**

```yaml
spell: |
  Do the thing.

  When done, return:
  ```json
  {"success": true, "summary": "What you did"}
  ```
```

### Agent Step Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `agent output did not contain valid JSON block` | No JSON or invalid syntax | Add JSON instructions to spell |
| `agent output missing required "success" field` | JSON found but no `success` | Add `"success": true/false` |
| `agent timed out after 15m` | Took too long | Increase `timeout` or simplify |
| `spell file not found` | Name doesn't match file | Check `.coven/spells/` |
| `failed to render spell template` | Template syntax error | See [Spells](spells.md) |

---

## Script Steps

Script steps execute shell commands in the worktree.

```yaml
- name: run-tests
  type: script
  command: "npm test"
  timeout: 5m
  on_fail: continue
  on_success: exit_loop
```

### Script Step Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `command` | **Yes** | — | Shell command to execute |
| `timeout` | No | `5m` | Max execution time |
| `on_fail` | No | `block` | Action on failure: `continue` or `block` |
| `on_success` | No | — | Action on success: `exit_loop` (only in loops) |
| `when` | No | — | Condition for execution |
| `env` | No | — | Environment variables (map of key-value pairs) |
| `workdir` | No | worktree root | Working directory for command |

### Environment Variables

```yaml
- name: deploy
  type: script
  command: "./deploy.sh"
  env:
    NODE_ENV: production
    API_KEY: "{{.secrets.api_key}}"
```

### Script Output

Script output is captured as text:

```yaml
{{.step_name.output}}     # Full stdout/stderr
{{.step_name.exit_code}}  # Exit code (0 = success)
{{.step_name.status}}     # "success" or "failed"
```

**Success vs. failure:** Exit code 0 = success, anything else = failure.

### Failure Handling

| Setting | Behavior |
|---------|----------|
| `on_fail: block` (default) | Workflow stops, status becomes `blocked` |
| `on_fail: continue` | Workflow continues, `{{.previous.failed}}` becomes `true` |

**Common pattern—let agent fix failures:**

```yaml
- name: run-tests
  type: script
  command: "npm test"
  on_fail: continue

- name: fix-tests
  type: agent
  spell: fix-tests
  when: "{{.previous.failed}}"
```

### Exit Loop on Success

Inside loops, `on_success: exit_loop` exits when the script succeeds:

```yaml
- name: test-loop
  type: loop
  max_iterations: 3
  steps:
    - name: run-tests
      type: script
      command: "npm test"
      on_success: exit_loop  # Tests pass → exit loop
      on_fail: continue

    - name: fix
      type: agent
      spell: fix-tests
      when: "{{.previous.failed}}"
```

### Script Step Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `script timed out after 5m` | Command too slow | Increase `timeout` |
| `command not found: xyz` | Missing in PATH | Install tool or fix command |
| `exit code 1` | Command failed | Check output, fix issue |

---

## Loop Steps

Loop steps repeat nested steps until a condition is met or max iterations reached.

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

### Loop Step Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `steps` | **Yes** | — | Nested steps to repeat |
| `max_iterations` | No | `10` | Maximum loop iterations |
| `on_max_iterations` | No | `block` | Action when max reached: `block` or `continue` |

### How Loops Work

1. Execute nested steps in order
2. If any step has `on_success: exit_loop` and succeeds → exit loop
3. Otherwise, increment iteration and repeat from step 1
4. If `max_iterations` reached → take `on_max_iterations` action

### Exit Conditions

Loops exit when:
- A step with `on_success: exit_loop` succeeds
- `max_iterations` is reached

**Important:** If no step has `on_success: exit_loop`, the loop **always** runs until `max_iterations`. This is rarely what you want.

### Max Iterations Actions

| Action | Behavior | When to Use |
|--------|----------|-------------|
| `block` (default) | Workflow blocks for intervention | Something is wrong—needs human help |
| `continue` | Exit loop, continue workflow | Acceptable to give up after N tries |

### Loop Context Variables

Inside loops, special variables are available:

| Variable | Description |
|----------|-------------|
| `{{.loop_name.iteration}}` | Current iteration (1-indexed) |
| `{{.loop_entry}}` | State snapshot before loop started |
| `{{.previous.success}}` | Previous step in this iteration succeeded |
| `{{.previous.failed}}` | Previous step in this iteration failed |

**The `{{.loop_entry}}` variable** preserves context from before the loop:

```yaml
- name: initial-analysis
  type: agent
  spell: analyze

- name: refinement-loop
  type: loop
  max_iterations: 3
  steps:
    - name: refine
      type: agent
      spell: |
        Original analysis: {{.loop_entry.initial-analysis.outputs}}
        Iteration: {{.refinement-loop.iteration}}
```

### Common Loop Patterns

**Test-fix loop:**

```yaml
- name: test-fix-loop
  type: loop
  max_iterations: 3
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

**Adversarial refinement:**

```yaml
- name: refinement-loop
  type: loop
  max_iterations: 3
  steps:
    - name: refine
      type: agent
      spell: refine-work

    - name: critique
      type: agent
      spell: critique-work

    - name: evaluate
      type: agent
      spell: evaluate-critique
      on_success: exit_loop  # Work is good → done
      on_fail: continue      # Needs improvement → loop
```

**Retry with backoff:**

```yaml
- name: deploy-loop
  type: loop
  max_iterations: 3
  on_max_iterations: block
  steps:
    - name: deploy
      type: script
      command: "./deploy.sh"
      on_success: exit_loop
      on_fail: continue

    - name: wait
      type: script
      command: "sleep $(({{.deploy-loop.iteration}} * 30))"
      when: "{{.previous.failed}}"
```

### Loop Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `loop "X" reached max iterations (N)` | No exit triggered | Increase max or fix underlying issue |
| `loop has no steps` | Empty `steps` array | Add at least one step |

---

## Merge Steps

Merge steps commit worktree changes and merge to the session's target branch.

```yaml
- name: merge
  type: merge
  require_review: true
```

### Merge Step Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `require_review` | No | `true` | Pause for human review before merging |
| `timeout` | No | `5m` | Max time for merge operation |
| `commit_message` | No | auto-generated | Custom commit message template |

### Why Merge Steps?

1. **Human checkpoints:** Review changes before they land on your branch
2. **Workflow segmentation:** Break long workflows into reviewable chunks

Without merge steps, changes stay in the worktree forever.

### Review Mode (`require_review: true`)

The default. When reached:

1. Workflow pauses at `pending_merge` status
2. You're notified that changes are ready
3. In VS Code: click **Review** on the task
4. Review the diff, summary, and checks
5. Click **Approve** to merge or **Reject** to discard

**Available actions:**
- **Approve** — Merge changes, continue workflow (if more steps)
- **Reject** — Block workflow, discard changes
- **Open Worktree** — Inspect in new VS Code window

### Auto-Merge Mode (`require_review: false`)

When review is not required:

1. Changes are committed automatically
2. Worktree merges to target branch
3. Workflow continues without pausing

**When to use:**
- Automated pipelines you trust
- Non-critical changes (formatting, generated code)
- Internal checkpoints before a final reviewed merge

### Custom Commit Messages

```yaml
- name: merge
  type: merge
  commit_message: |
    {{.task.type}}: {{.task.title}}

    {{.implement.summary}}

    Task-ID: {{.task.id}}
```

### Multiple Merge Steps

Use multiple merges for staged review:

```yaml
- name: design
  type: agent
  spell: draft-design

- name: design-review
  type: merge
  require_review: true  # Review design first

- name: implement
  type: agent
  spell: implement-design

- name: final-review
  type: merge
  require_review: true  # Review implementation
```

After `design-review` approval, changes merge to target. The workflow continues in the same worktree, now including the merged design.

### Merge Conflicts

When target branch has diverged:

1. Merge step detects conflicts
2. Workflow blocks with `conflicts` status
3. You see which files conflict

**Resolution:**
1. Click **Open Worktree** in review panel
2. Resolve conflicts in the new VS Code window
3. Stage and commit resolution
4. Return to review panel
5. Click **Retry Merge**

**Alternative:** Click **Rebase** to update worktree to latest target, then retry.

### Merge Step Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `merge conflicts detected` | Target branch diverged | Resolve conflicts or rebase |
| `worktree has uncommitted changes` | Agent left dirty state | Check agent output |
| `target branch not found` | Branch was deleted | Restart session with valid branch |
| `nothing to merge` | No changes in worktree | Check agent output |

---

## Step Execution Order

Steps execute sequentially within a grimoire:

```yaml
steps:
  - name: step-1  # Runs first
    type: agent

  - name: step-2  # Runs after step-1 completes
    type: script

  - name: step-3  # Runs after step-2 completes
    type: merge
```

**Within loops**, steps execute sequentially per iteration:

```yaml
- name: loop
  type: loop
  max_iterations: 3
  steps:
    - name: a  # Iteration 1: a, b, c
    - name: b  # Iteration 2: a, b, c
    - name: c  # Iteration 3: a, b, c (unless exit_loop)
```

## Parallel Steps (Future)

**Note:** Parallel step execution is planned but not yet implemented. Currently all steps run sequentially.

```yaml
# Future syntax (not yet supported)
- name: parallel-checks
  type: parallel
  steps:
    - name: lint
      type: script
      command: "npm run lint"

    - name: typecheck
      type: script
      command: "npm run typecheck"

    - name: test
      type: script
      command: "npm test"
```
