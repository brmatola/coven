# Goldfish Design

## Overview

Goldfish is a Claude Code plugin that orchestrates multi-phase workflows with intentional context resets between phases. It provides:

1. **State persistence** across Claude Code sessions
2. **Workflow definitions** (DSL) for multi-phase processes
3. **Phase hooks** for quality gates (tests, linting) with result capture
4. **Context injection** via hooks on session start
5. **Auto-run mode** for hands-off workflow execution
6. **Parallel workflow support** via instance IDs

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         goldfish CLI                                │
│  (Orchestrates auto-run mode, manages multiple instances)           │
│                                                                     │
│  goldfish run "task" --workflow=name    # Auto-run entire workflow │
│  goldfish list                          # Show all instances        │
│  goldfish attach <id>                   # Attach to instance        │
│  goldfish logs <id>                     # View instance logs        │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
          ▼                        ▼                        ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ Claude Window 1  │    │ Claude Window 2  │    │ Claude Window 3  │
│ Instance: abc123 │    │ Instance: def456 │    │ Instance: ghi789 │
│ Phase: implement │    │ Phase: review    │    │ Phase: fix       │
└────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Shared State (.goldfish/)                        │
│                                                                     │
│  .goldfish/                                                         │
│  ├── state.db              # All instance state (SQLite)            │
│  ├── workflows/            # Project workflow definitions           │
│  │   ├── default.yaml                                               │
│  │   └── adversarial.yaml                                           │
│  └── logs/                 # Instance logs                          │
│      ├── abc123.log                                                 │
│      └── def456.log                                                 │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                   Inside Each Claude Session                        │
│                                                                     │
│  Commands:                                                          │
│   /goldfish:start <task> [--workflow=name]  # Start new instance   │
│   /goldfish:next                            # Complete phase        │
│   /goldfish:resume [id]                     # Resume instance       │
│   /goldfish:status                          # Show instance status  │
│   /goldfish:list                            # List all instances    │
│   /goldfish:abort [id]                      # Abort instance        │
│                                                                     │
│  MCP Server (goldfish):                                             │
│   goldfish_create_instance(task, workflow)                          │
│   goldfish_get_context(instance_id?)                                │
│   goldfish_phase_complete(outputs)                                  │
│   goldfish_run_hook(hook_name)                                      │
│   goldfish_get_status(instance_id?)                                 │
│   goldfish_list_instances()                                         │
│   goldfish_abort(instance_id)                                       │
└─────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Goldfish CLI (Orchestrator)

The CLI enables **auto-run mode** - executing entire workflows hands-off, only stopping on errors or when user input is required.

#### `goldfish run <task> --workflow=<name>`

Auto-runs an entire workflow:

```bash
goldfish run "Fix the authentication bug" --workflow=adversarial

# Output:
# 🐠 Starting workflow: adversarial
# 📋 Instance: abc123
#
# ═══ Phase 1/4: implement ═══
# Spawning Claude Code...
# [Claude works on implementation]
# ✓ Phase complete
# Running hook: npm test
# ✓ Hook passed (exit 0)
#
# ═══ Phase 2/4: review ═══
# Resetting context...
# Spawning Claude Code...
# [Claude reviews adversarially]
# ...
```

**Key behaviors**:
- Spawns `claude` CLI with `--print` flag for each phase
- Passes phase context via `--append-system-prompt`
- Runs phase `on_complete` hooks between phases
- **Stops on**: hook failure, Claude error, phase marked `requires_input: true`, or completion
- Logs all output to `.goldfish/logs/{instance_id}.log`

#### `goldfish list`

Shows all workflow instances in current project:

```bash
goldfish list

# ID       TASK                 WORKFLOW     PHASE      STATUS
# abc123   Fix auth bug         adversarial  review     running
# def456   Add dark mode        default      execute    paused
# ghi789   Refactor API         tdd          test       completed
```

#### `goldfish attach <id>`

Opens interactive Claude session bound to an instance:

```bash
goldfish attach abc123
# Launches: claude --append-system-prompt "..."
```

#### `goldfish logs <id>`

View instance logs:

