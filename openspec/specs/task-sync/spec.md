# task-sync Specification

## Purpose
TBD - created by archiving change add-beads-integration. Update Purpose after archive.
## Requirements
### Requirement: Transparent Task Sync
The system SHALL sync tasks from Beads transparently so users see a unified task queue without managing sync manually.

#### Scenario: Initial sync on session start
- **WHEN** user starts a Coven session
- **THEN** tasks are fetched from Beads (`bd ready`)
- **THEN** tasks appear in the Coven task queue immediately
- **THEN** user does not need to trigger sync manually

#### Scenario: Background refresh
- **WHEN** session is active
- **THEN** tasks are refreshed from Beads periodically (default 30s)
- **THEN** new tasks appear without user action
- **THEN** refresh does not interrupt active work

#### Scenario: Manual refresh
- **WHEN** user triggers refresh from sidebar
- **THEN** tasks are immediately re-synced from Beads
- **THEN** task list updates to reflect current Beads state

### Requirement: Bidirectional Status Updates
The system SHALL update Beads when task status changes in Coven.

#### Scenario: Task approved
- **WHEN** user approves a completed task in Coven
- **THEN** task is marked done in Beads
- **THEN** task no longer appears in `bd ready`

#### Scenario: Task reverted
- **WHEN** user reverts a task in Coven
- **THEN** task remains open in Beads
- **THEN** task returns to ready queue

#### Scenario: Task created in Coven
- **WHEN** user creates a new task via Coven UI
- **THEN** task is created in Beads via `bd add`
- **THEN** task receives a Beads ID

### Requirement: Task Field Mapping
The system SHALL map Beads task fields to Coven task model seamlessly.

#### Scenario: Basic field mapping
- **WHEN** task is synced from Beads
- **THEN** Beads ID becomes Coven task ID (prefixed or as-is)
- **THEN** title and description are preserved
- **THEN** Beads blockers become Coven dependencies

#### Scenario: Priority mapping
- **WHEN** task is synced from Beads
- **THEN** Beads priority is mapped to Coven priority levels
- **THEN** mapping: Beads P0/P1 → critical, P2 → high, P3 → medium, P4+ → low
- **THEN** tasks without Beads priority default to medium

#### Scenario: Priority sync on refresh
- **WHEN** tasks are refreshed from Beads
- **THEN** priority changes in Beads are reflected in Coven
- **THEN** priority updates emit taskUpdated event

#### Scenario: Acceptance criteria extraction
- **WHEN** Beads task body contains acceptance criteria section
- **THEN** criteria are parsed into Coven acceptanceCriteria array
- **THEN** criteria are editable in Coven task detail view

### Requirement: Sync Error Handling
The system SHALL handle Beads sync failures gracefully without blocking work.

#### Scenario: Beads unavailable on sync
- **WHEN** `bd` command fails during sync
- **THEN** error notification is shown to user
- **THEN** existing cached tasks remain available
- **THEN** user can continue working with cached data

#### Scenario: Beads unavailable on status update
- **WHEN** `bd` command fails when updating task status
- **THEN** error notification is shown to user
- **THEN** Coven state is preserved (task still marked done locally)
- **THEN** retry is attempted on next sync cycle

