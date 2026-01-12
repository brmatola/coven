# Change: Add In-Process Task Store

## Why

The current beads integration shells out to the `bd` CLI for every task operation, causing:
1. **Concurrency bugs** - CLI calls race with each other during E2E tests
2. **Non-atomic claiming** - `bd update --status=in_progress` isn't a compare-and-swap
3. **External state management** - Truth lives in `.beads/` files, not in daemon memory
4. **Polling lag** - 1-second poll interval allows stale reads between scheduler ticks
5. **Test flakiness** - External process coordination makes E2E tests non-deterministic

Additionally, the current grimoire selection is simplistic (label or type mapping only), limiting workflow routing flexibility.

## What Changes

### Task Store

- **ADDED** In-process bbolt-backed task store (`internal/taskstore/`)
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

- **Affected specs:** task-management, agent-orchestration
- **Affected code:**
  - `internal/beads/` → removed
  - `internal/taskstore/` → new package (bbolt store, all task operations)
  - `internal/api/tasks/` → new package (HTTP handlers for all task endpoints)
  - `internal/scheduler/` → use task store, periodic stale claim recovery
  - `internal/daemon/` → initialize task store, remove beads poller
  - `internal/api/` → register task routes, add grimoire-match endpoint
  - `internal/workflow/mapping.go` → matcher pipeline implementation
- **Breaking changes:**
  - Tasks no longer sync to/from beads
  - `bd` CLI no longer controls task lifecycle
  - New task management via daemon REST API only

## Key Design Decisions

1. **bbolt persistence** - Pure Go, ACID transactions with serializable isolation, no CGo dependency
2. **Mutable parent_id** - Tasks can be reparented; depth recalculated for subtree (O(n), acceptable for small trees)
3. **Cascade delete** - Deleting a parent deletes all descendants (no orphan re-parenting complexity)
4. **Separate Claim/ReClaim** - `Claim()` sets claimed_at, `ReClaim()` is idempotent no-op for same agent
5. **First-match-wins** - Matchers evaluated in order, debuggable via API, warning for unreachable matchers
6. **Soft delete retention** - 30-day retention, then 7-day soft delete grace period, then hard delete
7. **Doublestar glob syntax** - Tag patterns use `github.com/bmatcuk/doublestar` for familiar glob matching
8. **Dependencies removed** - Hierarchical parent-child model replaces explicit task dependencies

See `design.md` for detailed rationale and alternatives considered.
