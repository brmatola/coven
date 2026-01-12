# Design: In-Process Task Store

## Context

Coven needs a task management layer that:
1. Survives daemon restarts
2. Handles concurrent agent access without race conditions
3. Supports hierarchical task decomposition
4. Enables sophisticated grimoire routing

The current beads integration shells out to a CLI, which introduces process coordination overhead and race conditions.

## Goals

- **Atomic operations**: No race conditions when multiple agents claim tasks
- **Fast**: In-memory with disk persistence, not subprocess calls
- **Hierarchical**: Tasks form trees (epics → features → tasks → subtasks)
- **Flexible routing**: Rich grimoire matching beyond simple labels
- **Testable**: Deterministic behavior for E2E tests
- **Pure Go**: No CGo dependency for simpler cross-compilation

## Non-Goals

- Syncing with external issue trackers (GitHub Issues, Linear, etc.)
- Multi-daemon coordination (single daemon per workspace assumed)
- Real-time collaboration (tasks are daemon-local)

## Decisions

### Decision 1: bbolt for Persistence

**Choice**: bbolt database at `.coven/tasks.db`

**Alternatives considered**:
- JSONL files (like beads): No transactional guarantees, complex locking
- In-memory only: Lost on restart
- SQLite: Requires CGo (or slower pure-Go reimplementation), overkill for our query patterns
- badger: More complex, LSM-tree optimized for write-heavy workloads we don't have

**Rationale**: bbolt is pure Go, provides ACID transactions with serializable isolation, and uses a simple B+ tree structure. Our task counts are small (hundreds, not millions), so in-memory tree traversal after loading is efficient. Single-file deployment. Battle-tested (used by etcd, Consul, InfluxDB).

### Decision 2: Hierarchical Task Model

**Choice**: Adjacency list with `parent_id` field, JSON-serialized structs in bbolt buckets

```go
// Bucket structure in bbolt
// "tasks"     -> task_id -> JSON(Task)
// "tags"      -> task_id -> JSON([]string)
// "children"  -> parent_id -> JSON([]child_id)  // denormalized for fast child lookup
// "history"   -> task_id/timestamp -> JSON(HistoryEntry)

type Task struct {
    ID           string     `json:"id"`
    ParentID     string     `json:"parent_id,omitempty"`
    Depth        int        `json:"depth"`
    Title        string     `json:"title"`
    Body         string     `json:"body,omitempty"`
    Type         string     `json:"type"`          // "task", "feature", "bug"
    Status       string     `json:"status"`        // "open", "in_progress", "pending_merge", "blocked", "closed"
    Priority     int        `json:"priority"`      // 0-4 (P0=critical, P4=backlog)
    ClaimedBy    string     `json:"claimed_by,omitempty"`
    ClaimedAt    *time.Time `json:"claimed_at,omitempty"`
    GrimoireHint string     `json:"grimoire_hint,omitempty"`
    CreatedAt    time.Time  `json:"created_at"`
    UpdatedAt    time.Time  `json:"updated_at"`
    DeletedAt    *time.Time `json:"deleted_at,omitempty"`  // Soft delete
}

type HistoryEntry struct {
    TaskID    string    `json:"task_id"`
    Field     string    `json:"field"`      // "status", "claimed_by", "parent_id", etc.
    OldValue  string    `json:"old_value"`
    NewValue  string    `json:"new_value"`
    ChangedAt time.Time `json:"changed_at"`
    ChangedBy string    `json:"changed_by"` // agent ID, "user", or "system"
}
```

**Key constraints**:
- `parent_id` change triggers depth recalculation for task and all descendants
- `priority` is bounded 0-4 (validated in Go, not schema)
- `depth` is denormalized, recomputed on parent change (O(n) for subtree, acceptable for small trees)
- Self-reference (`id == parent_id`) rejected in code
- Empty tags rejected in code
- Circular parent references detected and rejected

**parent_id mutability**:
- `parent_id` CAN be changed after creation via `Reparent(taskID, newParentID)`
- When parent changes, depth is recalculated for the task and all descendants
- This is O(n) where n = subtree size, which is acceptable for our scale
- Reparenting preserves all other task properties
- Cannot reparent to a descendant (would create cycle)

