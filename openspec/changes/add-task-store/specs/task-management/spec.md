# Task Management Spec Delta

## REMOVED Requirements

### Requirement: Task Dependencies (REMOVED)
The original task dependencies feature (`depends_on` relationships between tasks) is **removed** and replaced by the hierarchical parent-child model.

**Rationale**: Dependencies added complexity without clear benefit. The hierarchy provides:
- Natural decomposition (epic → feature → task → subtask)
- Implicit ordering via parent completion gates
- Simpler mental model for users

Tasks that previously would have used dependencies should use one of:
- Parent-child relationships (subtask can't complete until parent is claimed)
- Tags for grouping related work
- Grimoire matcher inheritance for workflow routing

## MODIFIED Requirements

### Requirement: Task State Machine
The system SHALL enforce a valid state machine for task status transitions.

#### Scenario: Valid transitions from open
- **WHEN** a task is in "open" status
- **THEN** it can transition to "in_progress" (via Claim)

#### Scenario: Valid transitions from in_progress
- **WHEN** a task is in "in_progress" status
- **THEN** it can transition to "pending_merge" (workflow awaiting approval)
- **OR** "blocked" (workflow blocked)
- **OR** "closed" (workflow completed without review)
- **OR** "open" (via Release - agent released claim)

#### Scenario: Valid transitions from pending_merge
- **WHEN** a task is in "pending_merge" status
- **THEN** it can transition to "closed" (merge approved)
- **OR** "blocked" (merge rejected)

#### Scenario: Valid transitions from blocked
- **WHEN** a task is in "blocked" status
- **THEN** it can transition to "open" (unblocked for retry)
- **OR** "closed" (manually closed)

#### Scenario: Invalid transition rejected
- **WHEN** an invalid status transition is attempted (e.g., "open" → "closed")
- **THEN** the operation returns ErrInvalidTransition
- **AND** the task status remains unchanged

### Requirement: Task CRUD Operations
The system SHALL support creating, reading, updating, and deleting tasks via an in-process store.

#### Scenario: Create task
- **WHEN** a task is created with title, body, type, and optional parent_id
- **THEN** the task is assigned a unique ID (UUID format)
- **AND** the task status is set to "open"
- **AND** priority defaults to 2 if not specified
- **AND** depth is computed from parent (0 if root, parent.depth + 1 otherwise)
- **AND** created_at and updated_at timestamps are set
- **AND** a "task.created" event is emitted
- **AND** a history record is created

#### Scenario: Create task with invalid parent
- **WHEN** a task is created with a parent_id that does not exist
- **THEN** the operation returns ErrParentNotFound
- **AND** no task is created

#### Scenario: Create task with invalid priority
- **WHEN** a task is created with priority < 0 or priority > 4
- **THEN** the operation returns ErrInvalidPriority
- **AND** no task is created

#### Scenario: Create subtask
- **WHEN** a task is created with a valid parent_id
- **THEN** the task is linked as a child of the parent
- **AND** the task inherits parent's grimoire_hint if not specified

#### Scenario: Update task
- **WHEN** a task's title, body, or priority are updated
- **THEN** the changes are persisted to bbolt
- **AND** updated_at timestamp is refreshed
- **AND** a "task.updated" event is emitted
- **AND** a history record is created for each changed field

#### Scenario: Delete task
- **WHEN** a task in "open" or "blocked" status is deleted
- **THEN** the task is removed from the store
- **AND** all child tasks are recursively deleted (cascade)
- **AND** all associated tags are deleted (cascade)
- **AND** all history records are deleted (cascade)
- **AND** a "task.deleted" event is emitted

#### Scenario: Delete task with in_progress children
- **WHEN** deletion is attempted on a task with children in "in_progress" status
- **THEN** the deletion is rejected with ErrHasActiveChildren
- **AND** the task and children remain unchanged

#### Scenario: Prevent delete of active task
- **WHEN** deletion is attempted on a task in "in_progress" or "pending_merge" status
- **THEN** the deletion is rejected with ErrTaskActive
- **AND** the task state is unchanged

### Requirement: Task Persistence
The system SHALL persist task data to bbolt to survive daemon restarts.

#### Scenario: Tasks survive restart
- **WHEN** the daemon restarts
- **THEN** all tasks and their states are restored from `.coven/tasks.db` (bbolt)
- **AND** in_progress tasks remain in_progress with claimed_by intact

#### Scenario: Stale claim recovery on startup
- **WHEN** the daemon starts
- **AND** tasks exist with claimed_at older than claim_timeout (default 30m)
- **THEN** those tasks are released (claimed_by = NULL, status = "open")
- **AND** a warning is logged for each released task

#### Scenario: Database initialization
- **WHEN** the daemon starts with no existing database
- **THEN** a new bbolt database is created at `.coven/tasks.db`
- **AND** required buckets are initialized (tasks, tags, children, history)

#### Scenario: Concurrent access
- **WHEN** multiple goroutines access the store simultaneously
- **THEN** read operations run concurrently via bbolt's View transactions
- **AND** write operations are serialized via bbolt's Update transactions
- **AND** no data corruption occurs

## ADDED Requirements

### Requirement: Task Tree Structure
The system SHALL support hierarchical task organization with configurable maximum depth.

#### Scenario: Parent-child relationships
- **WHEN** a task is created with parent_id
- **THEN** it becomes a child of the specified parent
- **AND** its depth is set to parent.depth + 1
- **AND** the relationship is persisted

#### Scenario: Depth limit warning
- **WHEN** a task is created with depth > 10
- **THEN** a warning is logged
- **AND** the task is still created

#### Scenario: Get subtree
- **WHEN** GetSubtree(taskID) is called
- **THEN** the task and all descendants are returned
- **AND** results include depth relative to the queried task

#### Scenario: Get ancestors
- **WHEN** GetAncestors(taskID) is called
- **THEN** all ancestor tasks up to root are returned
- **AND** results are ordered from immediate parent to root

#### Scenario: Get non-existent task subtree
- **WHEN** GetSubtree(taskID) is called with a non-existent ID
- **THEN** ErrTaskNotFound is returned

#### Scenario: Cascade delete
- **WHEN** a parent task is deleted
- **THEN** all descendant tasks are recursively deleted
- **AND** deletion is atomic (all or nothing)

#### Scenario: Reparent task
- **WHEN** Reparent(taskID, newParentID) is called
- **AND** both tasks exist
- **AND** newParentID is not a descendant of taskID (would create cycle)
- **THEN** the task's parent_id is updated to newParentID
- **AND** the task's depth is recalculated (newParent.depth + 1)
- **AND** all descendant depths are recalculated
- **AND** the children bucket is updated for old and new parents
- **AND** a history record is created for parent_id change

#### Scenario: Reparent to root
- **WHEN** Reparent(taskID, "") is called with empty newParentID
- **THEN** the task becomes a root task
- **AND** the task's depth is set to 0
- **AND** all descendant depths are recalculated

#### Scenario: Reparent would create cycle
- **WHEN** Reparent(taskID, newParentID) is called
- **AND** newParentID is a descendant of taskID
- **THEN** ErrWouldCreateCycle is returned
- **AND** no changes are made

#### Scenario: Reparent non-existent task
- **WHEN** Reparent(taskID, newParentID) is called
- **AND** taskID does not exist
- **THEN** ErrTaskNotFound is returned

#### Scenario: Reparent to non-existent parent
- **WHEN** Reparent(taskID, newParentID) is called
- **AND** newParentID does not exist
- **THEN** ErrParentNotFound is returned

### Requirement: Atomic Task Claiming
The system SHALL support atomic task claiming to prevent race conditions.

#### Scenario: Successful claim
- **WHEN** Claim(taskID, agentID) is called
- **AND** the task exists
- **AND** the task is in "open" status
- **AND** claimed_by is NULL
- **THEN** the task is atomically updated with claimed_by = agentID
- **AND** status transitions to "in_progress"
- **AND** claimed_at timestamp is set to current time
- **AND** history records are created for claimed_by and status changes

#### Scenario: Claim non-existent task
- **WHEN** Claim(taskID, agentID) is called
- **AND** no task exists with that ID
- **THEN** ErrTaskNotFound is returned

#### Scenario: Claim task with wrong status
- **WHEN** Claim(taskID, agentID) is called
- **AND** the task exists but status is not "open" (e.g., "blocked", "closed")
- **THEN** ErrInvalidStatus is returned
- **AND** the task state is unchanged

#### Scenario: Claim already held by another agent
- **WHEN** Claim(taskID, agentID) is called
- **AND** the task is already claimed by a different agent
- **THEN** ErrAlreadyClaimed is returned
- **AND** the task state is unchanged

#### Scenario: Idempotent re-claim check
- **WHEN** ReClaim(taskID, agentID) is called
- **AND** the task is in "in_progress" status
- **AND** the task is claimed by the same agentID
- **THEN** the operation succeeds (no-op)
- **AND** claimed_at is NOT updated

#### Scenario: Release claim
- **WHEN** Release(taskID, agentID) is called
- **AND** the task is claimed by the specified agentID
- **THEN** claimed_by is set to NULL
- **AND** claimed_at is set to NULL
- **AND** status transitions to "open"
- **AND** history records are created

#### Scenario: Release by wrong agent
- **WHEN** Release(taskID, agentID) is called
- **AND** the task is claimed by a different agent
- **THEN** ErrNotClaimOwner is returned
- **AND** the task state is unchanged

#### Scenario: Concurrent claim race
- **WHEN** two agents simultaneously call Claim() on the same task
- **THEN** exactly one succeeds
- **AND** the other receives ErrAlreadyClaimed
- **AND** no partial state is visible

### Requirement: Stale Claim Recovery
The system SHALL automatically release claims that exceed a timeout.

#### Scenario: Periodic stale claim check
- **WHEN** ReleaseStaleClaims(timeout) is called
- **THEN** all tasks with status "in_progress" and claimed_at < (now - timeout) are released
- **AND** a count of released tasks is returned
- **AND** a warning is logged for each released task

#### Scenario: Stale claim check runs periodically
- **WHEN** the scheduler ticks
- **THEN** ReleaseStaleClaims is called every 5 minutes
- **AND** the timeout is configurable (default: 30 minutes)

### Requirement: Task Tagging
The system SHALL support arbitrary tags on tasks for filtering and routing.

#### Scenario: Add tags
- **WHEN** AddTags(taskID, []string{"security", "backend"}) is called
- **THEN** tags are associated with the task
- **AND** duplicate tags are ignored (idempotent)

#### Scenario: Add tags to non-existent task
- **WHEN** AddTags(taskID, tags) is called with a non-existent taskID
- **THEN** ErrTaskNotFound is returned

#### Scenario: Add empty tag rejected
- **WHEN** AddTags(taskID, []string{""}) is called
- **THEN** ErrInvalidTag is returned
- **AND** no tags are added

#### Scenario: Remove tags
- **WHEN** RemoveTags(taskID, []string{"backend"}) is called
- **THEN** specified tags are removed
- **AND** non-existent tags are ignored (idempotent)

#### Scenario: Query by tag
- **WHEN** ListByTag("security") is called
- **THEN** all non-deleted tasks with that tag are returned

#### Scenario: Query by tag pattern
- **WHEN** ListByTagPattern("api-*") is called
- **THEN** all non-deleted tasks with tags matching the glob pattern are returned

#### Scenario: Tag pattern glob syntax
- **GIVEN** glob patterns use doublestar syntax (github.com/bmatcuk/doublestar)
- **WHEN** ListByTagPattern("auth*") is called
- **THEN** tasks with tags "auth", "authentication", "auth-service" are matched
- **WHEN** ListByTagPattern("area/**") is called
- **THEN** tasks with tags "area/frontend", "area/backend/api" are matched
- **WHEN** ListByTagPattern("v[1-3]") is called
- **THEN** tasks with tags "v1", "v2", "v3" are matched

### Requirement: Ready Task Selection
The system SHALL select the next task to work on based on priority and availability.

#### Scenario: Get ready tasks
- **WHEN** GetReady() is called
- **THEN** tasks in "open" status with NULL claimed_by are returned
- **AND** soft-deleted tasks (deleted_at NOT NULL) are excluded
- **AND** tasks are sorted by priority (0 first) then created_at (oldest first)

#### Scenario: Exclude tasks with active children
- **WHEN** a task has children in "in_progress" or "pending_merge" status
- **THEN** the parent is excluded from ready list until children complete

### Requirement: Task History
The system SHALL maintain an audit log of task changes.

#### Scenario: History on status change
- **WHEN** a task's status changes
- **THEN** a history record is created with field="status", old_value, new_value, changed_at, changed_by

#### Scenario: History on claim
- **WHEN** a task is claimed
- **THEN** a history record is created with field="claimed_by", old_value=NULL, new_value=agentID

#### Scenario: Query task history
- **WHEN** GetHistory(taskID) is called
- **THEN** all history records for that task are returned
- **AND** results are ordered by changed_at descending (most recent first)

### Requirement: Database Maintenance
The system SHALL manage database size through retention policies.

#### Scenario: Soft delete closed tasks
- **WHEN** a task has been in "closed" status for longer than retention_days (default: 30)
- **THEN** the task's deleted_at is set to current timestamp
- **AND** the task is excluded from queries

#### Scenario: Hard delete soft-deleted tasks
- **WHEN** a task has deleted_at older than soft_delete_days (default: 7)
- **THEN** the task and all related records are permanently deleted

#### Scenario: Page reclamation
- **GIVEN** bbolt automatically reuses freed pages
- **WHEN** hard delete removes tasks
- **THEN** freed space is available for new data
- **AND** no explicit VACUUM operation is needed

### Requirement: Task HTTP API
The system SHALL expose all task operations via HTTP API for agent and CLI interaction.

#### Scenario: API authentication
- **GIVEN** the daemon exposes task API endpoints
- **WHEN** any task API request is made
- **THEN** the request is authenticated via the existing daemon auth mechanism
- **AND** the `X-Agent-ID` header identifies the calling agent (if applicable)

---

#### Scenario: Create task via API
- **WHEN** `POST /api/tasks` is called with body:
  ```json
  {
    "title": "Implement feature X",
    "body": "Detailed description...",
    "type": "feature",
    "priority": 1,
    "parent_id": "optional-parent-uuid",
    "tags": ["backend", "api"],
    "grimoire_hint": "optional-grimoire-name"
  }
  ```
- **THEN** a new task is created
- **AND** response is `201 Created` with the full task object including generated `id`

#### Scenario: Create task validation errors
- **WHEN** `POST /api/tasks` is called with invalid data
- **THEN** response is `400 Bad Request` with error details:
  - Missing title: `{"error": "title is required"}`
  - Invalid priority: `{"error": "priority must be 0-4"}`
  - Invalid parent: `{"error": "parent not found", "code": "PARENT_NOT_FOUND"}`
  - Invalid type: `{"error": "type must be one of: task, feature, bug"}`

#### Scenario: Create subtask via API
- **WHEN** `POST /api/tasks/:parent_id/subtasks` is called with body:
  ```json
  {
    "title": "Subtask title",
    "type": "task"
  }
  ```
- **THEN** a new task is created with `parent_id` set to the URL parameter
- **AND** depth is automatically calculated
- **AND** grimoire_hint is inherited from parent if not specified

---

#### Scenario: Get task via API
- **WHEN** `GET /api/tasks/:id` is called
- **THEN** response is `200 OK` with full task object:
  ```json
  {
    "id": "uuid",
    "title": "Task title",
    "body": "Description",
    "type": "feature",
    "status": "open",
    "priority": 2,
    "parent_id": null,
    "depth": 0,
    "tags": ["backend"],
    "claimed_by": null,
    "claimed_at": null,
    "grimoire_hint": null,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  }
  ```

#### Scenario: Get non-existent task via API
- **WHEN** `GET /api/tasks/:id` is called with non-existent ID
- **THEN** response is `404 Not Found` with `{"error": "task not found", "code": "TASK_NOT_FOUND"}`

---

#### Scenario: List tasks via API
- **WHEN** `GET /api/tasks` is called
- **THEN** response is `200 OK` with array of task objects
- **AND** soft-deleted tasks are excluded by default

#### Scenario: List tasks with filters
- **WHEN** `GET /api/tasks?status=open&priority=0,1&tag=security&type=bug` is called
- **THEN** only tasks matching ALL filters are returned
- **AND** multiple values for same filter use OR (priority=0 OR priority=1)

#### Scenario: List tasks filter options
- **GIVEN** the following query parameters are supported:
  - `status`: comma-separated list (open, in_progress, pending_merge, blocked, closed)
  - `priority`: comma-separated list (0, 1, 2, 3, 4)
  - `type`: comma-separated list (task, feature, bug)
  - `tag`: exact tag match
  - `tag_pattern`: glob pattern for tags (doublestar syntax)
  - `parent_id`: filter by parent (use `null` for root tasks only)
  - `claimed_by`: filter by agent ID (use `null` for unclaimed)
  - `include_deleted`: if `true`, include soft-deleted tasks
  - `limit`: max results (default 100, max 1000)
  - `offset`: pagination offset

#### Scenario: List ready tasks via API
- **WHEN** `GET /api/tasks/ready` is called
- **THEN** response is `200 OK` with tasks eligible for claiming
- **AND** tasks are sorted by priority (0 first), then created_at (oldest first)
- **AND** tasks with active children are excluded

---

#### Scenario: Update task via API
- **WHEN** `PATCH /api/tasks/:id` is called with body:
  ```json
  {
    "title": "Updated title",
    "body": "Updated description",
    "priority": 0
  }
  ```
- **THEN** only specified fields are updated
- **AND** response is `200 OK` with updated task object
- **AND** history records are created for each changed field

#### Scenario: Update task - immutable fields
- **WHEN** `PATCH /api/tasks/:id` attempts to change `id`, `created_at`, `depth`, `status`, or `claimed_by`
- **THEN** those fields are ignored (use dedicated endpoints for status/claim changes)
- **AND** other fields in the request are still updated

#### Scenario: Update task status via API
- **WHEN** `PATCH /api/tasks/:id/status` is called with body:
  ```json
  {
    "status": "blocked",
    "reason": "Waiting for API access"
  }
  ```
- **THEN** status is updated if transition is valid
- **AND** reason is stored in history record
- **AND** response is `200 OK` with updated task

#### Scenario: Update task status - invalid transition
- **WHEN** `PATCH /api/tasks/:id/status` attempts invalid transition (e.g., open → closed)
- **THEN** response is `400 Bad Request` with:
  ```json
  {
    "error": "invalid status transition",
    "code": "INVALID_TRANSITION",
    "current_status": "open",
    "requested_status": "closed",
    "valid_transitions": ["in_progress"]
  }
  ```

---

#### Scenario: Delete task via API
- **WHEN** `DELETE /api/tasks/:id` is called
- **THEN** task and all descendants are deleted (cascade)
- **AND** response is `204 No Content`

#### Scenario: Delete active task via API
- **WHEN** `DELETE /api/tasks/:id` is called on task with status `in_progress` or `pending_merge`
- **THEN** response is `409 Conflict` with:
  ```json
  {
    "error": "cannot delete active task",
    "code": "TASK_ACTIVE",
    "status": "in_progress"
  }
  ```

#### Scenario: Delete task with active children via API
- **WHEN** `DELETE /api/tasks/:id` is called on task with children in active status
- **THEN** response is `409 Conflict` with:
  ```json
  {
    "error": "cannot delete task with active children",
    "code": "HAS_ACTIVE_CHILDREN",
    "active_children": ["child-id-1", "child-id-2"]
  }
  ```

---

#### Scenario: Claim task via API
- **WHEN** `POST /api/tasks/:id/claim` is called with header `X-Agent-ID: agent-123`
- **AND** task is in `open` status and unclaimed
- **THEN** task is claimed by agent-123
- **AND** status transitions to `in_progress`
- **AND** response is `200 OK` with updated task

#### Scenario: Claim task - already claimed
- **WHEN** `POST /api/tasks/:id/claim` is called
- **AND** task is already claimed by another agent
- **THEN** response is `409 Conflict` with:
  ```json
  {
    "error": "task already claimed",
    "code": "ALREADY_CLAIMED",
    "claimed_by": "other-agent-id",
    "claimed_at": "2024-01-15T10:30:00Z"
  }
  ```

#### Scenario: Claim task - wrong status
- **WHEN** `POST /api/tasks/:id/claim` is called
- **AND** task status is not `open`
- **THEN** response is `409 Conflict` with:
  ```json
  {
    "error": "task not claimable",
    "code": "INVALID_STATUS",
    "status": "blocked"
  }
  ```

#### Scenario: Release task via API
- **WHEN** `POST /api/tasks/:id/release` is called with header `X-Agent-ID: agent-123`
- **AND** task is claimed by agent-123
- **THEN** claim is released
- **AND** status transitions to `open`
- **AND** response is `200 OK` with updated task

#### Scenario: Release task - not owner
- **WHEN** `POST /api/tasks/:id/release` is called
- **AND** task is claimed by a different agent
- **THEN** response is `403 Forbidden` with:
  ```json
  {
    "error": "not claim owner",
    "code": "NOT_CLAIM_OWNER",
    "claimed_by": "other-agent-id"
  }
  ```

#### Scenario: Force release task via API
- **WHEN** `POST /api/tasks/:id/release?force=true` is called by a privileged caller
- **THEN** claim is released regardless of owner
- **AND** history records the force release

---

#### Scenario: Complete task via API
- **WHEN** `POST /api/tasks/:id/complete` is called with header `X-Agent-ID: agent-123`
- **AND** task is claimed by agent-123
- **THEN** status transitions to `pending_merge` (if grimoire requires review) or `closed`
- **AND** response is `200 OK` with updated task

#### Scenario: Complete task with result
- **WHEN** `POST /api/tasks/:id/complete` is called with body:
  ```json
  {
    "result": "closed",
    "summary": "Implemented feature with 3 new endpoints",
    "skip_review": false
  }
  ```
- **THEN** task transitions to specified result status
- **AND** summary is stored in history

#### Scenario: Block task via API
- **WHEN** `POST /api/tasks/:id/block` is called with body:
  ```json
  {
    "reason": "Waiting for design review"
  }
  ```
- **AND** task is in `in_progress` status
- **THEN** status transitions to `blocked`
- **AND** reason is stored in history
- **AND** claim is released
- **AND** response is `200 OK` with updated task

#### Scenario: Unblock task via API
- **WHEN** `POST /api/tasks/:id/unblock` is called
- **AND** task is in `blocked` status
- **THEN** status transitions to `open`
- **AND** response is `200 OK` with updated task

---

#### Scenario: Reparent task via API
- **WHEN** `POST /api/tasks/:id/reparent` is called with body:
  ```json
  {
    "new_parent_id": "new-parent-uuid"
  }
  ```
- **THEN** task is reparented
- **AND** depth is recalculated for task and all descendants
- **AND** response is `200 OK` with updated task

#### Scenario: Reparent to root via API
- **WHEN** `POST /api/tasks/:id/reparent` is called with body:
  ```json
  {
    "new_parent_id": null
  }
  ```
- **THEN** task becomes a root task (depth = 0)
- **AND** all descendants depths are recalculated

#### Scenario: Reparent would create cycle
- **WHEN** `POST /api/tasks/:id/reparent` is called
- **AND** new_parent_id is a descendant of the task
- **THEN** response is `400 Bad Request` with:
  ```json
  {
    "error": "would create cycle",
    "code": "WOULD_CREATE_CYCLE"
  }
  ```

---

#### Scenario: Get subtree via API
- **WHEN** `GET /api/tasks/:id/subtree` is called
- **THEN** response is `200 OK` with task and all descendants
- **AND** tasks include `relative_depth` field (0 for queried task, 1 for children, etc.)

#### Scenario: Get ancestors via API
- **WHEN** `GET /api/tasks/:id/ancestors` is called
- **THEN** response is `200 OK` with array of ancestor tasks
- **AND** ordered from immediate parent to root

#### Scenario: Get children via API
- **WHEN** `GET /api/tasks/:id/children` is called
- **THEN** response is `200 OK` with array of direct child tasks only
- **AND** does not include grandchildren

---

#### Scenario: Add tags via API
- **WHEN** `POST /api/tasks/:id/tags` is called with body:
  ```json
  {
    "tags": ["security", "backend"]
  }
  ```
- **THEN** tags are added to the task
- **AND** duplicates are ignored
- **AND** response is `200 OK` with updated task

#### Scenario: Remove tags via API
- **WHEN** `DELETE /api/tasks/:id/tags` is called with body:
  ```json
  {
    "tags": ["backend"]
  }
  ```
- **THEN** specified tags are removed
- **AND** non-existent tags are ignored
- **AND** response is `200 OK` with updated task

#### Scenario: Replace all tags via API
- **WHEN** `PUT /api/tasks/:id/tags` is called with body:
  ```json
  {
    "tags": ["new-tag-1", "new-tag-2"]
  }
  ```
- **THEN** all existing tags are replaced with new tags
- **AND** response is `200 OK` with updated task

---

#### Scenario: Get task history via API
- **WHEN** `GET /api/tasks/:id/history` is called
- **THEN** response is `200 OK` with array of history entries:
  ```json
  [
    {
      "field": "status",
      "old_value": "open",
      "new_value": "in_progress",
      "changed_at": "2024-01-15T10:30:00Z",
      "changed_by": "agent-123"
    }
  ]
  ```
- **AND** results are ordered by changed_at descending

#### Scenario: Get task history with filters
- **WHEN** `GET /api/tasks/:id/history?field=status&since=2024-01-01T00:00:00Z` is called
- **THEN** only history entries matching filters are returned

---

#### Scenario: Bulk update tasks via API
- **WHEN** `POST /api/tasks/bulk` is called with body:
  ```json
  {
    "action": "add_tags",
    "task_ids": ["id1", "id2", "id3"],
    "tags": ["batch-processed"]
  }
  ```
- **THEN** all specified tasks are updated
- **AND** response includes success/failure for each task:
  ```json
  {
    "results": [
      {"id": "id1", "success": true},
      {"id": "id2", "success": true},
      {"id": "id3", "success": false, "error": "task not found"}
    ]
  }
  ```

#### Scenario: Bulk close tasks via API
- **WHEN** `POST /api/tasks/bulk` is called with body:
  ```json
  {
    "action": "close",
    "task_ids": ["id1", "id2"],
    "reason": "Batch closure"
  }
  ```
- **THEN** all specified tasks are closed (if valid transition)
- **AND** tasks that cannot be closed report errors in results

#### Scenario: Bulk operations supported
- **GIVEN** the following bulk actions are supported:
  - `add_tags`: Add tags to multiple tasks
  - `remove_tags`: Remove tags from multiple tasks
  - `close`: Close multiple tasks
  - `delete`: Delete multiple tasks
  - `set_priority`: Set priority on multiple tasks

---

#### Scenario: API error response format
- **GIVEN** all API errors use consistent format:
  ```json
  {
    "error": "human readable message",
    "code": "MACHINE_READABLE_CODE",
    "details": {}
  }
  ```
- **WHEN** an error occurs
- **THEN** appropriate HTTP status code is returned
- **AND** error body follows the format above

#### Scenario: API error codes
- **GIVEN** the following error codes are used:
  - `TASK_NOT_FOUND`: 404 - Task does not exist
  - `PARENT_NOT_FOUND`: 400 - Parent task does not exist
  - `INVALID_PRIORITY`: 400 - Priority out of range
  - `INVALID_TYPE`: 400 - Unknown task type
  - `INVALID_STATUS`: 400 - Unknown status value
  - `INVALID_TRANSITION`: 400 - Status transition not allowed
  - `INVALID_TAG`: 400 - Empty or invalid tag
  - `ALREADY_CLAIMED`: 409 - Task claimed by another agent
  - `NOT_CLAIM_OWNER`: 403 - Caller is not the claim owner
  - `TASK_ACTIVE`: 409 - Cannot perform action on active task
  - `HAS_ACTIVE_CHILDREN`: 409 - Task has active children
  - `WOULD_CREATE_CYCLE`: 400 - Reparent would create cycle
  - `INTERNAL_ERROR`: 500 - Unexpected server error
