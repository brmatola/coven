# Change: Workflow-Based Agent Orchestration

## Why

The daemon's core infrastructure (process management, worktrees, task scheduling) is complete. Now we need the orchestration layer that makes Coven actually useful: **automating repeated multi-agent workflows** like implementing features, reviewing changes, and preparing PRs.

The key insight: Claude Code already handles codebase navigation via CLAUDE.md/AGENTS.md. We don't need to reinvent context injection. Instead, we provide value through:
1. Converting specs into well-formed beads with AC, testing requirements, context
2. Managing quality loops that iterate until tests pass and reviews are clean
3. Orchestrating multi-step workflows with clean handoffs between agents

## What Changes

### Grimoires: Workflow Definitions
- **Grimoires** define multi-step workflows as YAML in `.coven/grimoires/`
- Each grimoire operates on **one unit of work** (one bead)
- The scheduler handles parallelism (k8s-style: pick up ready beads, run N at a time)
- Built-in grimoires for common workflows; users can override or create custom ones

### Spells: Prompt Templates
- **Spells** are prompt templates stored in `.coven/spells/`
- Support Go template syntax with `{{.variable}}` placeholders
- Can be referenced by name or inlined directly in grimoire YAML
- Users can override built-in spells or create custom ones

### Step Primitives (4 types)
- **agent**: Invoke agent with a spell (file reference or inline)
- **script**: Run shell command with `on_fail`/`on_success` handlers
- **loop**: Repeat sub-steps until condition or max iterations
- **merge**: Merge worktree changes to main repo (requires human review by default)

### Dry-Run Mode
- Preview what a grimoire would do without executing
- Shows: resolved grimoire, rendered spells, step sequence
- Validates templates and variable references
- Command: `coven grimoire preview <grimoire> --bead=<id>`

### Grimoire-to-Bead Mapping
- Beads specify grimoire via label: `grimoire:implement-bead`
- Fallback to type mapping in config
- Fallback to default grimoire

### Simple Bead Lifecycle
- `open` → `in_progress` → `closed` (or `blocked` if needs intervention)
- Scheduler picks up `open` beads, sets `in_progress`, runs grimoire
- On success: `closed`. On max retries: `blocked` for manual review

## Example: Implement Bead Grimoire

```yaml
# .coven/grimoires/implement-bead.yaml
name: implement-bead
description: "Full implementation cycle for one bead"

steps:
  - name: implement
    type: agent
    spell: implement
    input:
      bead: "{{.bead}}"

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

  - name: merge-changes
    type: merge
    require_review: true
```

## Example: Inline Spell

```yaml
- name: quick-fix
  type: agent
  spell: |
    Fix the failing tests. Here's the output:
    {{.test_output}}

    Focus only on making tests pass. Don't refactor.
```

## Impact

- **Affected specs**:
  - `agent-execution` (MODIFIED - workflow step execution)
  - `agent-orchestration` (NEW - grimoires, spells, scheduler integration)
- **Affected code**:
  - `packages/daemon/internal/workflow/` - workflow engine
  - `packages/daemon/internal/grimoire/` - grimoire loading
  - `packages/daemon/internal/spell/` - spell loading and rendering
  - `.coven/grimoires/` - built-in workflow definitions
  - `.coven/spells/` - built-in prompt templates

## User Stories

### Story 1: Implement Feature from Spec
As a developer, when I run the `spec-to-beads` grimoire on an approved openspec:
1. It creates beads with AC, testing requirements, context baked in
2. Each bead gets `grimoire:implement-bead` label
3. Scheduler picks up ready beads, runs implement-bead grimoire on each
4. Each bead goes through: implement → test/fix → review/fix → done
5. Failed beads get flagged for my review

### Story 2: Custom Grimoire
As a team lead, I create a stricter implementation flow:
```yaml
# .coven/grimoires/strict-implement.yaml
steps:
  - name: implement
    type: agent
    spell: implement

  - name: quality-loop
    type: loop
    max_iterations: 5  # More retries
    steps:
      # ... with additional security review step
```

Then label beads: `grimoire:strict-implement`

### Story 3: Custom Spell
As a developer, I override the review spell for my project:
```markdown
# .coven/spells/review.md
You are reviewing changes. Focus on:
- Our team's coding standards (see CONTRIBUTING.md)
- Test coverage for new functions
- No console.log statements in production code

{{.changes}}
```

## Success Criteria

### Functional
1. Four primitives: agent, script, loop, merge
2. Spells as separate composable templates (file or inline)
3. Labels drive grimoire selection with sensible fallbacks
4. Quality loop pattern handles test + review iteration cleanly
5. Max iterations → block for manual review (no infinite loops)
6. Simple bead lifecycle (open → in_progress → pending_merge → closed/blocked)
7. Merge step requires human review before changes land in main repo
8. Timeouts prevent runaway execution (configurable per-step and per-workflow)
9. Shell-escaped variables prevent command injection in script steps
10. Explicit boolean coercion in conditions (fail fast on type errors)
11. Dry-run mode validates grimoires without execution

### Quality Metrics (validate through experimentation)
12. Agent outputs valid JSON in ≥90% of steps (target: 95%+)
13. Quality loop converges within max_iterations for ≥70% of test beads (target: 80%+)
14. Blocked workflows provide sufficient context to understand failure in <2 minutes
