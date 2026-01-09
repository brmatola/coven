## Context

Coven needs to extract agent orchestration from the VS Code extension to a daemon process. This enables agents to survive IDE restarts, provides instant UI through cached state, and allows independent testing.

Key constraints:
- Must work offline (no external services except git)
- Must be simple to install (bundle with extension)
- Must support macOS (primary) and Linux
- Per-workspace daemon model (like beads)
- Beads remains source of truth for tasks via `bd ready --json`

## Goals / Non-Goals

**Goals:**
- Clean separation of orchestration from UI
- Instant state queries (< 10ms)
- Real-time UI updates via SSE
- Independent E2E testability
- Simple installation via extension bundling

**Non-Goals:**
- CLI for daemon management (future, separate spec)
- Remote/distributed execution (future)
- Multi-user access control
- Web dashboard (future)
- Alternative task sources (beads only)

## Decisions

### Language: Go

**Decision:** Implement daemon in Go.

**Rationale:**
- Single static binary (no runtime dependencies)
- Excellent cross-compilation support
- Good concurrency primitives for scheduler
- Familiar pattern (beads is Go)
- Fast startup time

### Monorepo: npm workspaces

**Decision:** Restructure to npm workspaces monorepo.

**Rationale:**
- Clean separation of packages
- Shared tooling at root
- Go daemon lives alongside TypeScript extension
- Enables future shared packages if needed

**Structure:**
```
coven/
├── package.json              # Workspace root
├── packages/
│   ├── vscode/               # VS Code extension (TypeScript)
│   └── daemon/               # covend (Go)
```

### IPC: HTTP over Unix Socket

**Decision:** Use HTTP/1.1 over Unix socket with SSE for events.

**Rationale:**
- HTTP is well-understood, easy to debug (curl)
- Unix socket provides security (filesystem permissions)
- SSE is simpler than WebSocket for server-push
- No need for bidirectional streaming

### Beads Integration: `bd ready --json`

**Decision:** Use beads CLI instead of parsing JSONL files.

**Rationale:**
- Beads handles dependency resolution
- Beads handles caching (SQLite)
- Stable CLI interface (less likely to change than file format)
- No duplication of dependency logic

**Implementation:**
```go
type BeadsClient struct {
    workspacePath string
}

func (c *BeadsClient) GetReadyTasks() ([]Task, error) {
    cmd := exec.Command("bd", "ready", "--json")
    cmd.Dir = c.workspacePath
    output, err := cmd.Output()
    // Parse JSON output
}

func (c *BeadsClient) UpdateTaskStatus(taskId, status string) error {
    cmd := exec.Command("bd", "update", taskId, "--status="+status)
    cmd.Dir = c.workspacePath
    return cmd.Run()
}
```

**Polling strategy:**
- Poll every 1 second when session active
- Immediate poll on agent state change
- Stop polling when session inactive

### State Storage: JSON

**Decision:** Use JSON file for persistence.

**Rationale:**
- Human-readable, easy to debug
- Simple implementation
- Matches beads pattern

**Schema:**
```json
// .coven/state.json
{
  "session": {
    "started": true,
    "featureBranch": "my-feature",
    "maxAgents": 3,
    "startedAt": "2024-01-15T10:30:00Z"
  },
  "agents": [
    {
      "id": "claude-1",
      "taskId": "beads-a1b2",
      "worktreePath": ".coven/worktrees/beads-a1b2",
      "pid": 12345,
      "startedAt": "2024-01-15T10:31:00Z"
    }
  ]
}
```

### Agent Process Management

**Decision:** Spawn claude as child process, capture stdio, track PID.

**Process info persisted:**
```json
// .coven/agents/{taskId}.json
{
  "pid": 12345,
  "startTime": "2024-01-15T10:31:00Z",
  "command": ["claude", "--print", "--verbose"],
  "worktreePath": ".coven/worktrees/beads-a1b2"
}
```

**Recovery logic:**
1. On startup, scan `.coven/agents/`
2. For each file, check if process still running (kill -0)
3. Verify process is actually claude (check /proc or ps)
4. If valid, reconnect to stdio
5. If stale, clean up and check worktree for orphan work

### Output Buffering

**Decision:** Ring buffer per agent, capped at 10MB, with sequence numbers.

**Rationale:**
- Sequence numbers enable efficient incremental fetching
- Ring buffer prevents memory exhaustion
- 10MB is enough for typical agent runs

### Daemon Version Updates

**Decision:** Always kill and restart on version mismatch.

**Rationale:**
- Simplest approach
- Ensures consistent behavior
- No complex compatibility logic needed
- Agents can be restarted by scheduler

**Flow:**
```
Extension connects → GET /version
Version mismatch detected
Extension calls POST /shutdown
Daemon stops all agents, persists state, exits
Extension extracts new binary
Extension starts new daemon
Daemon recovers state from .coven/state.json
Scheduler restarts work
```

## Risks / Trade-offs

### Risk: Zombie Processes

**Risk:** Daemon crashes, leaves agent processes running.

**Mitigation:**
- Process group: spawn agents in same process group
- PID tracking with validation on recovery
- Orphan detection on startup

### Risk: Stale Socket Files

**Risk:** Crash leaves socket file, blocks restart.

**Mitigation:**
- Health check before assuming socket is valid
- Remove stale socket if health check fails
- PID file for additional validation

### Trade-off: Per-Workspace vs Global Daemon

**Chose:** Per-workspace (like beads)

**Trade-off:**
- Pro: Simpler model, daemon tied to workspace lifecycle
- Pro: Socket location is predictable (.coven/covend.sock)
- Con: Multiple daemons if working on multiple repos

Accepted because simplicity is more important for MVP.

### Trade-off: Polling vs File Watching for Beads

**Chose:** Polling via `bd ready --json`

**Trade-off:**
- Pro: Uses stable CLI interface
- Pro: Leverages beads caching
- Pro: Avoids race conditions with beads file watcher
- Con: 1s polling overhead (minimal)

Accepted because CLI stability and avoiding race conditions outweigh minimal overhead.

### Testing Strategy

**Decision:** 80% unit test coverage + functional E2E tests.

**Unit tests:**
- Cover all internal packages
- Mock external dependencies (bd CLI, claude process, git)
- Fast execution (< 30s)
- Coverage enforced in CI

**E2E tests:**
- Exercise daemon via HTTP API
- Use real beads database and git
- Mock agent for fast tests (real claude optional)
- Isolated temp directories per test

**Mock agent approach:**
```go
// Mock agent binary that completes immediately
// Used for fast E2E tests
func main() {
    fmt.Println("Working on task...")
    fmt.Println("Task completed successfully")
    os.Exit(0)
}
```

**Coverage enforcement:**
```makefile
test:
    go test -coverprofile=coverage.out ./...
    go tool cover -func=coverage.out | grep total | awk '{print $$3}' | \
        awk -F% '{if ($$1 < 80) exit 1}'
```

## Decisions (Resolved)

1. **Daemon auto-start**: Only if `.coven/` exists. Explicit init required.

2. **Polling interval**: 1 second. Low overhead, responsive UI.
