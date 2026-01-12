# Change: Unified Daemon Store

## Why

The daemon's data layer has multiple sources of instability:

### Task Management Issues (Original Scope)
1. **Concurrency bugs** - Beads CLI calls race with each other during E2E tests
2. **Non-atomic claiming** - `bd update --status=in_progress` isn't a compare-and-swap
3. **External state management** - Truth lives in `.beads/` files, not in daemon memory
4. **Polling lag** - 1-second poll interval allows stale reads between scheduler ticks
5. **Test flakiness** - External process coordination makes E2E tests non-deterministic

### Broader Data Layer Issues (Extended Scope)
6. **Agent output lost on restart** - In-memory `RingBuffer` (10MB) is ephemeral
7. **Questions lost on restart** - In-memory question store is ephemeral
8. **Workflow state fragmentation** - Stored in separate `.coven/workflows/*.json` files with no transaction boundaries
9. **No audit trail** - SSE events are fire-and-forget, no replay capability
10. **Distributed state** - Multiple JSON files + in-memory caches create coordination nightmares
11. **Extension cache drift** - VS Code extension cache goes stale on SSE reconnection

Additionally, the current grimoire selection is simplistic (label or type mapping only), limiting workflow routing flexibility.

## What Changes

### Unified Store (`internal/store/`)

Single bbolt database at `.coven/coven.db` replaces all current state files:

| Current | Becomes |
|---------|---------|
| `.beads/issues.jsonl` (via CLI) | `tasks` bucket |
| `.coven/state.json` (agents map) | `agents` bucket |
| `.coven/workflows/*.json` | `workflows` bucket |
| In-memory RingBuffer | `output` bucket (metadata) + `.coven/output/*.jsonl` (content) |
| In-memory question store | `questions` bucket |
| Fire-and-forget SSE events | `events` bucket |

### Task Store (Original Scope)

- **ADDED** In-process bbolt-backed task store (`internal/store/tasks.go`)
- **ADDED** Hierarchical task tree with depth tracking (parent/child relationships)
- **ADDED** Mutable parent_id with automatic depth recalculation for subtrees
- **ADDED** Atomic task claiming via bbolt's serializable transactions
- **ADDED** Distinct error types: `ErrTaskNotFound`, `ErrAlreadyClaimed`, `ErrInvalidStatus`, `ErrWouldCreateCycle`
- **ADDED** Task tagging for grimoire routing (any_tags, all_tags, not_tags with doublestar glob)
- **ADDED** Stale claim recovery (auto-release claims older than configurable timeout)
- **ADDED** Audit history bucket for tracking status/claim/parent changes
- **ADDED** Soft delete with configurable retention (30 days default)
- **REMOVED** Beads CLI integration (`internal/beads/`)
- **REMOVED** Beads poller from daemon startup
- **REMOVED** Task dependencies (replaced by hierarchical parent-child model)
- **MODIFIED** Scheduler reads from in-process store instead of beads client
- **MODIFIED** HTTP handlers use task store instead of beads client

### Agent Store (Extended Scope)

- **ADDED** `agents` bucket storing agent metadata (status, PID, worktree, times)
- **ADDED** Atomic agent lifecycle transitions (starting → running → completed/failed/killed)
- **ADDED** Agent output file tracking (path to `.coven/output/{taskId}.jsonl`)
- **ADDED** Recovery: daemon restart can resume/reconnect based on persisted agent state
- **REMOVED** In-memory `DaemonState.Agents` map
- **REMOVED** `.coven/familiars/{taskId}.json` files
- **MODIFIED** ProcessManager writes agent state to store instead of memory
- **MODIFIED** Agent API reads from store

### Agent Output (Extended Scope)

- **ADDED** Persistent output files at `.coven/output/{taskId}.jsonl`
- **ADDED** `output` bucket tracking output metadata (line count, last sequence, file path)
- **ADDED** Output survives daemon restart (append-only JSONL files)
- **ADDED** Retention policy: output files deleted when agent record is purged
- **REMOVED** In-memory `RingBuffer` (10MB ephemeral buffer)
- **MODIFIED** Output streaming writes to file + broadcasts via SSE
- **MODIFIED** `/agents/{id}/output` API reads from file with `since` parameter for deltas

### Workflow Store (Extended Scope)

- **ADDED** `workflows` bucket storing full workflow state
- **ADDED** Atomic step transitions within workflow
- **ADDED** Step outputs stored in workflow record (enables template variable access)
- **ADDED** Cross-entity transactions (e.g., claim task + create workflow atomically)
- **REMOVED** `.coven/workflows/{taskId}.json` files
- **REMOVED** Separate `StatePersister` component
- **MODIFIED** Workflow engine writes state to store after each step
- **MODIFIED** Daemon restart loads workflow state from store

### Question Store (Extended Scope)

- **ADDED** `questions` bucket storing pending questions
- **ADDED** Questions survive daemon restart
- **ADDED** Atomic question lifecycle (created → answered → resolved)
- **REMOVED** In-memory question store (`internal/questions/store.go`)
- **MODIFIED** Question API reads/writes to store

### Event Log (Extended Scope)

