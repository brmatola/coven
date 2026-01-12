# Session Management Spec Delta

## MODIFIED Requirements

### Requirement: Session State Access
The system SHALL provide session state from a unified persistent store.

#### Scenario: State snapshot
- **WHEN** any component calls `getState()`
- **THEN** state is read from unified bbolt store
- **AND** snapshot includes tasks, agents, workflows, questions
- **AND** state is consistent (read within single transaction)

#### Scenario: State persistence location
- **GIVEN** state was previously stored in multiple locations:
  - `.coven/state.json` (daemon state)
  - `.coven/workflows/*.json` (workflow state)
  - `.coven/familiars/*.json` (agent process info)
- **WHEN** this change is applied
- **THEN** all state is stored in `.coven/coven.db` (single bbolt database)

### Requirement: Session Configuration
The system SHALL extend configuration schema for unified store settings.

#### Scenario: Extended configuration
- **WHEN** session starts
- **THEN** `.coven/config.json` includes new settings:
  ```json
  {
    "store": {
      "eventRetentionHours": 24,
      "taskRetentionDays": 30,
      "taskSoftDeleteDays": 7,
      "workflowRetentionDays": 7,
      "claimTimeoutMinutes": 30
    }
  }
  ```
- **AND** defaults are used if not specified

### Requirement: Orphan Familiar Recovery
The system SHALL recover orphaned agents using persisted state.

#### Scenario: Agent process still running
- **WHEN** daemon restarts
- **AND** agent record exists with status "running" and valid PID
- **AND** process with that PID is still running and is a claude process
- **THEN** daemon reconnects to agent's output file (appends new output)
- **AND** agent status remains "running"
- **AND** monitoring resumes

#### Scenario: Agent dead with uncommitted work
- **WHEN** daemon restarts
- **AND** agent record exists with status "running"
- **AND** process is no longer running
- **AND** worktree has uncommitted changes
- **THEN** agent status is set to "failed" with error "daemon restarted with uncommitted work"
- **AND** task is blocked
- **AND** user is notified

#### Scenario: Agent dead with committed work
- **WHEN** daemon restarts
- **AND** agent record exists with status "running"
- **AND** process is no longer running
- **AND** worktree has commits not merged to main
- **THEN** task status is set to "pending_merge"
- **AND** user can review and approve

#### Scenario: Clean orphan recovery
- **WHEN** daemon restarts
- **AND** agent record exists with status "completed" or "failed"
- **THEN** no recovery needed
- **AND** state is already consistent

### Requirement: Robust Process Tracking
The system SHALL track agent processes in the unified store.

#### Scenario: Process info persistence
- **WHEN** an agent is spawned
- **THEN** process info is stored in unified store: `{ task_id, pid, status, worktree, output_file }`
- **AND** info is immediately persisted (not just in memory)

#### Scenario: Process identity verification
- **WHEN** daemon restarts and attempts to reconnect to a process
- **THEN** system verifies: process exists AND command contains "claude"
- **AND** only verified processes are reconnected
- **AND** verification failure marks agent as "failed"

### Requirement: Session Event Logging
The system SHALL use the unified store for event persistence.

#### Scenario: Event persistence location
- **GIVEN** events were previously fire-and-forget via SSE
- **WHEN** this change is applied
- **THEN** events are persisted to `events` bucket in unified store
- **AND** events are retained for configurable period (default: 24h)

#### Scenario: Event replay on reconnection
- **WHEN** extension SSE connection drops and reconnects
- **THEN** extension requests `GET /events?since={lastEventTimestamp}`
- **AND** missed events are returned
- **AND** extension cache is updated
- **AND** UI reflects correct state

## ADDED Requirements

### Requirement: Unified Store Initialization
The system SHALL initialize a single bbolt database for all daemon state.

#### Scenario: Database creation
- **WHEN** daemon starts
- **AND** `.coven/coven.db` does not exist
- **THEN** database is created with all required buckets
- **AND** schema version is recorded in `meta` bucket

#### Scenario: Database migration
- **WHEN** daemon starts
- **AND** existing state files exist (`.coven/state.json`, `.coven/workflows/*.json`)
- **THEN** migration is prompted: "Run `coven migrate` to migrate existing state"
- **AND** daemon can optionally start fresh without migration

#### Scenario: Database locking
- **WHEN** daemon attempts to open database
- **AND** another process has it open
- **THEN** daemon fails with clear error: "Database locked by another process"
- **AND** bbolt's file locking prevents corruption

### Requirement: Cross-Entity Transactions
The system SHALL support atomic operations across multiple entity types.

#### Scenario: Claim task and start workflow
- **WHEN** scheduler claims a task for processing
- **THEN** the following occur in a single transaction:
  1. Task status → "in_progress", claimed_by set
  2. Agent record created with status "starting"
  3. Workflow record created with step 0
- **AND** if any step fails, all are rolled back

#### Scenario: Complete workflow and close task
- **WHEN** workflow completes successfully
- **THEN** the following occur in a single transaction:
  1. Workflow status → "completed"
  2. Task status → "closed"
  3. Agent status → "completed"
- **AND** all changes are atomic

### Requirement: Retention Management
The system SHALL enforce retention policies across all entity types.

#### Scenario: Retention policy execution
- **WHEN** daemon starts
- **AND** periodically (every hour)
- **THEN** retention cleanup runs:
  1. Tasks: closed > 30 days → soft delete
  2. Tasks: soft deleted > 7 days → hard delete
  3. Agents: deleted with task
  4. Output files: deleted with agent
  5. Workflows: completed > 7 days → delete
  6. Questions: deleted with agent
  7. Events: older than 24h → delete

#### Scenario: Retention is configurable
- **WHEN** `.coven/config.json` specifies custom retention
- **THEN** configured values are used instead of defaults
