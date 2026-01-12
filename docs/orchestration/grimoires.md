# Grimoires

A grimoire is a YAML file that defines a workflow as a sequence of steps. This guide covers grimoire structure, validation, selection, and best practices.

## Basic Structure

```yaml
name: implement-feature
description: Implement a feature end-to-end
timeout: 2h

steps:
  - name: implement
    type: agent
    spell: implement
    timeout: 20m

  - name: run-tests
    type: script
    command: "npm test"
    timeout: 5m

  - name: merge
    type: merge
    require_review: true
```

## Grimoire Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | **Yes** | — | Unique identifier. Used in `grimoire:name` labels. |
| `description` | No | — | Human-readable description. Shows in UI. |
| `timeout` | No | `1h` | Max total workflow duration. |
| `steps` | **Yes** | — | Array of steps to execute in order. |

## File Location

Place grimoires in `.coven/grimoires/`:

```
.coven/
└── grimoires/
    ├── implement.yaml
    ├── bugfix.yaml
    └── reviewed-implementation.yaml
```

Coven loads all `.yaml` files from this directory when the daemon starts.

## Grimoire Selection

When a task starts, the daemon selects a grimoire using a matcher pipeline:

### 1. Explicit Tag (Highest Priority)

Tag a task with `grimoire:workflow-name`:

```bash
# Via CLI
coven task create --title="Add auth" --tags="grimoire:implement"

# In VS Code: open task details → Tags → Add Tag
```

### 2. Matcher Rules

Create `.coven/grimoire-matchers.yaml` for flexible routing:

```yaml
matchers:
  # Match tasks with security-related tags
  - grimoire: security-audit
    any_tags: ["security", "auth*", "crypto*"]

  # Match high-priority bugs
  - grimoire: urgent-bugfix
    any_tags: ["bug"]
    priority: [0, 1]

  # Match features needing tests
  - grimoire: implement-with-tests
    all_tags: ["feature", "needs-tests"]

# Fallback when no matcher applies
default: implement
```

**Matcher semantics:**
- `any_tags`: OR — matches if task has ANY of these tags (glob patterns supported)
- `all_tags`: AND — matches only if task has ALL of these tags
- `not_tags`: VETO — skips matcher if task has ANY of these tags
- `priority`: List `[0, 1]` or range `priority_range: [1, 3]`
- First matching rule wins

### 3. Built-in Default (Lowest Priority)

If no grimoire is configured, Coven uses:

```yaml
name: default
steps:
  - name: implement
    type: agent
    spell: |
      Task: {{.task.title}}
      {{.task.body}}
      Return: {"success": true, "summary": "Done"}

  - name: merge
    type: merge
```

This is fine for simple tasks. Create custom grimoires for anything with verification.

## Step Types

