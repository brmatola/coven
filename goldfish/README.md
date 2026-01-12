# Goldfish

> *Ironically, the one that remembers.*

A Claude Code plugin for workflow orchestration with intentional context resets.

## The Problem

Claude Code is powerful, but context accumulation works against you in multi-phase workflows:

- **Implementation bias**: The reviewer remembers the implementer's struggles and rationalizations
- **Context pollution**: Debug attempts, failed approaches, and tangents fill your window
- **Stale assumptions**: Earlier decisions persist even when circumstances change

The solution isn't better memory - it's **strategic forgetting** with **structured recall**.

## The Idea

Goldfish manages **workflows** that span multiple Claude Code sessions:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Session 1  │     │   Session 2  │     │   Session 3  │
│  (implement) │────▶│   (review)   │────▶│    (fix)     │
│              │reset│              │reset│              │
│ Fresh context│     │ Fresh context│     │ Fresh context│
│ + task brief │     │ + impl summary│    │ + review findings│
└──────────────┘     └──────────────┘     └──────────────┘
        │                   │                    │
        └───────────────────┴────────────────────┘
                            │
                    ┌───────▼───────┐
                    │  Goldfish     │
                    │  State Server │
                    │               │
                    │ Persists:     │
                    │ - Task info   │
                    │ - Phase data  │
                    │ - Outputs     │
                    └───────────────┘
```

Each phase starts **clean** but **informed**.

## How It Works

```bash
# Start a workflow
> /goldfish:start "Fix the authentication bug" --workflow=adversarial

# Claude implements with fresh context...
# When done:

> /goldfish:next
✓ Implementation captured. Ready for review phase.
  Run /clear, then /goldfish:resume

# User clears context (new session)
> /clear

# In fresh session:
> /goldfish:resume

═══════════════════════════════════════════════════════════
REVIEW PHASE: Fix the authentication bug
═══════════════════════════════════════════════════════════

You are reviewing code you did NOT write.
Your job: find problems. Be adversarial.

Implementation summary:
- Added JWT validation to auth middleware
- Updated token refresh logic in session.go
- Modified 3 files: auth.go, middleware.go, session.go

Do not assume the implementation is correct.
═══════════════════════════════════════════════════════════

# Claude reviews with ZERO memory of implementation struggles
```

## Key Concepts

### Workflows
YAML definitions that specify phases, context templates, and what to capture:

```yaml
name: adversarial-review
phases:
  - name: implement
    context: |
      Implement: {{task.title}}
      {{task.body}}
    capture: [summary, files_changed]

  - name: review
    reset: true
    context: |
      Review code you did NOT write.
      Implementation: {{phases.implement.summary}}
    capture: [findings]

  - name: fix
    reset: true
    context: |
      Fix these issues: {{phases.review.findings}}
```

### Strategic Forgetting
The `reset: true` flag means "start with clean context." Claude doesn't remember:
- Implementation false starts
- Debugging rabbit holes
- Rationalizations and justifications

But Claude DOES receive:
- Structured outputs from previous phases
- Task context and requirements
- Phase-specific instructions

### Structured Recall
Each phase `capture`s specific outputs that feed into the next phase's `context`. This is curated memory, not raw history.

## Installation

```bash
# Via Claude Code plugin marketplace
/plugin marketplace add goldfish-ai/goldfish

# Or via npm
npm install -g @goldfish/cli
goldfish setup
```

## Inspiration

- [Ralph](https://github.com/frankbria/ralph-claude-code) - Autonomous Claude Code loops with session management
- [Feature-Dev Plugin](https://github.com/anthropics/claude-code/tree/main/plugins/feature-dev) - Multi-phase workflow with parallel agents

## Philosophy

> "The secret to creativity is knowing how to hide your sources." - Einstein

The best code review comes from fresh eyes. The best fix comes from understanding the problem, not the failed attempts. Goldfish gives Claude fresh eyes at every phase while maintaining the throughline of what matters.