```bash
goldfish logs abc123 --follow
```

#### `goldfish abort <id>`

Abort a running instance.

### 2. Commands (Slash Commands)

For **manual mode** - stepping through workflows interactively inside Claude Code.

#### `/goldfish:start <task> [--workflow=name]`

Creates a new workflow instance.

#### `/goldfish:next`

Completes current phase:
1. Captures phase outputs
2. Runs `on_complete` hooks (if any)
3. Reports hook results
4. In manual mode: prompts user to `/clear` and `/goldfish:resume`
5. In auto mode: signals orchestrator to continue

#### `/goldfish:resume [instance_id]`

Loads phase context into fresh session. If multiple instances exist, requires instance_id.

#### `/goldfish:list`

Shows all instances in project.

#### `/goldfish:status [instance_id]`

Shows detailed instance status including phase, hook results, etc.

#### `/goldfish:abort [instance_id]`

Cancels an instance.

### 3. Phase Hooks (Quality Gates)

Shell commands that run at phase boundaries. **Results are captured and available in subsequent phase contexts.**

#### Hook Definition

```yaml
phases:
  - name: implement
    context: |
      Implement the feature...
    capture: [summary, files_changed]

    on_complete:                    # Run after phase, before advancing
      - name: tests
        run: npm test
        capture_output: true        # Store stdout/stderr
        fail_workflow: true         # Stop workflow if exit != 0

      - name: lint
        run: npm run lint
        capture_output: true
        fail_workflow: false        # Continue even if fails (just report)

    on_start:                       # Run before phase begins
      - name: pull
        run: git pull --rebase
        capture_output: false
```

#### Hook Results in Context

Hook outputs are injected into subsequent phases:

```yaml
- name: review
  reset: true
  context: |
    # Code Review

    ## Test Results
    ```
    {{phases.implement.hooks.tests.output}}
    ```
    {{#if phases.implement.hooks.tests.failed}}
    ⚠️ WARNING: Tests failed during implementation!
    {{/if}}

    ## Implementation Summary
    {{phases.implement.summary}}
```

#### Hook Result Schema

```typescript
interface HookResult {
  name: string;
  command: string;
  exit_code: number;
  output: string;         // Combined stdout + stderr
  duration_ms: number;
  failed: boolean;        // exit_code != 0
  timestamp: string;
}
```

### 4. Claude Code Hooks

Plugin hooks that fire on Claude Code lifecycle events.

#### SessionStart Hook

Notifies user of active instances when starting a new Claude session:

```bash
#!/bin/bash
# Runs on every Claude Code session start

INSTANCES=$(goldfish list --json 2>/dev/null)
COUNT=$(echo "$INSTANCES" | jq 'length')

if [ "$COUNT" -gt 0 ]; then
  echo "🐠 Active goldfish instances:"
  echo "$INSTANCES" | jq -r '.[] | "   \(.id) - \(.task) (\(.phase))"'
  echo ""
  echo "   /goldfish:resume <id> to continue"
  echo "   /goldfish:list for details"
fi
```

### 5. MCP Server

Manages state and exposes tools to Claude.

#### Tools

```typescript
interface GoldfishTools {
  // Create new workflow instance
  goldfish_create_instance(params: {
    task: string;
    workflow?: string;  // defaults to "default"
  }): Promise<{
    instance_id: string;
    phase: string;
    context: string;
  }>;

  // Get context for an instance
  goldfish_get_context(params: {
    instance_id?: string;  // If omitted and only one active, uses that
  }): Promise<{
    instance_id: string;
    task: string;
    phase: string;
    phase_index: number;
    total_phases: number;
    context: string;
    hook_results: Record<string, HookResult>;
  }>;

  // Complete current phase
  goldfish_phase_complete(params: {
    instance_id?: string;
    summary: string;
    outputs?: Record<string, any>;
  }): Promise<{
    completed_phase: string;
    pending_hooks: string[];     // Hooks to run
    next_phase: string | null;
    workflow_complete: boolean;
  }>;

  // Run a phase hook
  goldfish_run_hook(params: {
    instance_id: string;
    hook_name: string;
  }): Promise<HookResult>;

  // List all instances
  goldfish_list_instances(): Promise<InstanceSummary[]>;

  // Get instance status
  goldfish_get_status(params: {
    instance_id?: string;
  }): Promise<InstanceStatus>;

  // Abort instance
  goldfish_abort(params: {
    instance_id: string;
  }): Promise<{ aborted: boolean }>;
}
```

