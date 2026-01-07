# Tasks: Add Beads Integration

## Implementation
Epic: `coven-e0t` (add-beads-integration)
Track progress: `bd epic status coven-e0t`
List tasks: `bd list --parent coven-e0t`

**Status: COMPLETE** - All 31 tasks closed (100%)

## Architecture Notes

The implementation was simplified from the original proposal:
- **One-way sync**: Beads is the single source of truth. Coven pulls from Beads and displays.
- **No bidirectional sync complexity**: Mutations go through `bd` CLI, then Coven refreshes.
- **No manual tasks**: Beads is a hard requirement. All task management goes through Beads.
- **Removed TaskManager**: BeadsTaskSource is the only task provider needed.

## 1. Beads CLI Client
- [x] 1.1 Create `BeadsClient` class wrapping `bd` CLI commands
- [x] 1.2 Implement `listReady()` calling `bd ready --json`
- [x] 1.3 Implement `getTask(id)` calling `bd show <id> --json`
- [x] 1.4 Implement `createTask(title, description)` calling `bd create`
- [x] 1.5 Implement `updateStatus(id, status)` for marking tasks in_progress/blocked
- [x] 1.6 Handle CLI errors gracefully (surface to user via notification)
- [x] 1.7 Write unit tests for BeadsClient

## 2. BeadsTaskSource Implementation
- [x] 2.1 Implement `BeadsTaskSource` as the single task provider
- [x] 2.2 Map Beads task fields to Coven Task interface
- [x] 2.3 Implement `sync()` fetching current tasks
- [x] 2.4 Implement `watch()` for polling-based refresh (configurable interval)
- [x] 2.5 Implement helper methods: `getTasksByStatus()`, `getNextTask()`, `updateTaskStatus()`, `closeTask()`
- [x] 2.6 Write unit tests for BeadsTaskSource

## 3. Task Field Mapping
- [x] 3.1 Map Beads `bd-xxxx` IDs to Coven task IDs
- [x] 3.2 Map Beads title/description to Coven fields
- [x] 3.3 Extract acceptance criteria from Beads task body (if present)
- [x] 3.4 Map Beads blockers to Coven task dependencies
- [x] 3.5 Preserve Beads metadata for round-trip updates

## 4. Transparent Sync (Simplified)
- [x] 4.1 Auto-sync on session start via `beadsTaskSource.fetchTasks()`
- [x] 4.2 Periodic background refresh via `watch()` (default: 30s, configurable)
- [x] 4.3 Manual refresh via `coven.refreshTasks` command
- [x] 4.4 Beads is source of truth (no merge strategy needed)
- [x] 4.5 Handle new tasks appearing mid-session via sync events

## 5. Mutations via Beads (Simplified from Bidirectional)
- [x] 5.1 Task approved in Coven → `closeTask()` marks done in Beads
- [x] 5.2 Task reverted in Coven → `updateTaskStatus()` resets in Beads
- [x] 5.3 Task created in Coven → `createTask()` creates in Beads
- [x] 5.4 No conflict resolution needed (Beads is single source of truth)

## 6. E2E Tests
- [x] 6.1 Test: Session start syncs tasks from Beads
- [x] 6.2 Test: Task completion updates Beads
- [x] 6.3 Test: New task in Beads appears in Coven after refresh
- [x] 6.4 Test: Beads unavailable shows error notification

### E2E Test Infrastructure
- Isolated temp workspace created for each test run
- Git and Beads initialized automatically
- Cleanup on test completion
- Tests skip gracefully if Beads CLI unavailable