**Alternatives considered**:
- Nested sets: Complex updates when tree structure changes
- Materialized paths: String manipulation, path updates expensive
- Closure table: Extra data structure, more complex

**Rationale**: Adjacency list is simplest. Tree queries are done in-memory after loading all tasks (hundreds, not millions). The `depth` field avoids computing depth on every query. The `children` bucket provides O(1) child lookup without scanning all tasks.

### Decision 3: Compare-and-Swap Claiming

**Choice**: Atomic claim within bbolt transaction

```go
func (s *Store) Claim(ctx context.Context, taskID, agentID string) error {
    now := time.Now()

    return s.db.Update(func(tx *bbolt.Tx) error {
        tasks := tx.Bucket([]byte("tasks"))

        data := tasks.Get([]byte(taskID))
        if data == nil {
            return ErrTaskNotFound
        }

        var task Task
        if err := json.Unmarshal(data, &task); err != nil {
            return fmt.Errorf("unmarshal task: %w", err)
        }

        // CAS check within transaction
        if task.ClaimedBy != "" {
            return ErrAlreadyClaimed
        }
        if task.Status != "open" {
            return ErrInvalidStatus
        }

        // Update task
        task.ClaimedBy = agentID
        task.ClaimedAt = &now
        task.Status = "in_progress"
        task.UpdatedAt = now

        data, err := json.Marshal(task)
        if err != nil {
            return err
        }
        if err := tasks.Put([]byte(taskID), data); err != nil {
            return err
        }

        // Log history entries
        s.logHistoryTx(tx, taskID, "claimed_by", "", agentID, agentID)
        s.logHistoryTx(tx, taskID, "status", "open", "in_progress", agentID)

        return nil
    })
}

// Idempotent re-claim for same agent (no-op if already claimed by this agent)
func (s *Store) ReClaim(ctx context.Context, taskID, agentID string) error {
    return s.db.View(func(tx *bbolt.Tx) error {
        tasks := tx.Bucket([]byte("tasks"))

        data := tasks.Get([]byte(taskID))
        if data == nil {
            return ErrTaskNotFound
        }

        var task Task
        if err := json.Unmarshal(data, &task); err != nil {
            return err
        }

        if task.Status != "in_progress" {
            return ErrTaskNotFound
        }
        if task.ClaimedBy != agentID {
            return ErrAlreadyClaimed
        }

        // Already claimed by this agent - no-op
        return nil
    })
}
```

**Key behaviors**:
- Claiming requires `status = 'open'` AND `claimed_by == ""`
- Can't claim a `blocked`, `pending_merge`, or `closed` task
- Re-claim is a separate read-only operation that doesn't update `claimed_at`
- Distinct error types: `ErrTaskNotFound`, `ErrAlreadyClaimed`, `ErrInvalidStatus`
- All claims are logged to history bucket

**Rationale**: bbolt transactions are serializable - only one write transaction can execute at a time. The read-check-write within a single `Update()` call is atomic. No race conditions possible.

### Decision 3a: Stale Claim Recovery

**Choice**: Automatic release of claims older than configurable timeout

```go
// ReleaseStaleClaims releases claims older than the timeout (default: 30 minutes)
func (s *Store) ReleaseStaleClaims(ctx context.Context, timeout time.Duration) (int64, error) {
    cutoff := time.Now().Add(-timeout)
    now := time.Now()
    var count int64

    err := s.db.Update(func(tx *bbolt.Tx) error {
        tasks := tx.Bucket([]byte("tasks"))

        return tasks.ForEach(func(k, v []byte) error {
            var task Task
            if err := json.Unmarshal(v, &task); err != nil {
                return nil // Skip malformed entries
            }

            if task.Status != "in_progress" || task.ClaimedAt == nil {
                return nil
            }

            if task.ClaimedAt.Before(cutoff) {
                oldClaimedBy := task.ClaimedBy
                task.ClaimedBy = ""
                task.ClaimedAt = nil
                task.Status = "open"
                task.UpdatedAt = now

                data, err := json.Marshal(task)
                if err != nil {
                    return err
                }
                if err := tasks.Put(k, data); err != nil {
                    return err
                }

                s.logHistoryTx(tx, task.ID, "claimed_by", oldClaimedBy, "", "system")
                s.logHistoryTx(tx, task.ID, "status", "in_progress", "open", "system")
                count++
            }
            return nil
        })
    })

    if count > 0 {
        s.logger.Warn("released stale claims", "count", count, "timeout", timeout)
    }
    return count, err
}
```

