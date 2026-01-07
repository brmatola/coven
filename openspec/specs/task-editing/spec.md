# task-editing Specification

## Purpose
TBD - created by archiving change add-task-detail-view. Update Purpose after archive.
## Requirements
### Requirement: Task Detail Display
The system SHALL display comprehensive task information in a dedicated panel.

#### Scenario: Open task detail
- **WHEN** user double-clicks a task in sidebar OR selects "Edit" from context menu
- **THEN** task detail panel opens
- **THEN** panel shows task title, description, acceptance criteria, and metadata

#### Scenario: Task metadata display
- **WHEN** task detail panel is open
- **THEN** panel shows task source (Beads ID or "Manual")
- **THEN** panel shows creation date
- **THEN** panel shows dependencies (if any) with links to those tasks
- **THEN** panel shows current status

### Requirement: Task Editing
The system SHALL allow editing task details before work begins.

#### Scenario: Edit task title
- **WHEN** user clicks on task title in detail panel
- **THEN** title becomes editable inline
- **THEN** changes are saved on blur or Enter key

#### Scenario: Edit task description
- **WHEN** user edits description in detail panel
- **THEN** rich text editing is available (markdown)
- **THEN** changes are auto-saved after brief delay

#### Scenario: Edit acceptance criteria
- **WHEN** user is in task detail panel
- **THEN** user can add new acceptance criteria items
- **THEN** user can edit existing criteria items
- **THEN** user can remove criteria items
- **THEN** changes persist immediately

#### Scenario: Edits sync to Beads
- **WHEN** user saves task edits
- **THEN** changes are persisted to Beads (for Beads-sourced tasks)
- **THEN** sync failure shows error notification but preserves local changes

### Requirement: Task Actions from Detail
The system SHALL provide task actions directly from the detail panel.

#### Scenario: Start task
- **WHEN** user clicks "Start Task" on a ready task
- **THEN** agent is assigned to the task
- **THEN** task transitions to working status
- **THEN** panel updates to reflect new status

#### Scenario: Delete task
- **WHEN** user clicks "Delete" on a ready task
- **THEN** confirmation dialog appears
- **THEN** confirmed deletion removes task from queue and Beads

#### Scenario: Blocked task display
- **WHEN** task is blocked by dependencies
- **THEN** blocking tasks are listed with links
- **THEN** "Start Task" is disabled with explanation

### Requirement: Panel Lifecycle
The system SHALL manage task detail panel lifecycle properly.

#### Scenario: Single panel instance
- **WHEN** user opens detail for task A, then task B
- **THEN** same panel updates to show task B (not multiple panels)

#### Scenario: Panel reflects live updates
- **WHEN** task status changes while panel is open
- **THEN** panel updates to reflect new status
- **THEN** available actions update accordingly

#### Scenario: Deleted task handling
- **WHEN** open task is deleted elsewhere
- **THEN** panel shows "Task not found" message
- **THEN** panel can be closed gracefully

