# Design: Unified Daemon Store

## Context

Coven's daemon needs a unified data layer that:
1. Survives daemon restarts without losing state
2. Handles concurrent access without race conditions
3. Provides ACID transactions across related entities
4. Supports recovery and replay on reconnection

The current architecture suffers from:
- Beads CLI shells out for every task operation (race conditions, slow)
- Agent output in ephemeral memory (lost on restart)
- Workflow state in separate JSON files (no cross-entity transactions)
- Questions in memory (lost on restart)
- Events fire-and-forget (no replay, no audit trail)

## Goals

- **Single source of truth**: One bbolt database for all daemon metadata
- **Atomic operations**: No race conditions on claims, status changes
- **Crash recovery**: Daemon restart recovers full state
- **Event replay**: Extension can catch up after SSE reconnect
- **Fast**: In-process queries, no subprocess calls
- **Testable**: Deterministic behavior for E2E tests
- **Pure Go**: No CGo dependency for simpler cross-compilation

## Non-Goals

- Syncing with external issue trackers (GitHub Issues, Linear, etc.)
- Multi-daemon coordination (single daemon per workspace assumed)
- Real-time collaboration (state is daemon-local)
- Storing large output blobs in bbolt (use files instead)

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

### Decision 8: Agent Store

**Choice**: Store agent metadata in `agents` bucket, output in separate files

```go
// agents bucket: task_id -> JSON(Agent)
type Agent struct {
    TaskID      string     `json:"task_id"`
    StepTaskID  string     `json:"step_task_id,omitempty"` // for multi-step workflows
    Status      string     `json:"status"`  // starting, running, completed, failed, killed
    Worktree    string     `json:"worktree"`
    Branch      string     `json:"branch"`
    PID         int        `json:"pid,omitempty"`
    ExitCode    *int       `json:"exit_code,omitempty"`
    Error       string     `json:"error,omitempty"`
    OutputFile  string     `json:"output_file"`  // path to .coven/output/{taskId}.jsonl
    LineCount   int64      `json:"line_count"`   // total output lines
    LastSeq     uint64     `json:"last_seq"`     // sequence for delta queries
    StartedAt   time.Time  `json:"started_at"`
    EndedAt     *time.Time `json:"ended_at,omitempty"`
}
```

**Status state machine**:
```
starting → running → completed
                  → failed
                  → killed
```

**Output file format** (`.coven/output/{taskId}.jsonl`):
```jsonl
{"seq":1,"ts":"2024-01-15T10:00:00Z","stream":"stdout","data":"Starting task..."}
{"seq":2,"ts":"2024-01-15T10:00:01Z","stream":"stdout","data":"Reading file..."}
{"seq":3,"ts":"2024-01-15T10:00:02Z","stream":"stderr","data":"Warning: deprecated API"}
```

**Key behaviors**:
- Agent record created atomically with task claim
- Output appended to JSONL file (no buffering loss)
- `LineCount` and `LastSeq` updated periodically (batch updates to reduce writes)
- Output file deleted when agent record is purged

**Rationale**: Output can be 10MB+ per agent. Storing in bbolt would bloat the DB and cause write contention. JSONL files are:
- Append-only (fast writes)
- Streamable (tail -f equivalent via file watching)
- Easy to clean up (just delete the file)

### Decision 9: Workflow Store

**Choice**: Store workflow state in `workflows` bucket

