# Workflows

Deep dive into sessions, tasks, grimoires, and the review process.

## Sessions: The Foundation

A **session** is your active work context. Without a session, nothing runs.

### What a Session Does

When you start a session:

1. **Starts the daemon** (`covend`) — The background process that orchestrates everything
2. **Establishes a target branch** — Where approved changes will merge (e.g., `main`, `feature-x`)
3. **Opens SSE connection** — Real-time updates flow to VS Code
4. **Loads grimoires** — Workflow definitions become available

### Why Target Branch Matters

The target branch determines where your work lands:

- **Session on `main`**: Approved changes merge directly to main
- **Session on `feature-x`**: Changes accumulate on the feature branch

This is powerful for staged work:
1. Start session on `feature-auth`
2. Run multiple tasks, each merging to `feature-auth`
3. When ready, merge `feature-auth` to `main` via normal PR

### Session Constraints

- **One session per workspace** — You can't have two sessions targeting different branches
- **Tasks run in session context** — A task started in a `main` session merges to `main`
- **Stopping a session** — All running workflows stop, worktrees are cleaned up

### Starting a Session

1. Click the status bar (shows "Coven: Inactive")
2. Or run `Coven: Start Session` from Command Palette
3. Select a target branch

**What you'll see:**
- Status bar changes to `covend: 0 active, 0 pending`
- Sidebar populates with tasks

### Stopping a Session

1. Run `Coven: Stop Session` from Command Palette
2. Confirm in dialog

**What happens:**
- Running agents are terminated
- Worktrees are preserved (can restart tasks later)
- Daemon shuts down

**Force stop:** If stop hangs, use `Coven: Force Stop Session`.

---

## Grimoires: Why They Exist

A single agent prompt gives you output that "looks right" but hasn't been verified. Grimoires encode the verification.

### The Problem with Single Prompts

```
"Implement user authentication"
```

Claude might:
- Miss edge cases (password reset, session expiry)
- Write code that doesn't compile
- Skip tests entirely
- Produce something that "looks complete" but isn't

### The Grimoire Solution

```yaml
name: implement-with-tests
steps:
  - name: implement
    type: agent
    spell: implement-feature

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
        spell: fix-test-failures
        when: "{{.previous.failed}}"

  - name: merge
    type: merge
    require_review: true
```

Now:
- Implementation is verified by real tests
- Failures trigger automatic fix attempts
- Human reviews before anything merges

### Common Grimoire Patterns

**Script-based validation (tests, linters):**
```yaml
- type: loop
  max_iterations: 3
  steps:
    - type: agent
      spell: implement
    - type: script
      command: "npm test"
      on_success: exit_loop
      on_fail: continue
    - type: agent
      spell: fix-failures
      when: "{{.previous.failed}}"
```

**Adversarial refinement (agent-based validation):**
```yaml
- type: loop
  max_iterations: 3
  steps:
    - type: agent
      spell: refine-work
    - type: agent
      spell: critique-work     # Find problems
    - type: agent
      spell: evaluate-feedback # success=done, failure=continue
      on_success: exit_loop
      on_fail: continue
```

**Multi-stage human review:**
```yaml
- type: agent
  spell: draft-design
- type: merge
  require_review: true  # Review design first

- type: agent
  spell: implement-design
- type: merge
  require_review: true  # Then review implementation
```

See [Orchestration Docs](../orchestration/README.md) for full grimoire reference.

---

## Task Lifecycle

### Creating Tasks

**Via VS Code:**
1. Click **+** in the sidebar header
2. Enter a descriptive title
3. Task appears in **Ready** section

**Task fields:**
| Field | Description |
|-------|-------------|
| **Title** | What needs to be done (required) |
| **Type** | `feature`, `bug`, or `task` |
| **Priority** | 0 (critical) to 4 (backlog) |
| **Description** | Detailed requirements for the agent |
| **Tags** | Include `grimoire:name` to assign a specific workflow |
| **Parent** | Parent task ID for hierarchical organization |

### Task States

| State | Meaning | Actions Available |
|-------|---------|-------------------|
| **Ready** | Available to start | Start |
| **In Progress** | Workflow executing | Stop, View Output |
| **Blocked** | Waiting on something | Retry, View Details |
| **Completed** | Ready for review | Review, Approve, Reject |
| **Closed** | Done | — |

