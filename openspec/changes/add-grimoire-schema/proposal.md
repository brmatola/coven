# Change: Add Grimoire JSON Schema

## Why

Grimoire YAML files lack IDE support:
1. **No autocomplete** - Users must memorize field names and valid values
2. **No inline validation** - Errors only appear when daemon loads the grimoire
3. **No hover documentation** - Must reference external docs for field meanings

A JSON schema enables VS Code (with YAML extension) to provide IntelliSense.

## What Changes

- **ADDED** `schemas/grimoire-schema.json` - Full JSON schema for grimoire YAML
- **ADDED** Schema documentation for all fields, types, and enums
- **ADDED** Recommended VS Code settings snippet for schema association
- **ADDED** Schema validation in daemon startup (in addition to existing validation)

## Schema Coverage

- Grimoire top-level: `name`, `description`, `timeout`, `steps`
- Step types: `agent`, `script`, `loop`, `merge`
- Step common fields: `name`, `type`, `when`, `timeout`
- Agent step: `spell`, `input`, `on_fail`, `on_success`
- Script step: `command`, `env`, `workdir`, `on_fail`, `on_success`
- Loop step: `steps`, `max_iterations`, `on_max_iterations`
- Merge step: `require_review`, `commit_message`, `auto_rebase`, `pre_merge`

## Impact

- **Affected specs:** agent-orchestration
- **Affected code:**
  - `schemas/grimoire-schema.json` - New file
  - `docs/orchestration/grimoires.md` - Add schema setup instructions
- **Breaking changes:** None