| Type | Purpose | Documentation |
|------|---------|---------------|
| `agent` | Run Claude with a prompt | [Agent Steps](#agent-steps) |
| `script` | Run a shell command | [Script Steps](#script-steps) |
| `loop` | Repeat steps until condition | [Loop Steps](#loop-steps) |
| `merge` | Merge to target branch | [Merge Steps](#merge-steps) |

See [Steps](steps.md) for complete documentation of each type.

## Conditional Execution

Any step can have a `when` condition:

```yaml
steps:
  - name: run-tests
    type: script
    command: "npm test"
    on_fail: continue

  - name: fix-failures
    type: agent
    spell: fix-tests
    when: "{{.previous.failed}}"  # Only runs if tests failed
```

### Condition Syntax

Conditions use Go template syntax and must evaluate to a boolean:

```yaml
# Previous step status
when: "{{.previous.failed}}"     # Previous step failed
when: "{{.previous.success}}"    # Previous step succeeded
when: "{{not .previous.success}}" # Negate

# Step-specific status
when: "{{.run-tests.exit_code}}"  # Non-zero = truthy
when: "{{eq .task.type \"bug\"}}" # Task type check

# Loop iteration
when: "{{gt .test-loop.iteration 1}}"  # After first iteration
```

**Error if not boolean:**
```
step "fix-failures" condition error: expected boolean, got string
```

## Timeouts

Set timeouts at three levels:

| Scope | Default | Example |
|-------|---------|---------|
| Workflow | `1h` | `timeout: 4h` at grimoire level |
| Agent step | `15m` | `timeout: 30m` on step |
| Script step | `5m` | `timeout: 10m` on step |

**Format:** Go duration strings — `15m`, `2h`, `30s`, `1h30m`

```yaml
name: long-running
timeout: 4h  # Workflow-level

steps:
  - name: big-refactor
    type: agent
    spell: refactor
    timeout: 1h  # Override default 15m

  - name: quick-test
    type: script
    command: "npm test"
    timeout: 10m  # Override default 5m
```

**What happens on timeout:**
- Step timeout → Step fails, workflow blocks (unless `on_fail: continue`)
- Workflow timeout → Entire workflow fails

## Validation

Grimoires are validated when the daemon starts. Invalid grimoires log an error and are unavailable.

### Validation Rules

| Rule | Error Message |
|------|---------------|
| Missing `name` | `grimoire validation failed: name is required` |
| Empty `steps` | `grimoire validation failed: steps cannot be empty` |
| Duplicate step names | `grimoire validation failed: duplicate step name "X"` |
| Invalid step type | `grimoire validation failed: unknown step type "X"` |
| Invalid timeout format | `grimoire validation failed: invalid timeout "X"` |
| Agent without spell | `grimoire validation failed: agent step "X" requires spell` |
| Script without command | `grimoire validation failed: script step "X" requires command` |
| Loop without steps | `grimoire validation failed: loop step "X" requires steps` |
| YAML syntax error | `grimoire validation failed: yaml: line X: ...` |

### Example Error

```
2024-01-15T10:30:00 ERROR failed to load grimoire
  file=.coven/grimoires/broken.yaml
  error="grimoire validation failed: agent step \"implement\" requires spell"
```

### Validate Before Use

Check daemon logs on startup:

```bash
# View daemon logs
tail -f .coven/logs/daemon.log | grep -i "validation\|error"

# Or via VS Code
Coven: View Daemon Logs
```

### Schema Validation (IDE Support)

For VS Code IntelliSense with the YAML extension, add to `.vscode/settings.json`:

```json
{
  "yaml.schemas": {
    "https://raw.githubusercontent.com/anthropics/coven/main/schemas/grimoire-schema.json": ".coven/grimoires/*.yaml"
  }
}
```

This enables autocomplete and validation for grimoire YAML files.

## Complete Example

A full-featured grimoire with all common patterns:

```yaml
name: implement-with-verification
description: Implement with tests, lint, and human review
timeout: 2h

steps:
  # Step 1: Agent implements
  - name: implement
    type: agent
    spell: implement
    input:
      task: "{{.task}}"
    timeout: 30m

  # Step 2: Test-fix loop
  - name: test-loop
    type: loop
    max_iterations: 3
    on_max_iterations: block
    steps:
      - name: run-tests
        type: script
        command: "npm test"
        on_fail: continue
        on_success: exit_loop
        timeout: 5m

      - name: fix-tests
        type: agent
        spell: fix-tests
        input:
          test_output: "{{.run-tests.output}}"
        when: "{{.previous.failed}}"
        timeout: 15m

  # Step 3: Quality checks
  - name: lint
    type: script
    command: "npm run lint"
    timeout: 2m

  - name: typecheck
    type: script
    command: "npm run typecheck"
    timeout: 2m

  # Step 4: Human review
  - name: merge
    type: merge
    require_review: true
```

## Best Practices

### 1. Start Simple

Begin with one agent and one merge. Add complexity only when needed.

```yaml
# Good starting point
steps:
  - name: implement
    type: agent
    spell: implement

  - name: merge
    type: merge
```

### 2. Set Realistic Timeouts

Agent steps often need 15-30 minutes. Scripts usually 5 minutes or less. Don't set them too tight—but don't leave them at defaults for long-running operations.

### 3. Use `on_fail: continue` for Fixable Failures

Let agents fix test failures instead of blocking immediately:

```yaml
- name: run-tests
  type: script
  command: "npm test"
  on_fail: continue  # Don't block

- name: fix-tests
  type: agent
  spell: fix-tests
  when: "{{.previous.failed}}"
```

### 4. Always Include a Merge Step

Without it, changes stay in the worktree forever.

### 5. Use `require_review: true` Until Trusted

Start with human review. Switch to auto-merge only after your workflow proves reliable.

### 6. Name Steps Descriptively

You'll reference them in templates:

```yaml
# Good
{{.implement.outputs.files}}

# Bad
{{.step1.outputs.files}}
```

### 7. Pass Context Forward

Use `input` to give agents information from previous steps:

```yaml
- name: fix-tests
  type: agent
  spell: fix-tests
  input:
    task: "{{.task}}"
    test_output: "{{.run-tests.output}}"
    previous_attempt: "{{.fix-tests.summary}}"
```

### 8. Use Loops for Retry Patterns

Wrap flaky operations in loops with `max_iterations`:

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
      command: "sleep 30"
      when: "{{.previous.failed}}"
```

## Debugging Grimoires

### Check Logs

```bash
# Workflow execution logs
cat .coven/logs/workflows/{workflow-id}.jsonl

# Daemon logs
tail -f .coven/logs/daemon.log
```

### Check State

```bash
# Current workflow state
cat .coven/state/workflows/{workflow-id}.json
```

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Grimoire not found | Typo in label or file name | Check `.coven/grimoires/` directory |
| Step skipped unexpectedly | `when` condition is false | Check template variables |
| Loop runs forever | No `on_success: exit_loop` | Add exit condition |
| Workflow blocks immediately | Step fails without `on_fail: continue` | Add failure handling |
