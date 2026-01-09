# Change: Add Coven Daemon (covend)

## Why

The VS Code extension currently handles agent orchestration, worktree management, and task scheduling directly. This creates several problems:
- Agents die when VS Code closes
- UI responsiveness suffers during heavy operations
- Difficult to test orchestration logic in isolation

Extracting orchestration to a daemon enables:
- Agents survive VS Code restarts
- Instant UI through cached state
- Clean separation of concerns
- Independent daemon E2E tests

## What Changes

- **NEW**: Monorepo structure with npm workspaces (`/packages/vscode`, `/packages/daemon`)
- **NEW**: `covend` daemon binary (Go) for agent orchestration
- **NEW**: Per-workspace daemon model (socket at `.coven/covend.sock`)
- **NEW**: HTTP-over-Unix-socket API for state queries and commands
- **NEW**: SSE event stream for real-time UI updates
- **NEW**: Extension bundles and auto-installs daemon binary
- Tasks from beads via `bd ready --json` (leverages beads caching + dependency resolution)

## Impact

- Affected specs: `agent-execution`, `session-management` (to be modified in follow-up)
- New spec: `daemon` (this change)
- Restructures entire codebase to monorepo

## Monorepo Structure

```
coven/
├── package.json              # Workspace root
├── packages/
│   ├── vscode/               # VS Code extension
│   │   ├── package.json
│   │   ├── src/
│   │   └── tsconfig.json
│   └── daemon/               # Go daemon (covend)
│       ├── go.mod
│       ├── cmd/covend/
│       ├── internal/
│       └── Makefile
├── openspec/
├── .beads/
└── CLAUDE.md
```

**Root package.json:**
```json
{
  "name": "coven",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "npm run build --workspaces",
    "test": "npm run test --workspaces",
    "build:daemon": "cd packages/daemon && make build",
    "test:daemon": "cd packages/daemon && make test"
  }
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Per-Workspace                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  .coven/                                                        │
│  ├── covend.sock          # Daemon socket                       │
│  ├── covend.pid           # PID file                            │
│  ├── covend.log           # Daemon logs                         │
│  ├── state.json           # Persisted state (recovery)          │
│  ├── config.json          # Session config (existing)           │
│  └── worktrees/           # Agent worktrees (existing)          │
│                                                                 │
│  .beads/                                                        │
│  └── (beads manages this)  # Source of truth for tasks          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         Consumer                                │
├─────────────────────────────────────────────────────────────────┤
│                    VS Code Extension                            │
│                      (primary UI)                               │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Unix socket (.coven/covend.sock)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                         covend                                  │
├─────────────────────────────────────────────────────────────────┤
│  • Scheduler: reconciles desired vs actual agent state          │
│  • Agent Pool: spawns/monitors/kills claude processes           │
│  • State Cache: instant queries, rebuilt on changes             │
│  • Beads Client: calls `bd ready --json` for ready tasks        │
│  • Event Emitter: SSE for real-time updates                     │
│  • Worktree Manager: creates/cleans git worktrees               │
└─────────────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   ┌─────────┐        ┌─────────┐        ┌─────────┐
   │ Agent 1 │        │ Agent 2 │        │ Agent N │
   │(worktree)│       │(worktree)│       │(worktree)│
   └─────────┘        └─────────┘        └─────────┘
```

## Consumer UX Details

### VS Code Extension Flow

**On workspace open:**
```
1. Check if .coven/ exists (coven-enabled workspace)
2. If not, show "Initialize Coven" welcome view
3. If yes, connect to .coven/covend.sock
   - Check daemon version via GET /version
   - If version mismatch: kill existing daemon, start new one
   - If connection fails: auto-start daemon (transparent to user)
   - Wait for socket to be available (poll, max 5s)
4. Subscribe to SSE event stream: GET /events
5. Fetch initial state: GET /state
6. Render UI from cached state (instant)
```

**Daemon auto-start (transparent):**
```
User opens workspace with .coven/
Extension checks socket → not responding
Extension spawns: covend --workspace=/path/to/repo
Extension waits for socket (poll every 100ms, max 5s)
Extension connects and continues
User sees no indication this happened (seamless)
```

**Daemon version update:**
```
Extension connects, calls GET /version
Version differs from bundled version
Extension calls POST /shutdown
Extension waits for process to exit
Extension spawns new daemon from bundled binary
Extension reconnects
User sees no interruption (agents are stopped/restarted)
```

**Sidebar rendering:**
```
Extension maintains local cache of RepoState
On SSE event:
  - Update local cache
  - Trigger TreeDataProvider refresh

TreeDataProvider.getChildren():
  - Read from local cache (sync, instant)
  - Never blocks on daemon call

Result: UI feels instant, no spinners for state queries
```

