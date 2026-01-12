# Goldfish Implementation Plan

## Overview

Goldfish is significantly simpler than the original Coven daemon approach:

| Aspect | Coven Daemon | Goldfish |
|--------|--------------|----------|
| Architecture | Go daemon + VS Code extension | Claude Code plugin |
| State | bbolt database + JSONL files | SQLite (single file) |
| Distribution | Binary + extension marketplace | Plugin marketplace / npm |
| Integration | HTTP API, SSE, subprocess spawn | MCP tools, hooks, commands |
| Complexity | ~5000 lines Go + ~3000 lines TS | ~1000 lines TS |

## Phase 1: Core MCP Server + Phase Hooks

**Goal**: State management, tools, and phase hook execution (quality gates)

**Files**:
```
mcp/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts        # Server setup
    ├── state.ts        # SQLite state manager (multi-instance)
    ├── tools.ts        # Tool implementations
    └── hooks.ts        # Phase hook executor
```

**Tasks**:
1. Set up TypeScript MCP server boilerplate
2. Implement SQLite state manager (multi-instance)
   - `createInstance(task, workflow)` → returns instance_id
   - `getInstance(instanceId?)` → auto-selects if only one active
   - `listInstances()` → all instances in project
   - `advancePhase(instanceId, phaseIndex)`
   - `storePhaseResult(instanceId, phase, outputs, hookResults)`
   - `getPhaseResults(instanceId)` → outputs + hook results
   - `completeInstance(instanceId)`
   - `abortInstance(instanceId)`
   - `failInstance(instanceId, error)`
3. Implement phase hook executor
   - Run shell commands with timeout
   - Capture stdout/stderr
   - Return structured HookResult
4. Implement MCP tools
   - `goldfish_create_instance`
   - `goldfish_get_context`
   - `goldfish_phase_complete` (runs hooks, stores results)
   - `goldfish_run_hook` (for manual hook execution)
   - `goldfish_list_instances`
   - `goldfish_get_status`
   - `goldfish_abort`
5. Test with Claude Code manually

**Acceptance**: Can create instance, advance phases with hooks, complete workflow. Hook results appear in subsequent phase context.

## Phase 2: Workflow DSL

**Goal**: Load and render workflow definitions with phase hooks

**Files**:
```
mcp/src/
├── workflows.ts      # YAML loader with hook definitions
└── templates.ts      # Handlebars-style renderer (includes hook results)

.goldfish/workflows/  # Project-local workflows
├── default.yaml
└── adversarial-review.yaml
```

**Tasks**:
1. Implement YAML workflow loader
   - Parse phases with `on_complete` and `on_start` hooks
   - Validate hook definitions (run, timeout, fail_workflow, capture_output)
2. Implement template renderer with variable substitution
   - Support `{{phases.<name>.<capture>}}` for outputs
   - Support `{{phases.<name>.hooks.<hook>.output}}` for hook results
   - Support `{{#if phases.<name>.hooks.<hook>.failed}}` conditionals
3. Add workflow validation
   - Phase names unique
   - Captures only reference earlier phases
   - Hook commands exist (optional warning)
4. Create default workflows (bundled with plugin as examples)

**Acceptance**: Workflows load from `.goldfish/workflows/`, context templates render with phase outputs AND hook results.

## Phase 3: Commands (Manual Mode)

**Goal**: User-friendly slash commands for interactive workflow control

**Files**:
```
commands/
├── start.md
├── next.md
├── resume.md
├── status.md
├── list.md
└── abort.md
```

**Tasks**:
1. Write command prompts that use MCP tools
   - `/goldfish:start` - create instance, show first phase context
   - `/goldfish:next` - capture outputs, run hooks, report results, prompt for `/clear`
   - `/goldfish:resume` - load current phase context (auto-select if one instance)
   - `/goldfish:list` - show all instances in project
   - `/goldfish:status` - detailed instance status
   - `/goldfish:abort` - cancel instance
2. Handle multi-instance scenarios (require instance_id when ambiguous)
3. Ensure proper error handling
4. Add help text and examples

**Acceptance**: Full workflow completable via `/goldfish:start` → `/goldfish:next` → `/goldfish:resume` cycle. Commands handle multiple instances gracefully.

## Phase 4: Claude Code Hooks

**Goal**: Session start notification (not to be confused with phase hooks in Phase 1)

**Files**:
```
hooks/
├── hooks.json
└── session-check.sh
```

**Tasks**:
1. Implement SessionStart hook
2. Create CLI helper for status check (reads SQLite directly)
3. Test hook fires correctly
4. Ensure hook doesn't block on no active instances
5. Show multiple instances if more than one active

**Acceptance**: Starting new Claude session shows active instance reminder(s).