**When it runs**:
- On daemon startup (recover from crash)
- Periodically during scheduler tick (every 5 minutes)
- Configurable timeout via `.coven/config.yaml`: `claim_timeout: 30m`

**Rationale**: If daemon crashes with a claimed task, the task would be stuck forever without this. The timeout should be longer than the longest expected agent run.

### Decision 4: Grimoire Matcher Pipeline

**Choice**: Ordered list of matchers, first match wins

```yaml
# .coven/grimoire-matchers.yaml
matchers:
  - name: security-review
    grimoire: security-audit
    match:
      any_tags: ["security", "auth*"]  # OR: match if ANY tag matches glob
      body_contains: ["CVE-", "vulnerability"]  # case-insensitive substring

  - name: critical-non-docs
    grimoire: fast-track
    match:
      priority: [0, 1]
      not_tags: ["docs", "wip"]  # Exclude if task has these tags

  - name: frontend-and-performance
    grimoire: perf-audit
    match:
      all_tags: ["frontend", "performance"]  # AND: require ALL tags

  - name: docs-only
    grimoire: documentation
    match:
      any_tags: ["docs", "documentation"]
      type: ["task"]

  - name: inherit-parent
    inherit: true
    match:
      has_parent: true

  - name: default
    grimoire: implement-bead
    match: {}  # Matches everything
```

