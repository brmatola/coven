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

### Step Primitives (just 3)
- **agent**: Invoke agent with a spell (file reference or inline)
- **script**: Run shell command with `on_fail`/`on_success` handlers
- **loop**: Repeat sub-steps until condition or max iterations

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
      bead: ${bead}

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
        when: ${previous.failed}

      # Review phase
      - name: review
        type: agent
        spell: review
        output: findings

      - name: check-actionable
        type: agent
        spell: is-actionable
        input:
          findings: ${findings}
        output: needs_fixes

      - name: apply-fixes
        type: agent
        spell: apply-review-fixes
        when: ${needs_fixes}

      # Exit if clean
      - name: final-test
        type: script
        command: "npm test"
        on_success: exit_loop

  - name: mark-done
    type: script
    command: "bd close ${bead.id}"
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

1. Three primitives only: agent, script, loop
2. Spells as separate composable templates (file or inline)
3. Labels drive grimoire selection with sensible fallbacks
4. Quality loop pattern handles test + review iteration cleanly
5. Max iterations → block for manual review (no infinite loops)
6. Simple bead lifecycle (open → in_progress → closed/blocked)
