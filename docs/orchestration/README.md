# Workflow Orchestration

Coven's daemon (`covend`) orchestrates AI agent workflows using **grimoires** (workflow definitions) and **spells** (prompt templates).

## How It Works

When a bead (task) is picked up by the daemon, it:

1. Resolves which grimoire to use based on labels, type, or defaults
2. Creates a git worktree for isolated work
3. Executes the grimoire's steps sequentially
4. Manages merging changes back to main

## Directory Structure

```
.coven/
├── grimoires/           # User-defined workflow definitions
│   └── my-workflow.yaml
├── spells/              # User-defined prompt templates
│   └── implement.md
├── grimoire-mapping.json # Optional: type-to-grimoire mapping
├── logs/workflows/      # Execution logs (JSONL)
└── state/workflows/     # Workflow state for resume
```

## Quick Start

1. Create a grimoire in `.coven/grimoires/my-workflow.yaml`:

```yaml
name: my-workflow
description: Simple implementation workflow

steps:
  - name: implement
    type: agent
    spell: |
      Implement: {{.bead.title}}
      Return: {"success": true, "summary": "Done"}
    timeout: 15m

  - name: merge
    type: merge
    require_review: false
```

2. Create a bead with the grimoire label:

```bash
bd create --title="Add feature X" --type=feature --label=grimoire:my-workflow
```

3. Start the daemon and the workflow will execute automatically.

## Documentation

- [Grimoires](grimoires.md) - Workflow definitions and selection
- [Steps](steps.md) - Step types (agent, script, loop, merge)
- [Spells](spells.md) - Prompt templates and variables
- [Examples](examples.md) - Complete workflow examples
- [API](api.md) - REST API and troubleshooting

## Timeouts

| Scope | Default |
|-------|---------|
| Workflow | 1 hour |
| Agent step | 15 minutes |
| Script step | 5 minutes |

Format: Go duration strings (`15m`, `2h`, `30s`)

## Workflow Lifecycle

```
bead created (open)
       │
       ▼
daemon picks up ──► resolves grimoire
       │
       ▼
creates worktree ──► executes steps
       │
       ├── step succeeds ──► next step
       ├── step fails ──► block or continue
       └── merge step ──► review or auto-merge
       │
       ▼
workflow completes ──► bead closed
```

## State & Resume

Workflow state is persisted after each step. If the daemon restarts, workflows resume from the last completed step.

State files: `.coven/state/workflows/{workflow-id}.json`

## Logging

Execution logs are written as JSONL to `.coven/logs/workflows/{workflow-id}.jsonl`:

```jsonl
{"event":"workflow_start","workflow_id":"abc123","grimoire":"my-workflow"}
{"event":"step_start","step":"implement","type":"agent"}
{"event":"step_end","step":"implement","success":true,"duration":"45s"}
{"event":"workflow_end","status":"completed"}
```
