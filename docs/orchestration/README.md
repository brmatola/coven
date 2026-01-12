# Workflow Orchestration

Coven's daemon (`covend`) orchestrates AI agent workflows. An **AI agent** is Claude (via the [Claude CLI](https://github.com/anthropics/claude-code)) executing prompts in your codebase. This guide explains how to write grimoires (workflow definitions) and spells (prompt templates) to automate multi-step agent tasks.

## Why Orchestration?

A single agent prompt gives you output that "looks right" but hasn't been verified:

```
"Implement user authentication"
```

Claude might miss edge cases, write code that doesn't compile, or skip tests entirely. You won't know until you manually check.

**Orchestration encodes verification:**

```yaml
steps:
  - name: implement
    type: agent
    spell: implement-auth

  - name: test-loop
    type: loop
    max_iterations: 3
    steps:
      - name: run-tests
        type: script
        command: "npm test"
        on_success: exit_loop
        on_fail: continue

      - name: fix-tests
        type: agent
        spell: fix-test-failures
        when: "{{.previous.failed}}"

  - name: merge
    type: merge
    require_review: true
```

Now the agent's work is verified by real tests, failures trigger automatic fix attempts, and you review before anything merges.

## How It Works

When you start a task:

```
┌─────────────────────────────────────────────────────────────────┐
│  1. SELECT GRIMOIRE                                             │
│     • By label: task has `grimoire:my-workflow`                 │
│     • By type: `.coven/grimoire-mapping.json` maps task types   │
│     • Default: built-in implement + merge                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  2. CREATE WORKTREE                                             │
│     • Isolated git working directory                            │
│     • Located at `.coven/worktrees/{task-id}/`                  │
│     • Your main directory stays clean                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  3. EXECUTE STEPS                                               │
│     • Agent steps: Claude receives rendered spell               │
│     • Script steps: Shell command runs in worktree              │
│     • Loop steps: Repeat until exit condition                   │
│     • Merge steps: Pause for review, then merge                 │
│                                                                 │
│     State saved after each step (crash-safe)                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  4. REVIEW & MERGE                                              │
│     • You review the diff in VS Code                            │
│     • Approve → changes merge to session target branch          │
│     • Reject → worktree deleted, task returns to Ready          │
└─────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
.coven/
├── grimoires/              # YOUR workflow definitions
│   ├── implement.yaml
│   └── bugfix.yaml
├── spells/                 # YOUR prompt templates
│   ├── implement.md
│   └── fix-tests.md
├── grimoire-matchers.yaml  # YOUR tag-to-grimoire routing (optional)
├── covend.sock             # AUTO: Daemon Unix socket
├── tasks.db                # AUTO: Task database (bbolt)
├── logs/workflows/         # AUTO: Execution logs (JSONL)
├── state/workflows/        # AUTO: Workflow state for resume
└── worktrees/              # AUTO: Git worktrees per task
```

**You create:** `grimoires/`, `spells/`, optionally `grimoire-matchers.yaml`
**Coven creates:** Everything else (on session start)

## Quick Start

### 1. Create a Grimoire

```bash
mkdir -p .coven/grimoires
```

Create `.coven/grimoires/implement.yaml`:

```yaml
name: implement
description: Implement a feature with test verification

steps:
  - name: implement
    type: agent
    spell: |
      # Task: {{.task.title}}

      {{.task.body}}

      Implement this feature. Return:
      ```json
      {"success": true, "summary": "What you implemented"}
      ```
    timeout: 20m

  - name: verify
    type: script
    command: "npm test"
    timeout: 5m

  - name: merge
    type: merge
    require_review: true
```

### 2. Assign to a Task

Add the tag `grimoire:implement` to any task:

- **VS Code:** Click task → Tags section → Add Tag → `grimoire:implement`
- **CLI:** `coven task create --title="Add feature" --tags="grimoire:implement"`

### 3. Start the Task

Via VS Code sidebar or `coven task claim <id>`. The workflow executes automatically.

## Grimoire Selection Priority

When a task starts, Coven selects a grimoire using a matcher pipeline:

1. **Explicit tag** — Task has `grimoire:workflow-name` tag → uses that grimoire
2. **Matcher rules** — `.coven/grimoire-matchers.yaml` defines tag/priority/content-based routing
3. **Default** — Built-in grimoire (implement + merge)

### Grimoire Matchers

Create `.coven/grimoire-matchers.yaml` for flexible routing:

```yaml
matchers:
  # Match tasks with security-related tags
  - grimoire: security-audit
    any_tags: ["security", "auth*", "crypto*"]  # Glob patterns supported

  # Match high-priority bugs
  - grimoire: urgent-bugfix
    any_tags: ["bug"]
    priority: [0, 1]  # P0 or P1 only

  # Match features with test requirements
  - grimoire: implement-with-tests
    all_tags: ["feature", "needs-tests"]  # Must have BOTH tags

  # Exclude experimental work from CI
  - grimoire: simple
    any_tags: ["task"]
    not_tags: ["experimental"]  # Veto if this tag present

# Fallback when no matcher applies
default: implement
```

**Matcher semantics:**
- `any_tags`: OR — matches if task has ANY of these tags (glob patterns supported)
- `all_tags`: AND — matches only if task has ALL of these tags
- `not_tags`: VETO — skips this matcher if task has ANY of these tags
- `priority`: List of priority levels (0-4) or use `priority_range: [1, 3]` for ranges
- First matching rule wins (matchers evaluated in order)

### Default Grimoire

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

Fine for simple tasks. Create custom grimoires for verification loops.

## Step Types Overview

| Type | Purpose | When to Use |
|------|---------|-------------|
| `agent` | Run Claude with a prompt | Implementation, fixes, analysis |
| `script` | Run a shell command | Tests, linting, builds, deploys |
| `loop` | Repeat steps until condition | Test-fix cycles, refinement |
| `merge` | Merge to target branch | Human checkpoints, final merge |

See [Steps](steps.md) for complete documentation.

## Timeouts

| Scope | Default | Override |
|-------|---------|----------|
| Workflow | 1h | `timeout: 4h` at grimoire level |
| Agent step | 15m | `timeout: 30m` on step |
| Script step | 5m | `timeout: 10m` on step |

**Format:** Go duration strings — `15m`, `2h`, `30s`, `1h30m`

**What happens on timeout:**
- Step timeout → Step fails, workflow blocks (unless `on_fail: continue`)
- Workflow timeout → Entire workflow fails

## State & Resume

Workflow state is saved after each step to `.coven/state/workflows/{workflow-id}.json`:

```json
{
  "workflow_id": "abc123",
  "grimoire": "implement",
  "current_step": 2,
  "step_outputs": {
    "implement": {"success": true, "summary": "Added auth endpoint"}
  },
  "started_at": "2024-01-15T10:30:00Z"
}
```

**Why this matters:**
- Daemon crashes → Restart session → Workflow resumes at step 2
- No work lost mid-implementation
- This is a key advantage over bash scripts

## Logging

Execution logs are written as JSONL to `.coven/logs/workflows/{workflow-id}.jsonl`:

```jsonl
{"event":"workflow_start","grimoire":"implement","timestamp":"..."}
{"event":"step_start","step":"implement","type":"agent","timestamp":"..."}
{"event":"agent_output","step":"implement","content":"Starting...","timestamp":"..."}
{"event":"step_end","step":"implement","success":true,"duration":"45s","timestamp":"..."}
{"event":"workflow_end","status":"completed","timestamp":"..."}
```

Useful for debugging failed workflows.

## Documentation

| Guide | Description |
|-------|-------------|
| [Grimoires](grimoires.md) | Workflow definitions, validation, best practices |
| [Steps](steps.md) | Agent, script, loop, merge—complete reference |
| [Spells](spells.md) | Prompt templates, variables, functions |
| [Examples](examples.md) | Complete grimoire patterns |

## Common Patterns

### Test-Fix Loop

```yaml
- name: test-loop
  type: loop
  max_iterations: 3
  steps:
    - name: run-tests
      type: script
      command: "npm test"
      on_fail: continue
      on_success: exit_loop

    - name: fix
      type: agent
      spell: fix-test-failures
      when: "{{.previous.failed}}"
```

### Quality Gates

```yaml
- name: lint
  type: script
  command: "npm run lint"

- name: typecheck
  type: script
  command: "npm run typecheck"

- name: test
  type: script
  command: "npm test"

- name: merge
  type: merge
```

### Multi-Stage Review

```yaml
- name: design
  type: agent
  spell: draft-design

- name: design-review
  type: merge
  require_review: true

- name: implement
  type: agent
  spell: implement-design

- name: final-review
  type: merge
  require_review: true
```

See [Examples](examples.md) for more patterns.