**Starting a session:**
```
User clicks "Start Session" button
Extension calls: POST /session/start {featureBranch: "my-feature", maxAgents: 3}
Daemon:
  - Sets started=true
  - Runs scheduler loop
  - Emits event: session.started
Extension receives SSE, updates UI
```

**Task lifecycle (user perspective):**
```
1. User creates task in beads: bd create "Add login form"
2. Daemon polling detects change via `bd ready --json`
3. Daemon updates task cache
4. Daemon emits: tasks.changed
5. Extension receives SSE, refreshes task list
6. If session started && agent slot available:
   - Scheduler assigns task to agent
   - Daemon spawns claude in worktree
   - Emits: agent.spawned
7. Extension shows task as "working" with live output
```

**Agent output streaming:**
```
Extension subscribes to SSE, receives:
  event: agent.output
  data: {"agentId":"a1","chunk":"Reading file...","seq":42}

Extension appends to output channel
User sees real-time agent activity
```

**Agent question handling:**
```
Daemon detects question in agent output
Emits: agent.question {agentId, question, options}
Extension shows notification/modal
User responds
Extension calls: POST /agents/:id/respond {response: "yes"}
Daemon writes to agent stdin
Agent continues
```

**Stopping session:**
```
User clicks "Stop Session"
Extension calls: POST /session/stop
Daemon:
  - Sends SIGTERM to all agents
  - Waits for graceful shutdown (10s)
  - Kills remaining agents
  - Sets started=false
  - Emits: session.stopped
Extension updates UI to inactive state
```

### Beads Integration

**Using `bd ready --json`:**
```
Daemon calls: bd ready --json --db .beads/beads.db
Returns: tasks that are ready to work (deps satisfied, not blocked)

Benefits:
- Beads handles dependency resolution
- Beads handles caching (SQLite)
- Stable CLI interface (less likely to change than file format)
- No need to parse .beads/issues.jsonl directly
- Watch for race condition given beads and us are listening to the same file change
```

**Polling strategy:**
```
On session start:
  - Immediate poll: bd ready --json
  - Start polling loop: every 1 second

On task state change (agent complete/fail):
  - Immediate poll to refresh

On session stop:
  - Stop polling loop
```

**Task state updates:**
```
When agent starts task:
  - Daemon calls: bd update <taskId> --status=in_progress

When agent completes:
  - Daemon calls: bd update <taskId> --status=review

When agent fails:
  - Daemon calls: bd update <taskId> --label=blocked
```

### E2E Test Scenarios

**Daemon E2E tests (independent of VS Code):**
```go
func TestAgentSpawnsOnStart(t *testing.T) {
    // Setup: create temp repo with beads task
    repo := createTestRepo(t)
    createBeadsTask(repo, "Test task")

    // Start daemon
    daemon := startDaemon(t, repo)
    defer daemon.Stop()

    // Start session
    resp := daemon.POST("/session/start", SessionConfig{
        FeatureBranch: "test-branch",
        MaxAgents: 1,
    })
    assert.Equal(t, 200, resp.Status)

    // Wait for agent spawn event
    event := daemon.WaitForEvent("agent.spawned", 10*time.Second)
    assert.NotNil(t, event)

    // Verify worktree created
    assert.DirExists(t, filepath.Join(repo, ".coven/worktrees", event.TaskID))
}

func TestAgentCompletesTask(t *testing.T) {
    // Use mock agent that completes immediately
    // Verify task transitions: ready -> working -> review
}

func TestGracefulShutdown(t *testing.T) {
    // Start agent, then stop session
    // Verify SIGTERM sent, agent exits cleanly
}

func TestBeadsIntegration(t *testing.T) {
    // Create task via bd create
    // Start daemon and session
    // Verify daemon picks up task via bd ready --json
}
```

**Extension E2E tests (unchanged from current, but now talk to daemon):**
```typescript
test('starting session spawns agents for ready tasks', async () => {
    // Setup workspace with beads tasks
    await setupTestWorkspace()

    // Start session via command
    await vscode.commands.executeCommand('coven.startSession', {
        featureBranch: 'test-branch'
    })

    // Verify UI shows working tasks
    await waitForCondition(() => {
        const tasks = getVisibleTasks()
        return tasks.some(t => t.status === 'working')
    })
})
```

## API Reference

### Socket Location
```
${workspaceRoot}/.coven/covend.sock
```

### Endpoints

