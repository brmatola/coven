# Tasks: Add In-Process Task Store

## 1. Task Store Implementation

- [ ] 1.1 Create `internal/taskstore/` package structure
- [ ] 1.2 Implement SQLite schema with migrations (`schema.go`)
- [ ] 1.3 Implement `Store` type with connection management
- [ ] 1.4 Implement CRUD operations (Create, Get, List, Update, Delete)
- [ ] 1.5 Implement atomic Claim/Release operations
- [ ] 1.6 Implement tree queries (GetChildren, GetAncestors, GetSubtree)
- [ ] 1.7 Implement tag operations (AddTags, RemoveTags, GetByTag)
- [ ] 1.8 Implement status state machine with transition validation
- [ ] 1.9 Add unit tests for all store operations
- [ ] 1.10 Add concurrency tests (parallel claims, races)

## 2. Grimoire Matcher Implementation

- [ ] 2.1 Define matcher config schema (`types.go`)
- [ ] 2.2 Implement YAML config loader for `.coven/grimoire-matchers.yaml`
- [ ] 2.3 Implement glob pattern matching for tags
- [ ] 2.4 Implement priority matching
- [ ] 2.5 Implement body content matching
- [ ] 2.6 Implement parent inheritance resolution
- [ ] 2.7 Integrate matcher into `GrimoireMapper.Resolve()`
- [ ] 2.8 Add unit tests for matcher logic
- [ ] 2.9 Add default matchers config (built-in fallback)

## 3. Scheduler Integration

- [ ] 3.1 Update `Scheduler` to accept task store instead of beads client
- [ ] 3.2 Update `getReadyTasks()` to query task store
- [ ] 3.3 Update task status updates to use store
- [ ] 3.4 Ensure atomic claiming prevents double-scheduling
- [ ] 3.5 Update workflow completion to close tasks in store
- [ ] 3.6 Add integration tests for scheduler + store

## 4. HTTP API Integration

- [ ] 4.1 Update `/tasks` handlers to use task store
- [ ] 4.2 Add task creation endpoint (was via beads CLI)
- [ ] 4.3 Add subtask creation endpoint
- [ ] 4.4 Add tag management endpoints
- [ ] 4.5 Update task listing to include tree structure
- [ ] 4.6 Add OpenAPI spec updates

## 5. Daemon Integration

- [ ] 5.1 Initialize task store in `daemon.New()`
- [ ] 5.2 Remove beads client initialization
- [ ] 5.3 Remove beads poller startup
- [ ] 5.4 Add store shutdown/cleanup on daemon stop
- [ ] 5.5 Add store health check to `/health` endpoint

## 6. Beads Removal

- [ ] 6.1 Delete `internal/beads/` package
- [ ] 6.2 Remove beads references from daemon
- [ ] 6.3 Remove beads references from scheduler
- [ ] 6.4 Update E2E test helpers to use task store
- [ ] 6.5 Remove beads fixtures from E2E tests

## 7. Migration Support

- [ ] 7.1 Add `coven migrate-from-beads` command
- [ ] 7.2 Parse `.beads/issues.jsonl` format
- [ ] 7.3 Map beads fields to task store schema
- [ ] 7.4 Import dependencies as parent/child relationships
- [ ] 7.5 Add migration documentation

## 8. Testing

- [ ] 8.1 Update existing daemon E2E tests to use task store
- [ ] 8.2 Add E2E tests for concurrent task claiming
- [ ] 8.3 Add E2E tests for tree operations
- [ ] 8.4 Add E2E tests for grimoire matcher rules
- [ ] 8.5 Verify no concurrency issues under parallel test execution