```go
// workflows bucket: task_id -> JSON(WorkflowState)
type WorkflowState struct {
    TaskID          string                  `json:"task_id"`
    WorkflowID      string                  `json:"workflow_id"`  // unique execution ID
    GrimoireName    string                  `json:"grimoire_name"`
    CurrentStep     int                     `json:"current_step"`
    Status          string                  `json:"status"`  // running, pending_merge, blocked, completed, cancelled
    CompletedSteps  map[string]*StepResult  `json:"completed_steps"`
    StepOutputs     map[string]interface{}  `json:"step_outputs"`  // template variables
    ActiveAgentID   string                  `json:"active_agent_id,omitempty"`
    Error           string                  `json:"error,omitempty"`
    BlockedReason   string                  `json:"blocked_reason,omitempty"`
    StartedAt       time.Time               `json:"started_at"`
    UpdatedAt       time.Time               `json:"updated_at"`
    CompletedAt     *time.Time              `json:"completed_at,omitempty"`
}

type StepResult struct {
    Name      string        `json:"name"`
    Type      string        `json:"type"`  // agent, script, loop, merge
    Success   bool          `json:"success"`
    Skipped   bool          `json:"skipped"`
    Output    interface{}   `json:"output,omitempty"`
    ExitCode  *int          `json:"exit_code,omitempty"`
    Error     string        `json:"error,omitempty"`
    Duration  time.Duration `json:"duration_ms"`
    Action    string        `json:"action,omitempty"`  // continue, exit_loop, block, fail
}
```

**Key behaviors**:
- Workflow state updated after each step completes
- `StepOutputs` contains template variables for subsequent steps
- `ActiveAgentID` enables daemon to reconnect to running agent on restart
- Workflow retention: completed workflows deleted after 7 days

**Cross-entity transaction example**:
```go
func (s *Store) ClaimTaskAndStartWorkflow(ctx context.Context, taskID, agentID, grimoire string) error {
    return s.db.Update(func(tx *bbolt.Tx) error {
        // 1. Claim task
        if err := s.claimTaskTx(tx, taskID, agentID); err != nil {
            return err
        }
        // 2. Create agent record
        if err := s.createAgentTx(tx, taskID, agentID); err != nil {
            return err
        }
        // 3. Create workflow state
        if err := s.createWorkflowTx(tx, taskID, grimoire); err != nil {
            return err
        }
        return nil
    })
}
```

**Rationale**: Single transaction ensures consistency. If any step fails, nothing is committed. No partial states possible.

### Decision 10: Question Store

**Choice**: Store questions in `questions` bucket

```go
// questions bucket: question_id -> JSON(Question)
type Question struct {
    ID          string    `json:"id"`
    TaskID      string    `json:"task_id"`
    AgentID     string    `json:"agent_id"`
    Type        string    `json:"type"`  // clarification, permission, decision, blocked
    Prompt      string    `json:"prompt"`
    Options     []string  `json:"options,omitempty"`
    Status      string    `json:"status"`  // pending, answered, resolved
    Response    string    `json:"response,omitempty"`
    RespondedAt *time.Time `json:"responded_at,omitempty"`
    CreatedAt   time.Time  `json:"created_at"`
}

// Secondary index: task_questions bucket for lookup by task
// task_questions: task_id -> JSON([]question_id)
```

**Key behaviors**:
- Question created when agent asks via output parsing
- `pending` questions presented to user in extension
- Response written to agent stdin AND stored in question record
- Questions deleted when agent record is purged

**Rationale**: Questions survive daemon restart. If daemon crashes while user is considering a response, the question reappears on restart.

### Decision 11: Event Log

**Choice**: Store events in `events` bucket with TTL-based cleanup

```go
// events bucket: {entity_type}:{entity_id}:{timestamp} -> JSON(Event)
// Example keys: "task:task-123:2024-01-15T10:00:00Z"
//               "agent:task-123:2024-01-15T10:00:01Z"
//               "workflow:task-123:2024-01-15T10:00:02Z"
type Event struct {
    ID        string                 `json:"id"`
    Type      string                 `json:"type"`  // task.created, agent.started, workflow.step.completed, etc.
    EntityID  string                 `json:"entity_id"`
    Timestamp time.Time              `json:"timestamp"`
    Data      map[string]interface{} `json:"data"`
}
```

**Key behaviors**:
- Events written to store before broadcasting via SSE
- Prefix scan enables "get all events for entity X since time Y"
- Events older than retention period (default: 24h) are purged
- Extension requests `GET /events?since={timestamp}&entity={id}` on SSE reconnect

