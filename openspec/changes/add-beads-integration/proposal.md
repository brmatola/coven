# Change: Add Beads Integration

## Why
Users need a unified task queue in Coven without thinking about the underlying task tracking system. Beads provides the persistent, git-backed task storage, but Coven should abstract this away - users interact with "their tasks" and sync happens transparently in the background.

## What Changes
- Implement `BeadsTaskSource` as the primary TaskSource implementation
- Transparent sync on session start and periodic refresh
- Bidirectional status updates (Coven completion → Beads status)
- Task creation flows through to Beads storage
- Error handling for sync failures (surface to user, don't block)

## Impact
- Affected specs: `task-sync` (new capability)
- Affected code: `src/tasks/BeadsTaskSource.ts`, `src/tasks/BeadsClient.ts`
- Dependencies: Requires `add-core-session` (TaskSource interface)
