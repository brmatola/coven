# Coven

**Turn unreliable AI agent runs into verified, resumable workflows.**

Coven orchestrates AI agents (Claude, via the [Claude CLI](https://github.com/anthropics/claude-code)) through defined pipelines: implement a feature, run tests, fix failures, repeat until tests pass, then pause for your review. If Claude crashes mid-task or your laptop dies, Coven resumes from the last completed step—not from scratch.

## Core Concepts

| Term | What It Is | Example |
|------|------------|---------|
| **Task** | What you want done. Has a title, description, type, and priority. | "Add logout button to navbar" |
| **Grimoire** | A YAML file defining a workflow. Steps execute in sequence. | `.coven/grimoires/implement-with-tests.yaml` |
| **Spell** | A prompt template with variables. Can be inline or a `.md` file. | `Implement: {{.task.title}}` |
| **Step** | One unit of work: run an agent, execute a script, loop, or merge. | `type: agent`, `type: script`, `type: loop`, `type: merge` |
| **Session** | Your active work context. Picks a target branch for merges. | Session on `main` → approved work merges to main |
| **Worktree** | Isolated git working directory. One per task. Auto-cleaned on merge. | `.coven/worktrees/task-abc123/` |

## 30-Second Overview

```
You write a grimoire (workflow definition):
┌────────────────────────────────────────┐
│  1. Agent: Implement the feature       │
│  2. Loop until tests pass:             │
│     - Run: npm test                    │
│     - Agent: Fix failures              │
│  3. Pause for human review             │
│  4. Merge to target branch             │
└────────────────────────────────────────┘

You create a task: "Add user authentication"

Coven executes:
• Creates isolated git worktree (your main branch stays clean)
• Agent implements in worktree
• Tests run, agent fixes failures, loop repeats
• You review the diff and approve
• Changes merge to your target branch

If anything fails mid-workflow, restart and it picks up where it left off.
```

## Why Not Just a Bash Script?

You could write this:

```bash
#!/bin/bash
claude "Implement auth"
npm test || claude "Fix the tests"
npm test || claude "Fix the tests"
npm test || echo "Giving up"
```

Here's what you'd have to add to match Coven:

| Problem | Your Bash Script | Coven |
|---------|------------------|-------|
| **Crash recovery** | Script dies at step 3? Start over. Git state unknown. | Persists state after each step. Restart resumes at step 3. |
| **Isolated work** | Agent edits files in your working directory. Uncommitted changes everywhere. | Each task gets a git worktree. Your main directory stays clean. |
| **Passing context** | Parse stdout, grep for patterns, hope the format is consistent. | Agents return structured JSON. Access `{{.step_name.outputs.files}}` in next step. |
| **Human checkpoints** | Add `read -p "Continue?"` everywhere. No diff viewer. | Built-in review UI. See changes, approve/reject, then merge. |
| **Concurrent tasks** | Manage PIDs, output streams, cleanup. Good luck. | Start multiple tasks. Each gets its own worktree. Review independently. |
| **Retry with context** | Pass failure output back to Claude manually. | `{{.run-tests.output}}` automatically available to fix step. |

**The real unlock:** Coven makes agent workflows *resumable* and *reviewable*. When step 3 of 5 fails, you don't start over—you fix the issue and continue. When the agent finishes, you review a clean diff before anything touches your branch.

## Quick Start

### Prerequisites

1. **Git** — `git --version` (any recent version)
2. **Node.js 18+** — `node --version`
3. **Go 1.21+** — `go version` (for building the daemon)
4. **Claude CLI with API access** — `claude --version`
   - Install from [github.com/anthropics/claude-code](https://github.com/anthropics/claude-code)
   - **Requires an Anthropic API key or subscription** — Follow Claude CLI setup to configure authentication
5. **VS Code** — For the extension UI

### Install Coven

```bash
# Clone the repository
git clone https://github.com/anthropics/coven.git
cd coven

# Install dependencies and build
npm install
make build

# Install the VS Code extension locally
npm run dogfood
```

Reload VS Code. The Coven icon should appear in the Activity Bar (left sidebar).

### Your First Task (No Custom Grimoire)

1. **Open a git repo** in VS Code (must have at least one commit)

2. **Start a session:**
   - Click "Coven: Inactive" in the status bar (bottom)
   - Select your target branch (e.g., `main`)
   - Status bar changes to `covend: 0 active, 0 pending`
   - Coven auto-creates `.coven/` directory for workflow state

3. **Create a task:**
   - Click the **+** button in the Coven sidebar
   - Title: "Add a greet function to src/utils.ts that returns 'Hello, {name}'"
   - The task appears in the **Ready** section

4. **Start the task:**
   - Click the play button on your task
   - Watch it move to **Active**
   - Click the task to see real-time agent output

5. **Review and merge:**
   - When complete, task moves to **Completed**
   - Click **Review** to see the diff
   - Click **Approve** to merge, or **Reject** to discard

That's it. The agent worked in an isolated worktree, and you reviewed before anything touched your branch.

## Your First Grimoire

The default grimoire is simple: one agent step, one merge. For verification loops:

### Step 1: Create the Grimoire

Create `.coven/grimoires/implement-with-tests.yaml`:

```yaml
name: implement-with-tests
description: Implement a feature and verify with tests

steps:
  # Step 1: Agent implements the feature
  - name: implement
    type: agent
    spell: |
      # Task: {{.task.title}}

      {{.task.body}}

      Implement this feature. When done, return a JSON block:
      ```json
      {"success": true, "summary": "What you implemented"}
      ```
    timeout: 20m

  # Step 2: Test-fix loop (max 3 attempts)
  - name: test-loop
    type: loop
    max_iterations: 3
    steps:
      - name: run-tests
        type: script
        command: "npm test"
        on_fail: continue      # Don't stop on failure—let the agent fix it
        on_success: exit_loop  # Tests pass → exit loop, continue to merge

      - name: fix-tests
        type: agent
        spell: |
          Tests failed. Here's the output:

          ```
          {{.run-tests.output}}
          ```

          Fix the failing tests. Return:
          ```json
          {"success": true, "summary": "What you fixed"}
          ```
        when: "{{.previous.failed}}"  # Only run if tests failed
        timeout: 15m

  # Step 3: Human review before merge
  - name: merge
    type: merge
    require_review: true
```

### Step 2: Assign a Task to Your Grimoire

When creating a task, add a tag to select the grimoire:

**Via VS Code:**
1. Create a task via the **+** button
2. Click the task to open details
3. Click **Add Tag**
4. Type: `grimoire:implement-with-tests`
5. Start the task

**Via CLI:**
```bash
coven task create --title="Add multiply function" --tags="grimoire:implement-with-tests"
```

Now the workflow runs your grimoire instead of the default.

### Critical: Agent JSON Output

**Agents must return a JSON block at the end of their output.** This is how Coven knows whether a step succeeded:

```json
{"success": true, "summary": "What was done", "outputs": {"key": "value"}}
```

| Field | Required | Description |
|-------|----------|-------------|
| `success` | **Yes** | `true` if step succeeded, `false` if it failed |
| `summary` | No | Human-readable summary |
| `outputs` | No | Structured data for subsequent steps |
| `error` | No | Error message when `success: false` |

**If the agent doesn't return valid JSON, the step fails.** Always include clear instructions in your spell:

```yaml
spell: |
  Do the thing.

  When done, return:
  ```json
  {"success": true, "summary": "Brief description"}
  ```
```

### Understanding the Template Syntax

The `{{...}}` syntax is [Go templates](https://pkg.go.dev/text/template). Here's what you need to know:

```yaml
# Access task fields
{{.task.title}}        # "Add user authentication"
{{.task.body}}         # The full task description

# Access previous step output
{{.run-tests.output}}  # Raw stdout/stderr from run-tests step
{{.run-tests.status}}  # "success" or "failed"

# Access structured output from agent steps
{{.implement.outputs.files}}  # If agent returned {"outputs": {"files": [...]}}

# Conditionals
{{if .previous.failed}}Only if previous step failed{{end}}

# Previous step shortcuts
{{.previous.success}}  # Boolean: did the immediately preceding step succeed?
{{.previous.failed}}   # Boolean: did it fail?
{{.previous.output}}   # Output from the immediately preceding step
```

## Step Types Reference

| Type | Purpose | Key Fields |
|------|---------|------------|
| `agent` | Run Claude with a prompt | `spell` (required), `input`, `timeout` (default: 15m) |
| `script` | Run a shell command | `command` (required), `timeout` (default: 5m), `on_fail`, `on_success` |
| `loop` | Repeat steps until exit condition | `steps` (required), `max_iterations` (default: 10) |
| `merge` | Merge worktree to target branch | `require_review` (default: true) |

### Flow Control

```yaml
# Script: continue on failure (let agent fix it)
- name: run-tests
  type: script
  command: "npm test"
  on_fail: continue      # Don't stop the workflow
  on_success: exit_loop  # Exit enclosing loop on success

# Agent: only run when previous step failed
- name: fix-tests
  type: agent
  spell: fix-the-tests
  when: "{{.previous.failed}}"
```

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
      spell: fix-tests
      when: "{{.previous.failed}}"
```

### Quality Gates Before Merge

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
- name: draft
  type: agent
  spell: draft-design

- name: review-design
  type: merge
  require_review: true  # Pause: review design before implementing

- name: implement
  type: agent
  spell: implement-design

- name: review-implementation
  type: merge
  require_review: true  # Pause: review implementation before merging
```

### Adversarial Refinement

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
      spell: |
        Review this work and find problems:
        {{.refine.outputs.content}}

        Return: {"success": true, "outputs": {"issues": ["issue1", ...]}}

    - name: evaluate
      type: agent
      spell: |
        Are these issues substantive or nitpicks?
        Issues: {{.critique.outputs.issues}}

        If substantive: {"success": false, "outputs": {"feedback": [...]}}
        If done: {"success": true, "summary": "Work is complete"}
      on_success: exit_loop
      on_fail: continue
```

## Directory Structure

```
your-project/
├── .coven/
│   ├── grimoires/              # YOUR workflow definitions
│   │   └── implement-with-tests.yaml
│   ├── spells/                 # YOUR prompt templates (optional)
│   │   └── implement.md
│   ├── grimoire-matchers.yaml  # YOUR tag-to-grimoire routing (optional)
│   ├── covend.sock             # AUTO: Daemon socket
│   ├── tasks.db                # AUTO: Task database (bbolt)
│   ├── logs/workflows/         # AUTO: Execution logs
│   ├── state/workflows/        # AUTO: Resume state
│   └── worktrees/              # AUTO: Isolated git worktrees
```

**You create:** `grimoires/`, `spells/`, `grimoire-matchers.yaml`
**Coven creates:** Everything else (on session start)

## Timeouts

| Scope | Default | Description |
|-------|---------|-------------|
| Workflow | 1h | Max total time |
| Agent step | 15m | Max per agent |
| Script step | 5m | Max per script |

Format: Go duration strings — `15m`, `2h`, `30s`, `1h30m`

## What Happens When Things Fail

| Failure | Behavior | Recovery |
|---------|----------|----------|
| Agent times out | Step fails, workflow blocks | Increase timeout or simplify task |
| Script exits non-zero | Step fails (or continues if `on_fail: continue`) | Fix script or let agent handle |
| Agent returns no JSON | Step fails with parse error | Add JSON instructions to spell |
| Loop hits max iterations | Workflow blocks | Increase limit or fix underlying issue |
| Daemon crashes | Workflow paused | Restart session; resumes from last completed step |
| Merge conflict | Workflow blocks | Open worktree, resolve, retry |

## Documentation

| Guide | Description |
|-------|-------------|
| [Quick Start](docs/vscode/quickstart.md) | Detailed setup walkthrough |
| [Workflows](docs/vscode/workflows.md) | Sessions, tasks, review process |
| [Grimoires](docs/orchestration/grimoires.md) | Workflow definition reference |
| [Steps](docs/orchestration/steps.md) | Step types: agent, script, loop, merge |
| [Spells](docs/orchestration/spells.md) | Prompt templates and variables |
| [Examples](docs/orchestration/examples.md) | Complete grimoire patterns |
| [Troubleshooting](docs/vscode/troubleshooting.md) | Common issues and fixes |

## Requirements

- **VS Code** — For the extension UI
- **Git** — Any recent version
- **Node.js 18+** — For building the extension
- **Go 1.21+** — For building the daemon
- **[Claude CLI](https://github.com/anthropics/claude-code)** — Requires Anthropic API key configured

## Development

```bash
npm install          # Install dependencies
make build           # Build daemon + extension
npm test             # Unit tests
make test-e2e        # E2E tests
```

Press `F5` in VS Code to launch the Extension Development Host.
