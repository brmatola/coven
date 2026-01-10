# Coven Project Instructions

## Project Structure

```
coven/
├── packages/
│   ├── daemon/          # Go daemon (covend) - agent orchestration
│   │   ├── internal/    # Internal packages (workflow, grimoire, spell, scheduler, etc.)
│   │   └── e2e/         # (empty - use root e2e/daemon instead)
│   └── vscode/          # VS Code extension
├── e2e/                 # End-to-end tests
│   ├── daemon/          # Daemon E2E tests (Go)
│   │   ├── helpers/     # Test utilities (TestEnv, APIClient, fixtures)
│   │   ├── mockagent/   # Mock agent binary for testing
│   │   └── *_test.go    # E2E test files
│   └── extension/       # VS Code extension E2E tests
└── CLAUDE.md            # This file
```

## Testing & Coverage Policy

### Test Commands

| Component | Unit Tests | E2E Tests |
|-----------|-----------|-----------|
| **Daemon (Go)** | `cd packages/daemon && go test ./...` | `make test-e2e` |
| **Extension (TS)** | `npm test` | `npm run test:e2e` |
| **Full suite** | `make test` | Runs both unit + E2E |

### Daemon E2E Tests (`e2e/daemon/`)

**Location:** `e2e/daemon/` (NOT `packages/daemon/e2e/`)

**Running tests:**
```bash
make build           # Build daemon + mockagent first
make test-e2e        # Run E2E tests
# Or directly:
cd e2e/daemon && go test -v -tags=e2e ./...
```

**Test infrastructure:**
- `helpers/daemon.go` - TestEnv with temp dirs, git repos, socket clients
- `helpers/client.go` - Typed API client for all daemon endpoints
- `helpers/fixtures.go` - Setup helpers (beads, mock agent, tasks)
- `mockagent/` - Mock agent binary simulating claude behavior

**Writing tests:**
```go
//go:build e2e

func TestExample(t *testing.T) {
    env := helpers.NewTestEnv(t)
    defer env.Stop()

    // Set up beads, mock agent, and create a task
    taskID := env.SetupWithMockAgentAndTask(t, "Test task")

    env.MustStart()
    api := helpers.NewAPIClient(env)

    // Start session and task
    api.StartSession()
    api.StartTask(taskID)

    // Wait for completion
    env.WaitForAgentStatus(t, api, taskID, "completed", 15)
}
```

**Current E2E coverage:**
- ✅ Daemon lifecycle (start/stop, health, shutdown)
- ✅ Session control (start/stop, force stop)
- ✅ Agent execution (spawn, output, completion, failure, kill)
- ✅ Questions API
- ✅ Events/SSE streaming
- ❌ Workflow orchestration (grimoire execution, loops, conditions)
- ❌ Spell rendering with context
- ❌ Multi-step workflows
- ❌ Timeout enforcement

### VS Code Extension E2E Tests

**Testing Requirements - STRICTLY ENFORCED:**
- ALWAYS run BOTH unit tests AND E2E tests before considering work complete
- ALL tests must pass - do not commit if any tests fail

**E2E Test Design - CRITICAL:**
- E2E tests MUST test the actual Coven extension, not external tools
- NEVER call `claude` CLI directly in E2E tests - the extension does this internally
- E2E tests should use VS Code commands (e.g., `vscode.commands.executeCommand('coven.startTask', taskId)`)
- Test the full workflow: create task → start session → start task → verify agent runs → verify changes
- Using `bd` and `git` commands to SET UP test data is acceptable
- Using `bd` and `git` commands to VERIFY results is acceptable
- But the actual functionality being tested must go through the Coven extension

**What E2E Tests Should Verify:**
1. Session lifecycle: start → active → stop
2. Task lifecycle: create → start (spawns agent in worktree) → complete → review → merge
3. Agent execution: worktree created, agent spawned, output captured, task completed
4. Review workflow: changes visible, approve/revert works
5. Error handling: graceful failures with clear messages

### Coverage Policy - STRICTLY ENFORCED

- **80% coverage threshold** applies to ALL source code without exception
- NEVER exclude actual code files from coverage
- Only permitted exclusions: test files (`*.test.ts`), test infrastructure, mocks
- If code seems untestable, refactor it to be testable
- Comments like "covered by E2E tests" are not valid exclusion reasons

<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->