## Phase 5: Plugin Packaging

**Goal**: Installable plugin

**Files**:
```
.claude-plugin/
└── plugin.json

.mcp.json
package.json
```

**Tasks**:
1. Create plugin.json with all components
2. Configure .mcp.json for MCP server
3. Set up npm package.json
4. Test plugin installation via `/plugin install`
5. Write installation docs

**Acceptance**: Plugin installs with single command, all features work.

## Phase 6: CLI Orchestrator (Auto-Run Mode)

**Goal**: Hands-off workflow execution

**Files**:
```
cli/
├── package.json
└── src/
    ├── index.ts        # CLI entry point
    ├── run.ts          # Auto-run orchestrator
    ├── list.ts         # List instances
    ├── attach.ts       # Attach to instance
    ├── logs.ts         # View logs
    └── abort.ts        # Abort instance
```

**Tasks**:
1. Implement `goldfish run <task> --workflow=<name>`
   - Create instance via MCP (or direct SQLite)
   - Loop: spawn `claude --print --append-system-prompt "<context>"` for each phase
   - After each phase: run `on_complete` hooks
   - Handle hook failures (stop if `fail_workflow: true`)
   - Log all output to `.goldfish/logs/{instance_id}.log`
2. Implement `goldfish list` - show all instances
3. Implement `goldfish attach <id>` - spawn interactive Claude with instance context
4. Implement `goldfish logs <id> [--follow]` - view instance logs
5. Implement `goldfish abort <id>` - abort running instance

**Acceptance**: Can run entire 4-phase workflow hands-off with `goldfish run`. Stops on hook failure. Logs available.

## Phase 7: Polish & Documentation

**Goal**: Ready for others to use

**Tasks**:
1. Write comprehensive README with examples
2. Add more built-in workflows (TDD, documentation, security audit)
3. Error messages and edge cases
4. Create demo/tutorial (screencast?)
5. Test installation from scratch

**Acceptance**: New user can install and use goldfish in 5 minutes.

---

## Estimated Effort

| Phase | Description | Dependencies |
|-------|-------------|--------------|
| 1. MCP Server + Phase Hooks | Core state, tools, hook executor | None |
| 2. Workflow DSL | YAML loader, template renderer | Phase 1 |
| 3. Commands (Manual Mode) | Slash commands for interactive use | Phase 1, 2 |
| 4. Claude Code Hooks | SessionStart notification | Phase 1 |
| 5. Plugin Packaging | Installable package | Phase 1-4 |
| 6. CLI Orchestrator | Auto-run mode | Phase 1, 2 |
| 7. Polish & Docs | README, examples, edge cases | Phase 1-6 |

**Note**: Effort estimates removed per project guidelines. Focus on what needs doing, not timelines.

## Tech Stack

- **TypeScript** - MCP server, CLI
- **SQLite** (better-sqlite3) - State persistence
- **YAML** (js-yaml) - Workflow definitions
- **Handlebars** - Template rendering (or simple regex replacement)

## Key Risks

### Risk: MCP Server Lifecycle

**Concern**: When does MCP server start/stop? Is state shared across sessions?

**Mitigation**: Use SQLite file storage. MCP server is stateless; all state lives in `.goldfish/state.db`.

### Risk: Hook Timeout and Failure Handling

**Concern**: What happens if a phase hook hangs or fails intermittently?

**Mitigation**:
- Default timeout (5 minutes) with per-hook override
- Clear error messages with hook output
- `fail_workflow: false` option for non-critical hooks
- Logs capture full output for debugging

### Risk: Claude CLI Spawning in Auto-Run

**Concern**: Does `claude --print --append-system-prompt` work reliably for automation?

**Mitigation**:
- Test thoroughly during Phase 6
- Have fallback to manual mode if automation is unreliable
- Log all Claude output for debugging

### Risk: Instance State Conflicts

**Concern**: What if two Claude sessions try to modify the same instance?

**Mitigation**:
- SQLite handles concurrent writes
- Instance-level locking if needed
- Clear error message if instance is locked

## Out of Scope (v1)

- Global workflows (`~/.goldfish/workflows/`)
- Parallel phases
- Workflow nesting/composition
- Web dashboard
- Team/collaboration features

These can be added later if there's demand.

## Success Criteria

1. **Installable**: Plugin installs with single command
2. **Auto-Run**: Complete 4-phase workflow hands-off with `goldfish run`
3. **Quality Gates**: Phase hooks run, capture output, fail workflow on error
4. **Manual Mode**: Full workflow completable via slash commands
5. **Multi-Instance**: Run multiple workflows in same project
6. **Documented**: New user can start quickly
7. **Shareable**: Custom workflows are just YAML files