```
# ─── Session Control ─────────────────────────────────────
POST   /session/start           Start session (started=true)
       Body: {featureBranch: string, maxAgents?: number}

POST   /session/stop            Stop session gracefully
POST   /session/stop?force=1    Force stop (kill agents immediately)

# ─── State Queries (cached, instant) ─────────────────────
GET    /state                   Full state snapshot
GET    /tasks                   Task list (from bd ready cache)
GET    /agents                  Running agents
GET    /questions               Pending questions

# ─── Task Operations ─────────────────────────────────────
POST   /tasks/:taskId/start     Force-start specific task
POST   /tasks/:taskId/stop      Stop task's agent

# ─── Agent Interaction ───────────────────────────────────
POST   /agents/:agentId/respond Answer question
       Body: {response: string}

POST   /agents/:agentId/kill    Terminate agent
GET    /agents/:agentId/output  Get output buffer
       Query: ?since=<seq>      Get output after sequence number

# ─── Event Stream ────────────────────────────────────────
GET    /events                  SSE stream

# ─── Daemon Management ───────────────────────────────────
GET    /health                  Liveness check
GET    /version                 Daemon version info
POST   /shutdown                Graceful daemon shutdown
```

### SSE Events

```
event: session.started
data: {"featureBranch":"my-feature","maxAgents":3}

event: session.stopped
data: {"reason":"user_request"}

event: tasks.changed
data: {"tasks":[...]}  # Full task list from bd ready

event: agent.spawned
data: {"agentId":"claude-1","taskId":"beads-a1b2","worktree":"/path"}

event: agent.output
data: {"agentId":"claude-1","chunk":"Writing...","seq":42}

event: agent.question
data: {"agentId":"claude-1","question":"Install lodash?","type":"permission","options":["yes","no"]}

event: agent.completed
data: {"agentId":"claude-1","taskId":"beads-a1b2","result":"success","changedFiles":["src/Login.tsx"]}

event: agent.failed
data: {"agentId":"claude-1","taskId":"beads-a1b2","error":"Timeout after 10m"}

event: state.snapshot
data: {<full RepoState>}  # Sent periodically (every 30s) as heartbeat/recovery
```

### State Schema

```typescript
interface RepoState {
  session: {
    started: boolean
    featureBranch: string | null
    maxAgents: number
    startedAt: string | null  // ISO timestamp
  }

  tasks: Task[]  // From bd ready --json, cached

  agents: Agent[]

  pendingQuestions: Question[]

  stats: {
    ready: number
    working: number
    review: number
    done: number
    blocked: number
  }

  daemon: {
    version: string
    pid: number
    uptime: number  // seconds
    lastBeadsSync: string  // ISO timestamp
  }
}

interface Agent {
  id: string
  taskId: string
  worktreePath: string
  pid: number
  status: 'starting' | 'running' | 'stopping'
  startedAt: string
  lastOutput: string  // Last line of output (for status display)
  outputSeq: number   // Current output sequence number
}

interface Question {
  agentId: string
  taskId: string
  type: 'clarification' | 'permission' | 'decision' | 'blocked'
  question: string
  options: string[]
  askedAt: string
}
```

## Installation

### Extension Bundling (Primary)

```
Extension package includes:
  - covend-darwin-arm64
  - covend-darwin-amd64
  - covend-linux-amd64
  - covend-linux-arm64

On activation:
  1. Extract bundled binary to ~/.coven/bin/covend
  2. On version mismatch: kill existing, extract new, restart
  3. Invoke directly from known path
```

### Standalone Install (Optional)

```bash
# Install script (downloads from GitHub releases)
curl -fsSL https://coven.dev/install.sh | sh

# Installs to ~/.coven/bin/covend
```

### Build

```bash
# In packages/daemon/ directory
make build           # Build for current platform
make build-all       # Cross-compile all platforms
make test            # Run tests
make test-e2e        # Run E2E tests
```

## Daemon Directory Structure

```
packages/daemon/
├── cmd/
│   └── covend/
│       └── main.go
├── internal/
│   ├── api/              # HTTP handlers
│   │   ├── server.go
│   │   ├── session.go
│   │   ├── tasks.go
│   │   ├── agents.go
│   │   └── events.go
│   ├── scheduler/        # Task scheduling
│   │   └── scheduler.go
│   ├── agent/            # Agent process management
│   │   ├── manager.go
│   │   ├── process.go
│   │   └── output.go
│   ├── beads/            # Beads CLI integration
│   │   └── client.go     # Wraps bd ready --json
│   ├── git/              # Worktree management
│   │   └── worktree.go
│   ├── state/            # State management
│   │   ├── store.go
│   │   └── persist.go
│   └── config/           # Configuration
│       └── config.go
├── pkg/
│   └── types/            # Shared types
│       └── types.go
├── go.mod
├── go.sum
└── Makefile
```
