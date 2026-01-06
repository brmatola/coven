# Tasks: Add Beads Integration

## 1. Beads CLI Client
- [ ] 1.1 Create `BeadsClient` class wrapping `bd` CLI commands
- [ ] 1.2 Implement `listReady()` calling `bd ready --json`
- [ ] 1.3 Implement `getTask(id)` calling `bd show <id> --json`
- [ ] 1.4 Implement `createTask(title, description)` calling `bd add`
- [ ] 1.5 Implement `updateStatus(id, status)` for marking tasks done/blocked
- [ ] 1.6 Handle CLI errors gracefully (surface to user via notification)
- [ ] 1.7 Write unit tests for BeadsClient

## 2. BeadsTaskSource Implementation
- [ ] 2.1 Implement `BeadsTaskSource` conforming to TaskSource interface
- [ ] 2.2 Map Beads task fields to Coven Task interface
- [ ] 2.3 Implement `sync()` fetching current ready tasks
- [ ] 2.4 Implement `watch()` for polling-based refresh (configurable interval)
- [ ] 2.5 Implement `updateStatus()` for bidirectional sync
- [ ] 2.6 Write unit tests for BeadsTaskSource

## 3. Task Field Mapping
- [ ] 3.1 Map Beads `bd-xxxx` IDs to Coven task IDs
- [ ] 3.2 Map Beads title/description to Coven fields
- [ ] 3.3 Extract acceptance criteria from Beads task body (if present)
- [ ] 3.4 Map Beads blockers to Coven task dependencies
- [ ] 3.5 Preserve Beads metadata for round-trip updates

## 4. Transparent Sync
- [ ] 4.1 Auto-sync on session start
- [ ] 4.2 Periodic background refresh (default: 30s, configurable)
- [ ] 4.3 Manual refresh via sidebar action
- [ ] 4.4 Merge strategy: Beads is source of truth for task list, Coven owns in-flight status
- [ ] 4.5 Handle new tasks appearing mid-session

## 5. Bidirectional Updates
- [ ] 5.1 When task approved in Coven → mark done in Beads
- [ ] 5.2 When task reverted in Coven → task remains open in Beads
- [ ] 5.3 When task created in Coven → create in Beads
- [ ] 5.4 Conflict resolution: if task modified in both, prefer Coven state for active tasks

## 6. E2E Tests
- [ ] 6.1 Test: Session start syncs tasks from Beads
- [ ] 6.2 Test: Task completion updates Beads
- [ ] 6.3 Test: New task in Beads appears in Coven after refresh
- [ ] 6.4 Test: Beads unavailable shows error notification
