# task-management Specification

## Purpose
TBD - created by archiving change add-core-session. Update Purpose after archive.
## Requirements
### Requirement: Task State Machine
The system SHALL enforce a valid state machine for task status transitions.

#### Scenario: Valid transitions from ready
- **WHEN** a task is in "ready" status
- **THEN** it can transition to "working" (agent assigned) or "blocked" (dependency unmet)

#### Scenario: Valid transitions from working
- **WHEN** a task is in "working" status
- **THEN** it can transition to "review" (agent complete) or "ready" (agent terminated)

#### Scenario: Valid transitions from review
- **WHEN** a task is in "review" status
- **THEN** it can transition to "done" (approved), "working" (changes requested), or "ready" (reverted)

#### Scenario: Invalid transition rejected
- **WHEN** an invalid status transition is attempted (e.g., ready → done)
- **THEN** the transition is rejected with an error

### Requirement: Task CRUD Operations
The system SHALL support creating, reading, updating, and deleting tasks.

#### Scenario: Create task
- **WHEN** a task is created with title, description, and optional acceptance criteria
- **THEN** the task is assigned a unique ID
- **THEN** the task status is set to "ready"
- **THEN** a "taskCreated" event is emitted

#### Scenario: Update task
- **WHEN** a task's details are updated
- **THEN** the changes are persisted
- **THEN** a "taskUpdated" event is emitted

#### Scenario: Delete task
- **WHEN** a task in "ready" or "blocked" status is deleted
- **THEN** the task is removed from the task list
- **THEN** a "taskDeleted" event is emitted

#### Scenario: Prevent delete of active task
- **WHEN** deletion is attempted on a "working" or "review" task
- **THEN** the deletion is rejected with an error

### Requirement: Task Dependencies
The system SHALL track dependencies between tasks and enforce execution order.

#### Scenario: Dependency declaration
- **WHEN** a task is created with dependencies on other task IDs
- **THEN** the task status is set to "blocked" if dependencies are not "done"

#### Scenario: Dependency resolution
- **WHEN** all dependencies of a blocked task become "done"
- **THEN** the task automatically transitions to "ready"
- **THEN** a "taskUnblocked" event is emitted

### Requirement: Task Priority
The system SHALL support task prioritization for controlling execution order.

#### Scenario: Priority field
- **WHEN** a task is created or updated
- **THEN** task can have a priority: critical, high, medium, low (default: medium)
- **THEN** priority is persisted with task data

#### Scenario: Priority display
- **WHEN** tasks are displayed in sidebar
- **THEN** priority is indicated visually (icon or color)
- **THEN** tasks are grouped or sorted by priority within status groups

#### Scenario: Priority from external source
- **WHEN** task is synced from external source (e.g., Beads)
- **THEN** external priority is mapped to Coven priority levels
- **THEN** priority changes in source are reflected on sync

### Requirement: Task Querying
The system SHALL support filtering and querying tasks by various criteria.

#### Scenario: Filter by status
- **WHEN** tasks are queried with a status filter
- **THEN** only tasks matching the specified status are returned

#### Scenario: Get next ready task
- **WHEN** the system requests the next task to work on
- **THEN** the highest priority "ready" task without blocked dependencies is returned
- **THEN** within same priority, oldest task is returned first

### Requirement: Task Persistence
The system SHALL persist task data to survive extension restarts.

#### Scenario: Tasks survive restart
- **WHEN** VSCode restarts with an active session
- **THEN** all tasks and their states are restored from storage