**Event replay API**:
```
GET /events?since=2024-01-15T10:00:00Z
GET /events?since=2024-01-15T10:00:00Z&entity=task-123
GET /events?since=2024-01-15T10:00:00Z&type=agent.*
```

**Rationale**: SSE is fire-and-forget. If extension disconnects and reconnects, it has no way to know what happened. Event log enables catch-up, eliminating cache drift.

### Decision 12: Unified Bucket Structure

**Choice**: Single bbolt database with well-defined buckets

```
.coven/coven.db
├── tasks           task_id -> JSON(Task)
├── tags            task_id -> JSON([]string)
├── children        parent_id -> JSON([]child_id)
├── task_history    task_id/timestamp -> JSON(HistoryEntry)
├── agents          task_id -> JSON(Agent)
├── workflows       task_id -> JSON(WorkflowState)
├── questions       question_id -> JSON(Question)
├── task_questions  task_id -> JSON([]question_id)
├── events          entity_type:entity_id:timestamp -> JSON(Event)
└── meta            singleton keys (last_cleanup, schema_version, etc.)

.coven/output/
├── {taskId}.jsonl  Agent stdout/stderr (append-only)
└── ...
```

**Rationale**: Clear separation of concerns. Each bucket has a single responsibility. Prefix-based keys in `events` bucket enable efficient range scans.

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

### Risk: Output File Accumulation
Agent output files can accumulate if retention cleanup fails.

**Mitigation**: Output files are linked to agent records. Cleanup deletes both atomically. Add monitoring for `.coven/output/` directory size.

### Risk: Event Log Growth
High-activity sessions could generate many events.

**Mitigation**: 24h retention by default. Events are small (~500 bytes each). Even 10,000 events/day = ~5MB. Cleanup runs on daemon startup and periodically.

### Trade-off: Output Separate from Metadata
Output in files, metadata in bbolt creates two things to coordinate.

**Justification**: Output can be 10MB+. bbolt serializes writes. Storing output in bbolt would:
1. Bloat the database
2. Cause write contention during high-output agents
3. Slow down all other operations

The file approach is simpler and more efficient.

## Implementation Plan

### Phase 1: Core Store Infrastructure

1. Create `internal/store/` package structure
   - `store.go` - Store type, Open/Close, bucket initialization
   - `errors.go` - Sentinel errors (ErrNotFound, ErrAlreadyClaimed, etc.)
   - `migrations.go` - Schema versioning and migrations

### Phase 2: Task Store (Original Scope)

2. Implement task operations in `store/tasks.go`
   - Task CRUD operations
   - Claiming/releasing with atomic transactions
   - Tree operations (subtree, ancestors, reparent)
   - Tag management
   - History logging
   - Retention/cleanup

3. Add `internal/api/tasks/` HTTP handlers
   - CRUD: POST/GET/PATCH/DELETE /api/tasks
   - Lifecycle: /claim, /release, /complete, /block, /unblock
   - Hierarchy: /subtree, /ancestors, /children, /reparent
   - Tags: POST/PUT/DELETE /api/tasks/:id/tags
   - Query: /api/tasks/ready, filter parameters
   - Bulk: POST /api/tasks/bulk
   - History: GET /api/tasks/:id/history

4. Add matcher config loading to `internal/workflow/`
   - YAML parser for grimoire-matchers.yaml
   - Matcher evaluation engine with doublestar glob
   - Hot reload support

### Phase 3: Agent Store (Extended Scope)

5. Implement agent operations in `store/agents.go`
   - Agent CRUD with status transitions
   - Output file management (create, track metadata, delete)
   - Link to task records

6. Create output file infrastructure
   - `internal/output/writer.go` - JSONL file writer
   - `internal/output/reader.go` - JSONL file reader with `since` support
   - Wire ProcessManager to write output to files

7. Update agent API handlers
   - `/agents/{id}/output` reads from file
   - Support `?since={seq}` parameter for deltas