#### State Schema (SQLite)

```sql
-- Workflow instances (multiple can exist per project)
CREATE TABLE instances (
  id TEXT PRIMARY KEY,              -- Short unique ID (e.g., "abc123")
  task TEXT NOT NULL,
  workflow TEXT NOT NULL,
  current_phase INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',  -- running, paused, completed, failed, aborted
  mode TEXT NOT NULL DEFAULT 'manual',     -- manual, auto
  error TEXT,                              -- Error message if failed
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Phase outputs and hook results
CREATE TABLE phase_results (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES instances(id),
  phase_name TEXT NOT NULL,
  phase_index INTEGER NOT NULL,
  outputs JSON NOT NULL,            -- Captured phase outputs
  hook_results JSON NOT NULL,       -- Results from on_complete hooks
  completed_at TEXT NOT NULL
);

-- Index for fast lookups
CREATE INDEX idx_instance_status ON instances(status);
CREATE INDEX idx_phase_instance ON phase_results(instance_id);
```

### 6. Workflow Definitions

YAML files in `.goldfish/workflows/` that define multi-phase processes. **Project-local only** (no global workflows for MVP).

```yaml
# .goldfish/workflows/adversarial-review.yaml
name: adversarial-review
description: Implement, review adversarially, then fix issues

phases:
  - name: implement
    description: Implement the task
    context: |
      # Implementation Phase

      Task: {{task.title}}

      {{task.body}}

      Implement this task. When complete, run /goldfish:next
    capture:
      - name: summary
        description: Brief summary of what was implemented
      - name: files_changed
        description: List of files that were modified

  - name: review
    description: Adversarial code review
    reset: true
    context: |
      # Review Phase

      You are reviewing code you did NOT write.
      Your job is to find problems. Be adversarial.

      ## Task
      {{task.title}}

      ## Implementation Summary
      {{phases.implement.summary}}

      ## Files Changed
      {{phases.implement.files_changed}}

      Review the implementation. Find bugs, issues, and improvements.
      Do NOT assume the implementation is correct.

      When complete, run /goldfish:next
    capture:
      - name: findings
        description: Issues found during review
      - name: severity
        description: Overall severity (none, low, medium, high, critical)

  - name: fix
    description: Address review findings
    reset: true
    context: |
      # Fix Phase

      Fix the issues found during review.

      ## Original Task
      {{task.title}}

      ## Review Findings
      {{phases.review.findings}}

      ## Severity
      {{phases.review.severity}}

      Address each finding. When complete, run /goldfish:next
    capture:
      - name: summary
        description: Summary of fixes applied

  - name: verify
    description: Verify fixes and complete
    reset: true
    context: |
      # Verification Phase

      Verify the fixes were applied correctly.

      ## Original Task
      {{task.title}}

      ## Implementation Summary
      {{phases.implement.summary}}

      ## Review Findings
      {{phases.review.findings}}

      ## Fix Summary
      {{phases.fix.summary}}

      Run tests, verify the changes work, and confirm the task is complete.
```

## User Flow

### Auto-Run Mode (Recommended)

Hands-off workflow execution. User kicks it off and watches (or does other things).

