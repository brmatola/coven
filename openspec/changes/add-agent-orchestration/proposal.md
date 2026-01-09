# Change: Workflow-Based Agent Orchestration

## Why

The daemon's core infrastructure (process management, worktrees, task scheduling) is complete. Now we need the orchestration layer that makes Coven actually useful: **automating repeated multi-agent workflows** like implementing features, reviewing changes, and preparing PRs.

The key insight: Claude Code already handles codebase navigation via CLAUDE.md/AGENTS.md. We don't need to reinvent context injection. Instead, we provide value through:
1. Converting specs into well-formed beads with AC, testing requirements, context
2. Managing review loops that iterate until quality gates pass
3. Orchestrating multi-step workflows with agent handoffs and script gates

## What Changes

### Grimoires: Workflow Definitions
- **Grimoires** define multi-step workflows as YAML in `.coven/grimoires/`
- Each grimoire is a sequence of **steps** (agent invocations or scripts)
- Steps can be: `agent`, `agent-loop`, `parallel-agents`, `script`, `gate`
- Built-in grimoires for common workflows; users can define custom ones

### Step Primitives
- **agent**: Single agent invocation with a prompt template
- **agent-loop**: Repeated agent invocations until exit condition (e.g., review passes)
- **parallel-agents**: Fan-out to N agents (e.g., implement N beads concurrently)
- **script**: Run a shell command (tests, builds, linters)
- **gate**: Script that blocks progression if it fails

### Handoffs and State
- Steps pass outputs to subsequent steps via named variables
- Handoffs carry context: what was done, what's next, relevant artifacts
- Failed steps can retry, block, or escalate to user

### Built-in Grimoires (MVP)
1. **spec-to-beads**: Convert refined openspec into beads with AC, testing requirements
2. **implement-and-review**: Implement a bead, run review loop until acceptable
3. **prepare-pr**: Final review, run all tests, create PR via gh CLI

## Impact

- **Affected specs**:
  - `agent-execution` (MODIFIED - workflow step execution)
  - `agent-orchestration` (NEW - workflow definitions, step primitives)
- **Affected code**:
  - `packages/daemon/internal/workflow/` - workflow engine
  - `packages/daemon/internal/grimoire/` - grimoire loading and validation
  - `.coven/grimoires/` - built-in workflow definitions

## Example: Feature Implementation Workflow

```yaml
# .coven/grimoires/implement-feature.yaml
name: implement-feature
description: "End-to-end: openspec → beads → implementation → PR"
trigger: manual  # or: on_openspec_approved

steps:
  - name: convert-spec
    type: agent
    prompt: spec-to-beads
    input:
      openspec: ${input.openspec_path}
    output: created_beads

  - name: implement
    type: parallel-agents
    for_each: ${created_beads}
    prompt: implement-bead
    max_concurrent: 3
    output: implementations

  - name: review-loop
    type: agent-loop
    prompt: review-changes
    input:
      changes: ${implementations}
    max_iterations: 3
    exit_when: no_actionable_findings
    arbiter_prompt: is-finding-actionable
    output: review_result

  - name: test-gate
    type: gate
    command: "npm test && npm run test:e2e"
    on_fail: block_with_message
    message: "Tests failed. Review loop should have caught this."

  - name: create-pr
    type: agent
    prompt: prepare-pr
    input:
      branch: ${input.feature_branch}
      beads: ${created_beads}
      review: ${review_result}
    tools: [gh]
```

## User Stories

### Story 1: Implement Feature from Spec
As a developer, when I approve an openspec change, I can run the `implement-feature` grimoire which:
1. Converts the spec into appropriately-sized beads with AC and testing requirements
2. Implements each bead in parallel (respecting concurrency limits)
3. Reviews changes iteratively until quality is acceptable
4. Runs test suite as a gate
5. Creates a PR with summary of all changes

### Story 2: Custom Review Workflow
As a team lead, I want stricter reviews, so I create a custom grimoire:
```yaml
# .coven/grimoires/strict-review.yaml
steps:
  - name: security-review
    type: agent
    prompt: security-audit

  - name: coverage-gate
    type: gate
    command: "npm run test:coverage -- --min=80"

  - name: architecture-review
    type: agent
    prompt: architecture-review
```

### Story 3: Yolo Mode
As a developer prototyping, I want fast iteration:
```yaml
# .coven/grimoires/yolo-implement.yaml
steps:
  - name: implement
    type: agent
    prompt: implement-bead
    # No review loop, no gates - just ship it
```

## Success Criteria

1. Users can define workflows as YAML grimoires
2. Built-in grimoires handle common patterns (spec→beads, implement+review, PR)
3. Workflows compose agent work with script gates
4. Review loops iterate until quality acceptable (with configurable limits)
5. Users can override/extend built-in workflows
6. Clear signaling when human intervention needed