### Phase 4: Workflow Store (Extended Scope)

8. Implement workflow operations in `store/workflows.go`
   - Workflow CRUD with status transitions
   - Step result storage
   - Template variable storage (StepOutputs)

9. Update workflow engine
   - Remove `StatePersister` (replaced by store)
   - Remove `.coven/workflows/*.json` file handling
   - Use store for all state persistence

### Phase 5: Question Store (Extended Scope)

10. Implement question operations in `store/questions.go`
    - Question CRUD with status transitions
    - Secondary index (task_questions) for lookup by task
    - Link to agent records

11. Update question API handlers
    - Remove in-memory question store
    - Read/write from unified store

### Phase 6: Event Log (Extended Scope)

12. Implement event operations in `store/events.go`
    - Event creation with entity-prefixed keys
    - Range queries by entity and timestamp
    - TTL-based cleanup

13. Add event replay API
    - `GET /events?since={timestamp}` endpoint
    - Support entity and type filtering

14. Update event broker
    - Write to store before SSE broadcast
    - Extension uses replay API on reconnect

### Phase 7: Integration & Cleanup

15. Update scheduler to use unified store
    - Replace beads client calls with store calls
    - Add periodic stale claim recovery
    - Add periodic retention cleanup

16. Remove deprecated code
    - `internal/beads/` package
    - `internal/state/store.go`
    - `internal/questions/store.go`
    - `internal/agent/buffer.go`
    - `internal/workflow/state.go`

17. Update daemon initialization
    - Initialize unified store
    - Remove beads poller
    - Add retention cleanup on startup

### Phase 8: Migration & Testing

18. Add migration support
    - `coven migrate-from-beads` command
    - Migrate existing `.coven/state.json` to store
    - Migrate existing `.coven/workflows/*.json` to store

19. Update E2E tests
    - All tests use unified store
    - Add concurrency tests
    - Add crash recovery tests

20. (Future) Add CLI wrapper for store operations
    - `coven task create`, `coven task list`, etc.
    - For agent use when HTTP calls are awkward

## Answered Questions

### Q: Should closed tasks be automatically archived/deleted after N days?
**A**: Yes. 30-day retention, then soft-delete, then hard-delete after 7 more days. Configurable.

### Q: Should we support task "templates" for common patterns?
**A**: Deferred. Not in scope for initial implementation. Can add later via `task_templates` table.

### Q: How should subtask completion affect parent task status?
**A**: No automatic propagation. Parent status is independent. Reasoning: a parent epic shouldn't auto-close just because one subtask finished. Users can build this into grimoires if desired.

### Q: Should agent output be stored in bbolt or files?
**A**: Files. Agent output can be 10MB+ and is write-heavy during execution. Storing in bbolt would bloat the database and cause write contention. JSONL files are append-only, streamable, and easy to clean up.

### Q: How long should events be retained?
**A**: 24 hours by default, configurable. This is enough for SSE reconnection catch-up. Events are small (~500 bytes), so even high-activity sessions won't cause issues.

### Q: Should we support multiple concurrent workflows per task?
**A**: No. One workflow per task at a time. The `workflows` bucket uses `task_id` as the key. Starting a new workflow for a task replaces any existing workflow.

### Q: What happens to questions if daemon restarts?
**A**: Questions survive restart. They're stored in the `questions` bucket. On restart, pending questions are re-presented to the user via SSE events.

### Q: Should we use a single bbolt database or multiple?
**A**: Single database (`.coven/coven.db`). Benefits:
- Cross-entity transactions (claim task + create agent atomically)
- Simpler deployment (one file)
- Easier backup/restore
- No coordination between multiple DBs

### Q: How do we handle daemon restart with a running agent?
**A**: Agent record has `PID` and `Status=running`. On restart:
1. Check if process with that PID is still running (and is a claude process)
2. If yes, reconnect to output stream
3. If no, mark agent as failed and notify user of orphaned work
