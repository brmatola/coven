# Change: Add Spell Include Functionality

## Why

Spells currently have no composition mechanism:
1. **Duplication** - Common patterns (output format, coding standards) repeated across spells
2. **Maintenance burden** - Changing a pattern requires editing every spell
3. **No parameterization** - Can't create reusable spell "components" with custom values

An include function enables spell composition and reuse.

## What Changes

### Basic Includes
- **ADDED** `{{include "filename.md"}}` function in spell templates
- **ADDED** Resolution from `.coven/spells/` directory
- **ADDED** Nested includes (included files can include others)
- **ADDED** Circular include detection with clear error

### Parameterized Includes
- **ADDED** Variable passing: `{{include "file.md" key1="value1" key2=.variable}}`
- **ADDED** Included template receives passed variables in its context
- **ADDED** Parent context accessible via `{{.parent}}` in included file

## Impact

- **Affected specs:** agent-orchestration
- **Affected code:**
  - `packages/daemon/internal/workflow/spell.go` - Implement include function
  - `packages/daemon/internal/workflow/template.go` - Register include in FuncMap
- **Breaking changes:** None (new function, doesn't affect existing spells)