- **ADDED** `events` bucket storing recent events per entity (task, agent, workflow)
- **ADDED** Events retained for configurable period (default: 24h)
- **ADDED** Extension can "catch up" on missed events after SSE reconnect
- **ADDED** Event replay API: `GET /events?since={timestamp}&entity={id}`
- **MODIFIED** Event broker writes to store before broadcasting via SSE

### Task HTTP API

- **ADDED** Full CRUD endpoints: `POST/GET/PATCH/DELETE /api/tasks`
- **ADDED** Lifecycle endpoints: `/claim`, `/release`, `/complete`, `/block`, `/unblock`
- **ADDED** Hierarchy endpoints: `/subtree`, `/ancestors`, `/children`, `/reparent`, `/subtasks`
- **ADDED** Tagging endpoints: `POST/PUT/DELETE /api/tasks/:id/tags`
- **ADDED** Query endpoints: `/api/tasks/ready`, filter params (status, priority, tag, tag_pattern)
- **ADDED** History endpoint: `GET /api/tasks/:id/history`
- **ADDED** Bulk operations: `POST /api/tasks/bulk` (add_tags, remove_tags, close, delete, set_priority)
- **ADDED** Consistent error response format with machine-readable codes
- **NOTE** Agents interact with tasks via this API (directly or via CLI wrapper)

### Grimoire Matching

- **ADDED** Configurable matcher pipeline in `.coven/grimoire-matchers.yaml`
- **ADDED** Tag matching with explicit semantics:
  - `any_tags`: OR semantics with glob patterns
  - `all_tags`: AND semantics (require all tags)
  - `not_tags`: Exclusion (veto match if present)
- **ADDED** Priority matching: list `priority: [0, 1]` or range `priority_range: [1, 3]`
- **ADDED** Content-based routing (`body_contains` - case-insensitive substring)
- **ADDED** Parent inheritance (child tasks inherit parent's grimoire assignment)
- **ADDED** Matcher debugging API: `GET /tasks/:id/grimoire-match`
- **ADDED** Matcher validation with clear error messages
- **ADDED** Hot reload of matcher config without daemon restart

## Impact

- **Affected specs:** task-management, agent-execution, agent-orchestration, session-management
- **Affected code:**
  - `internal/beads/` → removed
  - `internal/store/` → new package (unified bbolt store)
    - `store.go` - Store type, connection management, transactions
    - `tasks.go` - Task CRUD, claiming, hierarchy
    - `agents.go` - Agent lifecycle, output tracking
    - `workflows.go` - Workflow state persistence
    - `questions.go` - Question lifecycle
    - `events.go` - Event log and replay
    - `retention.go` - Cleanup policies
  - `internal/api/tasks/` → new package (HTTP handlers for all task endpoints)
  - `internal/api/events/` → new package (event replay endpoint)
  - `internal/scheduler/` → use unified store, periodic stale claim recovery
  - `internal/daemon/` → initialize store, remove beads poller
  - `internal/agent/buffer.go` → removed (replaced by file-based output)
  - `internal/agent/process.go` → write to store instead of memory
  - `internal/questions/store.go` → removed (replaced by store/questions.go)
  - `internal/state/store.go` → removed (replaced by unified store)
  - `internal/workflow/state.go` → removed (replaced by store/workflows.go)
  - `internal/api/events.go` → use store for event persistence
  - `internal/workflow/mapping.go` → matcher pipeline implementation
- **Breaking changes:**
  - Tasks no longer sync to/from beads
  - `bd` CLI no longer controls task lifecycle
  - New task management via daemon REST API only
  - `.coven/state.json` no longer used (migrated to `.coven/coven.db`)
  - `.coven/workflows/*.json` no longer used (migrated to `.coven/coven.db`)

## Key Design Decisions

### Task Store (Original)
1. **bbolt persistence** - Pure Go, ACID transactions with serializable isolation, no CGo dependency
2. **Mutable parent_id** - Tasks can be reparented; depth recalculated for subtree (O(n), acceptable for small trees)
3. **Cascade delete** - Deleting a parent deletes all descendants (no orphan re-parenting complexity)
4. **Separate Claim/ReClaim** - `Claim()` sets claimed_at, `ReClaim()` is idempotent no-op for same agent
5. **First-match-wins** - Matchers evaluated in order, debuggable via API, warning for unreachable matchers
6. **Soft delete retention** - 30-day retention, then 7-day soft delete grace period, then hard delete
7. **Doublestar glob syntax** - Tag patterns use `github.com/bmatcuk/doublestar` for familiar glob matching
8. **Dependencies removed** - Hierarchical parent-child model replaces explicit task dependencies

### Unified Store (Extended)
9. **Single bbolt database** - All metadata in `.coven/coven.db`; single source of truth
10. **Output in separate files** - Agent output stored in `.coven/output/{taskId}.jsonl` to avoid DB bloat
11. **Cross-entity transactions** - Claim task + create agent + start workflow in single atomic transaction
12. **Event log with retention** - Events stored 24h (configurable) for replay on reconnect
13. **Output file lifecycle** - Output files deleted when corresponding agent record is purged
14. **Daemon restart recovery** - All state recoverable from store; no lost context

See `design.md` for detailed rationale and alternatives considered.