### Starting Tasks

1. Find task in **Ready** section
2. Click play button or right-click > Start Task

**What happens:**
1. Grimoire selected (by label, type mapping, or default)
2. Git worktree created for isolated work
3. Agent spawned in worktree with spell prompt
4. Task moves to **In Progress**

### Monitoring Progress

**Sidebar:**
- Active tasks show elapsed time
- Spinning icon indicates running

**Workflow Detail Panel:**
- Click task to open detailed view
- Real-time agent output streams in

### Handling Questions

When an agent needs input:

1. Notification appears
2. Task moves to **Questions** section
3. Status bar pulses "awaiting response"

**To answer:**
1. Click task in Questions section
2. Select from options or type response
3. Agent continues

**Tip:** Agents waiting on questions block progress. Check the status bar regularly.

### Stopping Tasks

1. Click stop button on the task
2. Confirm in dialog

**What happens:**
- Agent process terminated
- Worktree preserved
- Task returns to Ready or Blocked

---

## Review and Merge

When an agent completes work, you review before it lands.

### Opening Review

1. Task appears in **Completed** section
2. Click **Review** to open Review panel

### Review Panel Features

**Summary View:**
- Changed files with +/- line counts
- Agent's work summary
- Pre-merge check status

**Diff Viewer:**
- Click any file to see changes
- Side-by-side or unified diff
- Syntax highlighting

### Approving Changes

1. Review all changes
2. Verify checks pass
3. Click **Approve**

**What happens:**
- Worktree branch merges to session target
- Worktree cleaned up
- Task marked closed

### Rejecting Changes

1. Click **Reject**
2. Confirm in dialog

**What happens:**
- Worktree deleted
- All changes discarded
- Task returns to Ready (can start again)

### Merge Conflicts

If the target branch changed since the worktree was created:

1. Review panel shows conflict state
2. Click **Open Worktree** to resolve
3. Fix conflicts in new VS Code window
4. Commit resolution
5. Return to review panel
6. Click **Retry Merge**

---

## Working with Task Hierarchy

Tasks can have parent-child relationships, letting you decompose large features into subtasks.

### Creating Subtasks

**Via VS Code:**
1. Open parent task details
2. Click **Add Subtask**
3. Enter subtask title

**Via CLI:**
```bash
coven task create --title="Implement OAuth" --parent=<parent-id>
```

### Viewing Hierarchy

**VS Code:**
- Parent tasks show expandable children in the sidebar
- Click to expand/collapse the tree

**CLI:**
```bash
# Show task and all descendants
coven task subtree <id>

# Show path from task to root
coven task ancestors <id>

# Show direct children only
coven task children <id>
```

### Moving Tasks

Reparent a task to reorganize your work:

```bash
# Move task under new parent
coven task reparent <id> <new-parent-id>

# Move task to root level
coven task reparent <id> --root
```

### Hierarchy Behavior

- Child tasks inherit their parent's grimoire assignment if not explicitly tagged
- Deleting a parent deletes all descendants (cascade)
- Task depth is tracked automatically (useful for filtering)

---

## Daemon Management

### Viewing Logs

Run `Coven: View Daemon Logs` to open logs in terminal.

Useful for debugging:
- Connection issues
- Agent spawn failures
- Workflow errors

### Restarting Daemon

If daemon becomes unresponsive:
1. Run `Coven: Restart Daemon`
2. Session reconnects automatically

### Manual Control via CLI

```bash
# Check daemon status
coven daemon status

# Stop daemon gracefully
coven daemon stop

# View daemon logs (with live tailing)
coven daemon logs --follow
```

---

## Tips and Best Practices

### Write Clear Task Descriptions

**Good:**
> Add a logout button to the navbar. When clicked, clear the session token from localStorage and redirect to /login.

**Bad:**
> Fix auth stuff

### Use Session Branches Strategically

- `main` for production-ready, individual features
- Feature branches for multi-task work that should land together

### Run Multiple Tasks

Coven supports concurrent agents:
- Each gets its own worktree
- No interference between tasks
- Review and merge independently

### Quick Review for Simple Changes

1. Check diff is as expected
2. Glance at checks
3. Approve

### Thorough Review for Complex Changes

1. Open worktree in new window
2. Run tests manually
3. Review logic thoroughly
4. Then approve/reject
