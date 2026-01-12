# Tasks: Unified Daemon Store

## Phase 1: Core Store Infrastructure

- [ ] 1.1 Create `internal/store/` package structure
- [ ] 1.2 Implement `Store` type with bbolt connection management
- [ ] 1.3 Implement bucket initialization (create all buckets on open)
- [ ] 1.4 Implement schema versioning in `meta` bucket
- [ ] 1.5 Add `errors.go` with sentinel errors (ErrNotFound, ErrAlreadyClaimed, etc.)
- [ ] 1.6 Add basic unit tests for store open/close

## Phase 2: Task Store (Original Scope)

- [ ] 2.1 Implement `store/tasks.go` with Task type
- [ ] 2.2 Implement CRUD operations (Create, Get, List, Update, Delete)
- [ ] 2.3 Implement atomic Claim/Release operations
- [ ] 2.4 Implement tree queries (GetChildren, GetAncestors, GetSubtree)
- [ ] 2.5 Implement tag operations (AddTags, RemoveTags, GetByTag)
- [ ] 2.6 Implement status state machine with transition validation
- [ ] 2.7 Implement task history logging to `task_history` bucket
- [ ] 2.8 Implement soft delete with retention cleanup
- [ ] 2.9 Add unit tests for all task store operations
- [ ] 2.10 Add concurrency tests (parallel claims, races)

## Phase 3: Grimoire Matcher Implementation

- [ ] 3.1 Define matcher config schema (`types.go`)
- [ ] 3.2 Implement YAML config loader for `.coven/grimoire-matchers.yaml`
- [ ] 3.3 Implement glob pattern matching for tags (doublestar)
- [ ] 3.4 Implement priority matching
- [ ] 3.5 Implement body content matching
- [ ] 3.6 Implement parent inheritance resolution
- [ ] 3.7 Integrate matcher into `GrimoireMapper.Resolve()`
- [ ] 3.8 Add unit tests for matcher logic
- [ ] 3.9 Add default matchers config (built-in fallback)

## Phase 4: Task HTTP API

- [ ] 4.1 Create `internal/api/tasks/` package
- [ ] 4.2 Implement task CRUD endpoints (POST/GET/PATCH/DELETE)
- [ ] 4.3 Implement lifecycle endpoints (/claim, /release, /complete, /block, /unblock)
- [ ] 4.4 Implement hierarchy endpoints (/subtree, /ancestors, /children, /reparent)
- [ ] 4.5 Implement tag endpoints (POST/PUT/DELETE /tasks/:id/tags)
- [ ] 4.6 Implement query endpoints (/tasks/ready, filter params)
- [ ] 4.7 Implement bulk operations (POST /tasks/bulk)
- [ ] 4.8 Implement history endpoint (GET /tasks/:id/history)
- [ ] 4.9 Implement grimoire-match endpoint (GET /tasks/:id/grimoire-match)
- [ ] 4.10 Update OpenAPI spec

## Phase 5: Agent Store (Extended Scope)

- [ ] 5.1 Implement `store/agents.go` with Agent type
- [ ] 5.2 Implement agent CRUD operations
- [ ] 5.3 Implement status transitions (starting → running → completed/failed/killed)
- [ ] 5.4 Implement output file path tracking
- [ ] 5.5 Add unit tests for agent store operations

## Phase 6: Agent Output Infrastructure (Extended Scope)

- [ ] 6.1 Create `internal/output/` package
- [ ] 6.2 Implement `writer.go` - JSONL file writer with sequence numbers
- [ ] 6.3 Implement `reader.go` - JSONL reader with `since` support
- [ ] 6.4 Update ProcessManager to write output to files instead of RingBuffer
- [ ] 6.5 Update `/agents/{id}/output` API to read from files
- [ ] 6.6 Support `?since={seq}` parameter for delta queries
- [ ] 6.7 Add unit tests for output writer/reader

## Phase 7: Workflow Store (Extended Scope)

- [ ] 7.1 Implement `store/workflows.go` with WorkflowState type
- [ ] 7.2 Implement workflow CRUD operations
- [ ] 7.3 Implement step result storage
- [ ] 7.4 Implement template variable (StepOutputs) storage
- [ ] 7.5 Add unit tests for workflow store operations

## Phase 8: Workflow Engine Integration (Extended Scope)

- [ ] 8.1 Update workflow engine to use store instead of StatePersister
- [ ] 8.2 Remove `.coven/workflows/*.json` file handling
- [ ] 8.3 Implement cross-entity transaction (ClaimTaskAndStartWorkflow)
- [ ] 8.4 Update workflow API handlers to use store
- [ ] 8.5 Add integration tests for workflow + store