```bash
$ goldfish run "Fix the authentication bug" --workflow=adversarial

🐠 Starting workflow: adversarial
📋 Instance: abc123
   Task: Fix the authentication bug

═══ Phase 1/4: implement ═══
Spawning Claude Code...
[Claude implements the fix]
✓ Phase complete

Running hooks...
  ✓ tests (npm test) - passed (exit 0)
  ✓ lint (npm run lint) - passed (exit 0)

═══ Phase 2/4: review ═══
Resetting context...
Spawning Claude Code...
[Claude reviews adversarially - no memory of implementation]
✓ Phase complete

Running hooks...
  ✓ tests (npm test) - passed (exit 0)

═══ Phase 3/4: fix ═══
Resetting context...
Spawning Claude Code...
[Claude fixes issues from review]
✓ Phase complete

═══ Phase 4/4: verify ═══
Resetting context...
Spawning Claude Code...
[Claude verifies everything works]
✓ Phase complete

════════════════════════════════════════════════════
✓ Workflow complete: adversarial (4 phases)
  Instance: abc123
  Duration: 12m 34s
════════════════════════════════════════════════════
```

**What happens under the hood:**
1. CLI spawns `claude --print --append-system-prompt "<phase context>"` for each phase
2. Waits for Claude to complete the phase
3. Runs `on_complete` hooks (tests, lint, etc.)
4. If hooks pass, advances to next phase with fresh context
5. If hooks fail with `fail_workflow: true`, stops and reports error

**Stopping conditions:**
- Hook failure with `fail_workflow: true`
- Phase marked `requires_input: true`
- Claude error
- Workflow completion
- User interrupt (Ctrl+C)

### Manual Mode (Interactive)

For users who want more control or need to intervene during phases.

```
┌─────────────────────────────────────────────────────────────┐
│ Session 1                                                   │
├─────────────────────────────────────────────────────────────┤
│ User: /goldfish:start "Fix auth bug" --workflow=adversarial │
│                                                             │
│ Claude: [Creates instance abc123, shows implement context]  │
│         [Works on implementation]                           │
│                                                             │
│ User: /goldfish:next                                        │
│                                                             │
│ Claude: [Captures summary, files_changed]                   │
│         Running hooks...                                    │
│           ✓ tests (npm test) - passed                       │
│         "Phase complete. Run /clear then /goldfish:resume"  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ User runs /clear
┌─────────────────────────────────────────────────────────────┐
│ Session 2 (fresh context)                                   │
├─────────────────────────────────────────────────────────────┤
│ [SessionStart hook]: "🐠 Active instance: abc123"           │
│                      "   Task: Fix auth bug"                │
│                      "   Phase: review (2/4)"               │
│                      "   /goldfish:resume to continue"      │
│                                                             │
│ User: /goldfish:resume                                      │
│                                                             │
│ Claude: [Loads review context - implementation summary,     │
│          test results injected]                             │
│         [Reviews adversarially - no implementation bias]    │
│                                                             │
│ User: /goldfish:next                                        │
│ ...continues through phases...                              │
└─────────────────────────────────────────────────────────────┘
```

### Multiple Instances

Users can run multiple workflow instances in parallel within the same project. Each instance has a unique ID.

```bash
# Start first workflow
$ goldfish run "Fix auth bug" --workflow=adversarial &
# Instance: abc123

# Start second workflow (different task)
$ goldfish run "Add dark mode" --workflow=default &
# Instance: def456

# List all instances
$ goldfish list
ID       TASK              WORKFLOW      PHASE      STATUS
abc123   Fix auth bug      adversarial   review     running
def456   Add dark mode     default       execute    running

# Attach to specific instance
$ goldfish attach abc123

# View logs for specific instance
$ goldfish logs def456 --follow
```

**Use cases:**
- Run adversarial review on one feature while working on another
- Multiple team members working on same repo (different tasks)
- Long-running workflow in background while doing quick fixes

## Design Decisions

### 1. Why SQLite for State?

- Single file, no server process
- ACID transactions
- Works offline
- Easy to inspect/debug
- MCP server loads on Claude start, persists naturally

### 2. Why YAML for Workflows?

- Human readable/editable
- Easy to share (just copy the file)
- Supports multi-line strings for context templates
- Familiar to developers

### 3. Why Both Auto-Run and Manual Modes?

**Auto-run** is the primary mode - users want to kick off a workflow and have it complete without babysitting. Manual stepping through phases is tedious.

**Manual** mode exists for:
- Debugging workflow definitions
- Tasks requiring human judgment mid-workflow
- Users who want to review each phase before proceeding
- Pausing to do other work between phases

