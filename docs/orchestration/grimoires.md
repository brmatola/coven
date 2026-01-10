# Grimoires

A grimoire is a YAML file defining a workflow as a sequence of steps.

## Basic Structure

```yaml
name: implement-feature
description: Implement a feature end-to-end
timeout: 2h  # Optional, default: 1h

steps:
  - name: implement
    type: agent
    spell: implement
    timeout: 15m

  - name: run-tests
    type: script
    command: "npm test"
    timeout: 5m
```

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier for the grimoire |
| `description` | No | Human-readable description |
| `timeout` | No | Max workflow duration (default: 1h) |
| `steps` | Yes | Array of steps to execute |

## Step Types

| Type | Purpose |
|------|---------|
| `agent` | Invoke an AI agent with a prompt |
| `script` | Run a shell command |
| `loop` | Repeat steps until condition or max iterations |
| `merge` | Merge worktree changes to main branch |

See [Steps](steps.md) for detailed documentation of each type.

## File Location

Place grimoires in `.coven/grimoires/`:

```
.coven/
└── grimoires/
    ├── implement-feature.yaml
    ├── bugfix-workflow.yaml
    └── reviewed-implementation.yaml
```

## Grimoire Selection

When a bead is picked up, the daemon selects a grimoire using this priority:

1. **Explicit label** on the bead: `grimoire:workflow-name`
2. **Type mapping** from `.coven/grimoire-mapping.json`
3. **Default** from config or built-in `implement-bead`

### Using Labels

Tag a bead with a specific grimoire:

```bash
bd create --title="Add auth" --type=feature --label=grimoire:strict-implement
```

### Type Mapping

Create `.coven/grimoire-mapping.json` to map bead types to grimoires:

```json
{
  "default": "implement-bead",
  "by_type": {
    "feature": "implement-feature",
    "bug": "bugfix-workflow",
    "task": "implement-bead"
  }
}
```

With this config:
- Features use `implement-feature` grimoire
- Bugs use `bugfix-workflow` grimoire
- Tasks use `implement-bead` grimoire
- Anything else uses the `default`

## Conditional Execution

Any step can have a `when` condition:

```yaml
steps:
  - name: run-tests
    type: script
    command: "npm test"
    on_fail: continue

  - name: fix-failures
    type: agent
    spell: fix-tests
    when: "{{.previous.failed}}"  # Only runs if tests failed
```

Conditions must evaluate to a boolean. Non-boolean values cause an error.

Common patterns:
- `when: "{{.previous.failed}}"` - Run if previous step failed
- `when: "{{.previous.success}}"` - Run if previous step succeeded
- `when: "{{not .previous.success}}"` - Negate a condition

## Validation

Grimoires are validated when loaded. Common errors:

- Missing `name` field
- Empty `steps` array
- Duplicate step names
- Invalid step type
- Invalid timeout format
- Agent step without `spell`
- Script step without `command`
- Loop step without nested `steps`
