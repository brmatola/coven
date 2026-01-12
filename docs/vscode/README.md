# Coven VS Code Extension

The VS Code extension provides the UI for Coven—a workflow orchestration system for AI agents.

## Quick Links

- [Quick Start](quickstart.md) — Get running in 10 minutes
- [Workflows](workflows.md) — Sessions, tasks, review process
- [Troubleshooting](troubleshooting.md) — Common issues and fixes
- [Orchestration Docs](../orchestration/README.md) — Grimoire reference

## Core Concepts

### Sessions

A **session** is your active work context:

1. **Starts the daemon** (`covend`) — The background process that runs workflows
2. **Sets a target branch** — Where approved changes merge (e.g., `main`)
3. **Enables task execution** — Without a session, tasks can't run

**Why target branch matters:**
- Session on `main` → approved work merges directly to main
- Session on `feature-x` → changes accumulate on feature branch first

**Constraints:**
- One session per workspace
- To change target branch, stop session and start a new one

### Tasks

A **task** describes what you want done. When started:

1. Coven selects a grimoire (workflow) based on labels or type
2. Creates an isolated git worktree
3. Executes the workflow steps
4. Pauses at merge steps for review
5. Merges approved changes to target branch

**Task states:**

| State | Meaning |
|-------|---------|
| **Ready** | Available to start |
| **Active** | Workflow executing |
| **Questions** | Agent waiting for your input |
| **Blocked** | Waiting on dependencies or error |
| **Completed** | Ready for review |
| **Closed** | Merged or rejected |

### Grimoires

A **grimoire** defines how a task executes. Instead of running a simple agent:

```yaml
name: implement-with-tests
steps:
  - name: implement
    type: agent
    spell: implement

  - name: test-loop
    type: loop
    max_iterations: 3
    steps:
      - name: run-tests
        type: script
        command: "npm test"
        on_fail: continue
        on_success: exit_loop

      - name: fix-tests
        type: agent
        spell: fix-tests
        when: "{{.previous.failed}}"

  - name: merge
    type: merge
    require_review: true
```

This implements, tests, fixes failures, and reviews before merging.

**Grimoire selection:**
- **Explicit:** Label task with `grimoire:name`
- **By type:** Configure `.coven/grimoire-mapping.json`
- **Default:** Built-in implement + merge

### Spells

**Spells** are prompt templates with variables:

```yaml
# Inline
spell: |
  Task: {{.task.title}}
  Return: {"success": true, "summary": "Done"}

# File reference (loads .coven/spells/implement.md)
spell: implement
input:
  test_output: "{{.run-tests.output}}"
```

Variables:
- `{{.task.title}}`, `{{.task.body}}` — Task fields
- `{{.step_name.output}}` — Previous step output
- `{{.step_name.outputs.key}}` — Structured agent output
- `{{.previous.failed}}` — Previous step status

See [Spells Documentation](../orchestration/spells.md) for full reference.

### Worktrees

Each task gets an isolated **git worktree**:

- Located at `.coven/worktrees/{task-id}/`
- Agent works here, not your main directory
- Your working directory stays clean
- Merged to target branch on approval
- Cleaned up after merge or rejection

## UI Overview

### Activity Bar

Click the **Coven icon** in the left Activity Bar to open the sidebar.

### Sidebar

| Section | Description |
|---------|-------------|
| **Active** | Running workflows. Shows elapsed time. |
| **Questions** | Agents waiting for your input. |
| **Ready** | Tasks available to start. |
| **Blocked** | Tasks with dependencies or errors. |
| **Completed** | Finished, ready for review. |

### Status Bar

Bottom left shows connection status:

| Display | Meaning |
|---------|---------|
| `Coven: Inactive` | No session active |
| `covend: X active, Y pending` | Session active with counts |
| `covend: Z awaiting response` | Agent(s) need input |
| `covend: disconnected` | Connection lost |