The CLI orchestrator handles auto-run; the slash commands handle manual mode. Both share the same underlying MCP tools and state.

### 4. Why Phase Hooks Are Core (Not Optional)?

Phase hooks (quality gates) are essential for **correctness guarantees**:

- Without hooks: Claude says "done" but tests fail
- With hooks: Workflow stops if tests fail, feeds failure context to next phase

Hooks bridge the gap between "Claude thinks it's done" and "the code actually works." This is especially critical when the reviewer phase doesn't share context with the implementer - the test results provide objective ground truth.

Example: Implementation phase completes → tests run → results captured → review phase sees "Tests passed" or "Tests failed with: ..." in its context.

### 5. Why MCP Instead of Just Files?

MCP provides:
- Tools that Claude can call directly
- Structured responses
- Type safety
- Cleaner integration than shelling out

But state is still file-based (SQLite) so it persists across MCP restarts.

### 6. Why Not Use Subagents for Phases?

Subagents run within the same session, sharing context. We want:
- Complete context isolation between phases
- User control over when transitions happen
- The ability to span multiple terminal sessions

Subagents are great for parallel work within a phase, but not for sequential phases with hard resets.

### 7. Why Instance IDs for Multiple Workflows?

Users legitimately need multiple workflows running in the same project:
- Feature A in adversarial review while starting Feature B
- Long-running workflow in background while handling quick fixes
- Multiple team members (each with their own Claude window)

Without instance IDs, we'd either:
- Only allow one workflow per project (too limiting)
- Require separate directories (annoying)

Instance IDs are short (6 chars like `abc123`), human-readable, and automatically inferred when only one instance is active.

### 8. Why Project-Local Workflows Only (for MVP)?

Decided against global `~/.goldfish/workflows/` for MVP:
- Forces users to think about which workflows apply to which projects
- Reduces confusion about "where did this workflow come from?"
- Workflows are often project-specific anyway (different test commands, etc.)
- Can add global workflows later if there's demand

## Open Questions

### Q: Should workflows support branching?

Example: After review, if severity=none, skip fix phase.

**Tentative answer**: Yes, add optional `skip_if` condition to phases:

```yaml
- name: fix
  skip_if: "{{phases.review.severity}} == 'none'"
```

### Q: Should we support parallel phases?

Example: Run security review and performance review in parallel.

**Tentative answer**: Defer to v2. Requires coordinating multiple Claude instances with synchronization points.

### Q: Can phases opt-out of reset?

Example: Two phases that should share context.

**Answer**: Yes, `reset: false` (or omit reset) keeps context:

```yaml
- name: implement
  # no reset specified = keep context

- name: test
  reset: false  # explicitly keep context from implement

- name: review
  reset: true   # fresh context
```

### Q: How should hook timeouts work?

Hooks (tests, linting) can take a while. Need to decide:
- Default timeout? (e.g., 5 minutes)
- Per-hook configurable timeout?
- How to surface "hook is still running" to user in auto-run mode?

**Tentative answer**: 5 minute default, configurable per-hook:

```yaml
on_complete:
  - name: tests
    run: npm test
    timeout: 600  # 10 minutes
```

## Future Considerations

### v1.1: Workflow Templates
Pre-built workflows for common patterns:
- TDD loop (test → implement → refactor)
- Documentation (explore → draft → review → finalize)
- Bug fix (reproduce → investigate → fix → verify)
- Security audit (threat model → code review → remediate)

### v1.2: Global Workflows
If users want to share workflows across projects:
- `~/.goldfish/workflows/` for global defaults
- Project workflows override global by name

### v1.3: Parallel Phases
Support for parallel phases across multiple instances with synchronization points:
```yaml
- name: parallel-review
  parallel:
    - security-review
    - performance-review
  join: all  # wait for both before continuing
```

### v1.4: Workflow Composition
Nest workflows within workflows:
```yaml
- name: implement
  workflow: tdd-loop  # Run entire TDD workflow as one phase
```

### v2.0: Web Dashboard
Visual workflow status, logs, history. Useful for teams.