**Matcher fields** (all conditions within a matcher are AND'd together):
- `any_tags`: Glob patterns - matches if task has ANY matching tag (OR semantics)
- `all_tags`: Glob patterns - matches only if task has ALL listed tags (AND semantics)
- `not_tags`: Glob patterns - fails match if task has ANY of these tags (exclusion)
- `priority`: List of priority levels (0-4)
- `priority_range`: `[min, max]` inclusive range (alternative to listing)
- `type`: Task types (feature, bug, task)
- `body_contains`: Case-insensitive substrings to find in task body (OR semantics)
- `has_parent`: Boolean, true if task has a parent
- `labels`: Legacy support for `grimoire:X` labels (deprecated, use tags)

**Glob syntax** (using `github.com/bmatcuk/doublestar/v4`):
- `*` matches any sequence of non-separator characters
- `**` matches any sequence including separators (for hierarchical tags like `area/frontend`)
- `?` matches any single non-separator character
- `[abc]` matches any character in the set
- `[a-z]` matches any character in the range
- `{foo,bar}` matches any of the comma-separated patterns
- Examples: `auth*` matches `auth`, `authentication`, `auth-service`
- Examples: `area/**` matches `area/frontend`, `area/backend/api`

**Matching semantics**:
- Within a single matcher, all specified fields must match (AND)
- Within `any_tags`, `body_contains`: any item matching is sufficient (OR)
- Within `all_tags`: all items must match (AND)
- `not_tags` is evaluated last and can veto an otherwise-matching rule
- First matcher to fully match wins; no scoring or weighting

**Alternatives considered**:
- Expression language (CEL, etc.): Overkill, harder to validate
- Hard-coded rules: Not flexible enough
- Scoring system: Complex, harder to debug "why did this match?"

**Rationale**: YAML config with first-match-wins is debuggable. Users can add a catch-all default at the end. Explicit `any_tags` vs `all_tags` avoids ambiguity. Negation via `not_tags` handles common exclusion patterns.

### Decision 5: Task Status State Machine

**Choice**: Strict transitions enforced in Go

```
                    ┌──────────────┐
                    │              │
     ┌──────────────▼──────────┐   │
     │          open           │   │
     └──────────────┬──────────┘   │
                    │ claim()      │
     ┌──────────────▼──────────┐   │ release()
     │       in_progress       │───┘
     └──────────────┬──────────┘
                    │ complete() / block()
          ┌─────────┴─────────┐
          │                   │
┌─────────▼────────┐  ┌───────▼────────┐
│    pending_merge │  │     blocked    │
└─────────┬────────┘  └───────┬────────┘
          │ approve()         │ unblock()
          │ reject()──────────┤
          │                   │
┌─────────▼────────┐          │
│      closed      │◀─────────┘
└──────────────────┘
```

**Status definitions**:
- `open`: Available for claiming
- `in_progress`: Claimed by an agent
- `blocked`: Requires manual intervention
- `pending_merge`: Awaiting merge approval
- `closed`: Completed

**Transition notes**:
- `in_progress → closed` is valid for grimoires without merge steps (e.g., simple automation)
- `in_progress → pending_merge` is the expected path for grimoires with `require_review: true`

**Rationale**: Matches current workflow semantics. Explicit state machine prevents invalid transitions.

### Decision 6: Transaction Boundaries

**Choice**: bbolt's transaction model (read-only `View` or read-write `Update`)

```go
// All write operations use db.Update() which is auto-committed on return
store.Create(ctx, task)           // db.Update internally
store.UpdateStatus(ctx, id, "blocked")  // db.Update internally
store.AddTags(ctx, id, tags)      // db.Update internally

// Compound operations just use a single Update with multiple bucket operations
func (s *Store) ClaimWithTags(ctx context.Context, taskID, agentID string, tags []string) error {
    return s.db.Update(func(tx *bbolt.Tx) error {
        // All operations in one transaction
        if err := s.claimTx(tx, taskID, agentID); err != nil {
            return err
        }
        return s.addTagsTx(tx, taskID, tags)
    })
}

// Read operations use db.View (can run concurrently)
store.Get(ctx, taskID)            // db.View internally
store.GetReady(ctx)               // db.View internally
```

**What must be atomic**:
- Claim: status change + claimed_by update + history logging
- Release: status change + claimed_by clear + history logging
- Delete: task deletion + children bucket update + tags + history
- Reparent: parent_id change + depth recalculation for subtree

**Concurrency model**:
- bbolt allows unlimited concurrent `View` (read) transactions
- Only one `Update` (write) transaction can run at a time
- Write transactions block other writes but not reads
- This is sufficient for single-daemon operation

**Rationale**: bbolt's transaction model is simpler than explicit begin/commit. Each `Update` call is atomic. Multiple goroutines can call `Update` concurrently; bbolt serializes them internally.

### Decision 7: Database Maintenance

**Choice**: Automatic retention with soft delete for closed tasks

```go
// SoftDeleteOldTasks marks closed tasks older than retention period
func (s *Store) SoftDeleteOldTasks(ctx context.Context, retention time.Duration) (int64, error) {
    cutoff := time.Now().Add(-retention)
    now := time.Now()
    var count int64

    return count, s.db.Update(func(tx *bbolt.Tx) error {
        tasks := tx.Bucket([]byte("tasks"))
        return tasks.ForEach(func(k, v []byte) error {
            var task Task
            if err := json.Unmarshal(v, &task); err != nil {
                return nil
            }
            if task.Status == "closed" && task.DeletedAt == nil && task.UpdatedAt.Before(cutoff) {
                task.DeletedAt = &now
                data, _ := json.Marshal(task)
                tasks.Put(k, data)
                count++
            }
            return nil
        })
    })
}

// HardDeleteExpiredTasks permanently removes soft-deleted tasks
func (s *Store) HardDeleteExpiredTasks(ctx context.Context, grace time.Duration) (int64, error) {
    cutoff := time.Now().Add(-grace)
    var count int64

    return count, s.db.Update(func(tx *bbolt.Tx) error {
        tasks := tx.Bucket([]byte("tasks"))
        tags := tx.Bucket([]byte("tags"))
        children := tx.Bucket([]byte("children"))
        history := tx.Bucket([]byte("history"))

        var toDelete [][]byte
        tasks.ForEach(func(k, v []byte) error {
            var task Task
            if err := json.Unmarshal(v, &task); err != nil {
                return nil
            }
            if task.DeletedAt != nil && task.DeletedAt.Before(cutoff) {
                toDelete = append(toDelete, k)
            }
            return nil
        })

        for _, k := range toDelete {
            tasks.Delete(k)
            tags.Delete(k)
            children.Delete(k)
            // Delete history entries with task_id prefix
            s.deleteHistoryForTaskTx(tx, string(k))
            count++
        }
        return nil
    })
}
```

**Retention policy**:
- Closed tasks: retained 30 days, then soft-deleted
- Soft-deleted tasks: hard-deleted after 7 more days (total 37 days)
- History records: deleted with their task
- No VACUUM needed - bbolt reuses freed pages automatically

**Configuration** (`.coven/config.yaml`):
```yaml
task_store:
  retention_days: 30        # How long to keep closed tasks
  soft_delete_days: 7       # How long to keep soft-deleted tasks
```

**Rationale**: Soft delete allows recovery of accidentally closed tasks. Hard delete after grace period keeps DB size bounded. bbolt handles page reclamation internally (no explicit VACUUM needed).

## Risks / Trade-offs

### Risk: Data Loss on Corruption
bbolt files can corrupt on hard crashes during writes (rare but possible).

**Mitigation**: bbolt is copy-on-write with checksums. Corruption is detectable. Consider periodic backup to `.coven/tasks.db.bak` on graceful shutdown.

### Risk: Single-Daemon Assumption
This design assumes one daemon per workspace.

**Mitigation**: bbolt uses file locking - only one process can open the DB for writing. Concurrent daemon starts will fail with clear error message.

### Trade-off: No External Sync
Tasks are local to the daemon, not synced to GitHub/Linear.

**Justification**: Sync is a separate concern. Can be added later as an integration layer.

### Trade-off: Write Serialization
bbolt serializes all write transactions. High write contention would bottleneck.

**Mitigation**: Our use case is low-write (task creates, claims, status updates). Single scheduler means minimal write contention. Not a concern for expected load.

### Trade-off: No SQL
Cannot run ad-hoc SQL queries for debugging.

**Mitigation**: Add CLI commands for common queries (`coven tasks list`, `coven tasks tree <id>`). For debugging, use `bbolt` CLI or build an export-to-JSON utility.

## Implementation Plan

1. Add `internal/taskstore/` with bbolt-backed Store implementation
   - Task CRUD operations
   - Claiming/releasing with atomic transactions
   - Tree operations (subtree, ancestors, reparent)
   - Tag management
   - History logging
   - Retention/cleanup

2. Add `internal/api/tasks/` HTTP handlers
   - CRUD: POST/GET/PATCH/DELETE /api/tasks
   - Lifecycle: /claim, /release, /complete, /block, /unblock
   - Hierarchy: /subtree, /ancestors, /children, /reparent
   - Tags: POST/PUT/DELETE /api/tasks/:id/tags
   - Query: /api/tasks/ready, filter parameters
   - Bulk: POST /api/tasks/bulk
   - History: GET /api/tasks/:id/history

3. Add matcher config loading to `internal/workflow/`
   - YAML parser for grimoire-matchers.yaml
   - Matcher evaluation engine with doublestar glob
   - Hot reload support

4. Update scheduler to use task store
   - Replace beads client calls with taskstore calls
   - Add periodic stale claim recovery

5. Remove `internal/beads/` package

6. Remove beads poller from daemon startup

7. (Future) Add CLI wrapper for task API
   - `coven task create`, `coven task list`, etc.
   - For agent use when HTTP calls are awkward

## Answered Questions

### Q: Should closed tasks be automatically archived/deleted after N days?
**A**: Yes. 30-day retention, then soft-delete, then hard-delete after 7 more days. Configurable.

### Q: Should we support task "templates" for common patterns?
**A**: Deferred. Not in scope for initial implementation. Can add later via `task_templates` table.

### Q: How should subtask completion affect parent task status?
**A**: No automatic propagation. Parent status is independent. Reasoning: a parent epic shouldn't auto-close just because one subtask finished. Users can build this into grimoires if desired.