Click to start session or open sidebar.

### Panels

- **Task Detail** — View and edit task information
- **Workflow Detail** — Real-time progress and agent output
- **Review** — Diff viewer with approve/reject

## Commands

Access via Command Palette (`Cmd/Ctrl + Shift + P`):

| Command | Description |
|---------|-------------|
| `Coven: Start Session` | Start new session |
| `Coven: Stop Session` | Stop active session |
| `Coven: Create Task` | Create new task |
| `Coven: Start Task` | Start selected task |
| `Coven: Stop Task` | Stop running workflow |
| `Coven: Review Task` | Open review panel |
| `Coven: Answer Question` | Answer agent question |
| `Coven: View Daemon Logs` | Open daemon logs |
| `Coven: Restart Daemon` | Restart the daemon |

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Focus Coven sidebar | `Cmd/Ctrl + Shift + C` |
| Create task | `Cmd/Ctrl + Shift + N` (when sidebar focused) |
| Start selected task | `Enter` (when task selected) |
| Open task details | `Space` (when task selected) |

## Configuration

Settings in VS Code preferences:

| Setting | Description | Default |
|---------|-------------|---------|
| `coven.binaryPath` | Custom path to `covend` | (bundled) |
| `coven.autoStartSession` | Auto-start session on workspace open | `false` |
| `coven.defaultTimeout` | Default agent timeout | `15m` |
| `coven.showNotifications` | Show desktop notifications | `true` |

## Workflow: Start to Finish

### 1. Start Session

```
Status bar: "Coven: Inactive" → Click → Select branch
```

### 2. Create Task

```
Sidebar: Click + → Enter title → Enter description (optional)
```

### 3. Assign Grimoire (Optional)

```
Click task → Labels → Add "grimoire:implement-with-tests"
```

### 4. Start Task

```
Hover task → Click ▶ (play)
```

### 5. Monitor Progress

```
Click active task → See real-time output
```

### 6. Answer Questions

```
Notification appears → Click "Answer" → Select option
```

### 7. Review Changes

```
Task in Completed → Click "Review" → Review diff
```

### 8. Approve or Reject

```
Click "Approve" → Changes merge to target branch
Click "Reject" → Changes discarded, task returns to Ready
```

## Working with Multiple Tasks

Coven supports concurrent tasks:

- Each gets its own worktree
- No interference between agents
- Review and merge independently

**Tips:**
- Start multiple related tasks simultaneously
- Use dependencies to enforce order
- Review in any order you prefer

## Viewing Logs

### Workflow Logs

1. Click active or completed task
2. Expand "Logs" section in detail panel
3. Or: Run `Coven: View Workflow Logs`

### Daemon Logs

1. Run `Coven: View Daemon Logs`
2. Opens in terminal with live output

### File Locations

```
.coven/logs/daemon.log           # Daemon logs
.coven/logs/workflows/{id}.jsonl # Workflow logs
```

## Common Tasks

### Switch Target Branch

1. Run `Coven: Stop Session`
2. Run `Coven: Start Session`
3. Select new target branch

### Restart Stuck Workflow

1. Stop the task (click stop button)
2. Check task details for errors
3. Update description if needed
4. Start task again

### Resolve Merge Conflicts

1. In review panel, click "Open Worktree"
2. Resolve conflicts in new VS Code window
3. Stage and commit resolution
4. Return to review panel
5. Click "Retry Merge"

### Debug Agent Issues

1. Run `Coven: View Daemon Logs`
2. Look for errors around task start time
3. Check workflow logs for step failures
4. Review agent output in workflow detail

## Next Steps

- [Quick Start](quickstart.md) — Detailed setup walkthrough
- [Workflows](workflows.md) — Deep dive into sessions and tasks
- [Troubleshooting](troubleshooting.md) — Common issues and fixes
- [Grimoires](../orchestration/grimoires.md) — Workflow definition reference