## Phase 9: Question Store (Extended Scope)

- [ ] 9.1 Implement `store/questions.go` with Question type
- [ ] 9.2 Implement question CRUD operations
- [ ] 9.3 Implement secondary index (task_questions bucket)
- [ ] 9.4 Implement question status transitions (pending → answered → resolved)
- [ ] 9.5 Update question API handlers to use store
- [ ] 9.6 Remove in-memory question store (`internal/questions/store.go`)
- [ ] 9.7 Add unit tests for question store operations

## Phase 10: Event Log (Extended Scope)

- [ ] 10.1 Implement `store/events.go` with Event type
- [ ] 10.2 Implement event creation with entity-prefixed keys
- [ ] 10.3 Implement range queries by entity and timestamp
- [ ] 10.4 Implement TTL-based cleanup (default: 24h)
- [ ] 10.5 Add unit tests for event store operations

## Phase 11: Event Replay API (Extended Scope)

- [ ] 11.1 Create `internal/api/events/` package
- [ ] 11.2 Implement `GET /events?since={timestamp}` endpoint
- [ ] 11.3 Support entity and type filtering
- [ ] 11.4 Update event broker to write to store before SSE broadcast
- [ ] 11.5 Update extension StateCache to use replay API on reconnect
- [ ] 11.6 Add integration tests for event replay

## Phase 12: Scheduler Integration

- [ ] 12.1 Update `Scheduler` to use unified store instead of beads client
- [ ] 12.2 Update `getReadyTasks()` to query task store
- [ ] 12.3 Update task status updates to use store
- [ ] 12.4 Ensure atomic claiming prevents double-scheduling
- [ ] 12.5 Update workflow completion to close tasks in store
- [ ] 12.6 Add periodic stale claim recovery (every 5 min)
- [ ] 12.7 Add periodic retention cleanup (daily)
- [ ] 12.8 Add integration tests for scheduler + store

## Phase 13: Daemon Integration

- [ ] 13.1 Initialize unified store in `daemon.New()`
- [ ] 13.2 Remove beads client initialization
- [ ] 13.3 Remove beads poller startup
- [ ] 13.4 Add store shutdown/cleanup on daemon stop
- [ ] 13.5 Add store health check to `/health` endpoint
- [ ] 13.6 Add daemon restart recovery (reconnect to running agents)

## Phase 14: Cleanup Deprecated Code

- [ ] 14.1 Delete `internal/beads/` package
- [ ] 14.2 Delete `internal/state/store.go`
- [ ] 14.3 Delete `internal/questions/store.go`
- [ ] 14.4 Delete `internal/agent/buffer.go`
- [ ] 14.5 Delete `internal/workflow/state.go` (StatePersister)
- [ ] 14.6 Remove beads references from all code
- [ ] 14.7 Update imports throughout codebase

## Phase 15: Migration Support

- [ ] 15.1 Add `coven migrate-from-beads` command
- [ ] 15.2 Parse `.beads/issues.jsonl` format
- [ ] 15.3 Map beads fields to task store schema
- [ ] 15.4 Import dependencies as parent/child relationships
- [ ] 15.5 Migrate existing `.coven/state.json` to store
- [ ] 15.6 Migrate existing `.coven/workflows/*.json` to store
- [ ] 15.7 Add migration documentation

## Phase 16: Retention Policies

- [ ] 16.1 Implement `store/retention.go`
- [ ] 16.2 Add task retention (30 days closed → soft delete → 7 days → hard delete)
- [ ] 16.3 Add agent retention (delete when task is purged)
- [ ] 16.4 Add output file cleanup (delete with agent record)
- [ ] 16.5 Add workflow retention (7 days after completion)
- [ ] 16.6 Add question cleanup (delete with agent record)
- [ ] 16.7 Add event cleanup (24h retention)
- [ ] 16.8 Add retention configuration to `.coven/config.json`
- [ ] 16.9 Add unit tests for retention policies

## Phase 17: E2E Testing

- [ ] 17.1 Update existing daemon E2E tests to use unified store
- [ ] 17.2 Add E2E tests for concurrent task claiming
- [ ] 17.3 Add E2E tests for tree operations
- [ ] 17.4 Add E2E tests for grimoire matcher rules
- [ ] 17.5 Add E2E tests for daemon restart recovery
- [ ] 17.6 Add E2E tests for event replay on reconnect
- [ ] 17.7 Verify no concurrency issues under parallel test execution

## Phase 18: Extension Updates

- [ ] 18.1 Update extension StateCache to handle event replay
- [ ] 18.2 Add SSE reconnection with `since` parameter
- [ ] 18.3 Update output streaming to use new API format
- [ ] 18.4 Test extension with daemon restart scenarios
