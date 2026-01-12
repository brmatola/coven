# CLI Spec

## ADDED Requirements

### Requirement: CLI Binary
The system SHALL provide a `coven` CLI binary for terminal-based daemon interaction.

#### Scenario: CLI discovers daemon
- **WHEN** user runs any `coven` command
- **THEN** CLI searches for `.coven/covend.sock` starting from CWD up to root
- **AND** connects via Unix socket HTTP

#### Scenario: CLI daemon not running
- **WHEN** CLI cannot connect to daemon socket
- **THEN** CLI exits with code 1
- **AND** prints: "Error: daemon not running. Start VS Code with Coven extension or run 'covend'"

#### Scenario: CLI JSON output mode
- **WHEN** user runs `coven <command> --json`
- **THEN** output is valid JSON (no human formatting)
- **AND** errors are JSON: `{"error": "message", "code": "CODE"}`

#### Scenario: CLI agent mode
- **WHEN** user runs `coven <command> --agent-id=agent-123`
- **THEN** CLI sets `X-Agent-ID: agent-123` header on all API requests
- **AND** agent ID is used for claim/release operations

#### Scenario: CLI exit codes
- **GIVEN** exit codes follow convention:
  - 0: Success
  - 1: General error (daemon not running, network error)
  - 2: Invalid arguments / usage error
  - 10: Task not found
  - 11: Invalid status transition
  - 12: Already claimed
  - 13: Not claim owner
  - 14: Would create cycle

---

### Requirement: Task CRUD Commands
The CLI SHALL support creating, reading, updating, and deleting tasks.

#### Scenario: Create task
- **WHEN** user runs:
  ```bash
  coven task create --title="Implement auth" --type=feature --priority=1
  ```
- **THEN** CLI calls `POST /api/tasks`
- **AND** prints created task ID
- **AND** exits 0

#### Scenario: Create task with all options
- **WHEN** user runs:
  ```bash
  coven task create \
    --title="Implement auth" \
    --body="Add OAuth2 support" \
    --type=feature \
    --priority=1 \
    --parent=<parent-id> \
    --tags=backend,security \
    --grimoire=security-audit
  ```
- **THEN** CLI creates task with all specified properties

#### Scenario: Create task from stdin
- **WHEN** user runs:
  ```bash
  echo '{"title":"From JSON","type":"task"}' | coven task create --stdin
  ```
- **THEN** CLI reads JSON from stdin
- **AND** creates task with those properties

#### Scenario: Create subtask shorthand
- **WHEN** user runs:
  ```bash
  coven task create --title="Subtask" --parent=<id>
  ```
- **THEN** CLI calls `POST /api/tasks` with parent_id
- **AND** depth is auto-calculated

#### Scenario: Show task
- **WHEN** user runs `coven task show <id>`
- **THEN** CLI calls `GET /api/tasks/<id>`
- **AND** prints formatted task details:
  ```
  ID:        abc-123
  Title:     Implement auth
  Type:      feature
  Status:    open
  Priority:  P1
  Parent:    (none)
  Tags:      backend, security
  Created:   2024-01-15 10:30:00
  Updated:   2024-01-15 10:30:00
  ```

#### Scenario: Show task not found
- **WHEN** user runs `coven task show <non-existent-id>`
- **THEN** CLI prints: "Error: task not found"
- **AND** exits 10

#### Scenario: List tasks
- **WHEN** user runs `coven task list`
- **THEN** CLI calls `GET /api/tasks`
- **AND** prints table:
  ```
  ID        STATUS       PRI  TITLE
  abc-123   open         P1   Implement auth
  def-456   in_progress  P2   Write tests
  ```

#### Scenario: List tasks with filters
- **WHEN** user runs:
  ```bash
  coven task list --status=open,blocked --priority=0,1 --tag=security
  ```
- **THEN** CLI calls `GET /api/tasks?status=open,blocked&priority=0,1&tag=security`

#### Scenario: List tasks filter options
- **GIVEN** the following flags are supported:
  - `--status=<statuses>`: Comma-separated (open, in_progress, pending_merge, blocked, closed)
  - `--priority=<priorities>`: Comma-separated (0-4)
  - `--type=<types>`: Comma-separated (task, feature, bug)
  - `--tag=<tag>`: Exact tag match
  - `--tag-pattern=<glob>`: Glob pattern for tags
  - `--parent=<id>`: Filter by parent (use "null" for roots only)
  - `--claimed-by=<agent>`: Filter by claiming agent
  - `--limit=<n>`: Max results (default 100)
  - `--offset=<n>`: Pagination offset

#### Scenario: List ready tasks
- **WHEN** user runs `coven task ready`
- **THEN** CLI calls `GET /api/tasks/ready`
- **AND** prints claimable tasks sorted by priority

#### Scenario: Update task
- **WHEN** user runs:
  ```bash
  coven task update <id> --title="New title" --priority=0
  ```
- **THEN** CLI calls `PATCH /api/tasks/<id>`
- **AND** prints updated task

#### Scenario: Delete task
- **WHEN** user runs `coven task delete <id>`
- **THEN** CLI prompts: "Delete task <id> and all children? [y/N]"
- **WHEN** user confirms
- **THEN** CLI calls `DELETE /api/tasks/<id>`
- **AND** prints: "Deleted task <id> (and N children)"

#### Scenario: Delete task force
- **WHEN** user runs `coven task delete <id> --force`
- **THEN** CLI deletes without confirmation

#### Scenario: Delete active task error
- **WHEN** user runs `coven task delete <id>` on in_progress task
- **THEN** CLI prints: "Error: cannot delete active task (status: in_progress)"
- **AND** exits 11

---

### Requirement: Task Lifecycle Commands
The CLI SHALL support task claiming and status transitions.

#### Scenario: Claim task
- **WHEN** user runs `coven task claim <id> --agent-id=agent-123`
- **THEN** CLI calls `POST /api/tasks/<id>/claim` with X-Agent-ID header
- **AND** prints: "Claimed task <id>"

#### Scenario: Claim already claimed
- **WHEN** user runs `coven task claim <id>` on already claimed task
- **THEN** CLI prints: "Error: task already claimed by <other-agent>"
- **AND** exits 12

#### Scenario: Release task
- **WHEN** user runs `coven task release <id> --agent-id=agent-123`
- **THEN** CLI calls `POST /api/tasks/<id>/release`
- **AND** prints: "Released task <id>"

#### Scenario: Release not owner
- **WHEN** user runs `coven task release <id>` but agent doesn't own claim
- **THEN** CLI prints: "Error: not claim owner (claimed by <other-agent>)"
- **AND** exits 13

#### Scenario: Complete task
- **WHEN** user runs `coven task complete <id> --agent-id=agent-123`
- **THEN** CLI calls `POST /api/tasks/<id>/complete`
- **AND** prints: "Completed task <id> (status: pending_merge)" or "(status: closed)"

#### Scenario: Complete task with summary
- **WHEN** user runs:
  ```bash
  coven task complete <id> --summary="Implemented 3 endpoints"
  ```
- **THEN** CLI includes summary in request body

#### Scenario: Block task
- **WHEN** user runs:
  ```bash
  coven task block <id> --reason="Waiting for API access"
  ```
- **THEN** CLI calls `POST /api/tasks/<id>/block`
- **AND** prints: "Blocked task <id>"

#### Scenario: Block task requires reason
- **WHEN** user runs `coven task block <id>` without --reason
- **THEN** CLI prompts for reason interactively
- **OR** reads from stdin if piped

#### Scenario: Unblock task
- **WHEN** user runs `coven task unblock <id>`
- **THEN** CLI calls `POST /api/tasks/<id>/unblock`
- **AND** prints: "Unblocked task <id> (status: open)"

---

### Requirement: Task Hierarchy Commands
The CLI SHALL support navigating and modifying task hierarchy.

#### Scenario: Show subtree
- **WHEN** user runs `coven task subtree <id>`
- **THEN** CLI calls `GET /api/tasks/<id>/subtree`
- **AND** prints tree visualization:
  ```
  abc-123  Implement auth (feature, P1, open)
  ├── def-456  Add OAuth provider (task, P2, open)
  │   └── ghi-789  Write OAuth tests (task, P3, open)
  └── jkl-012  Add session management (task, P2, blocked)
  ```

#### Scenario: Show subtree flat
- **WHEN** user runs `coven task subtree <id> --flat`
- **THEN** CLI prints flat list with depth indicator:
  ```
  0  abc-123  Implement auth
  1  def-456  Add OAuth provider
  2  ghi-789  Write OAuth tests
  1  jkl-012  Add session management
  ```

#### Scenario: Show ancestors
- **WHEN** user runs `coven task ancestors <id>`
- **THEN** CLI calls `GET /api/tasks/<id>/ancestors`
- **AND** prints path from task to root:
  ```
  ghi-789  Write OAuth tests
    ↑
  def-456  Add OAuth provider
    ↑
  abc-123  Implement auth (root)
  ```

#### Scenario: Show children
- **WHEN** user runs `coven task children <id>`
- **THEN** CLI calls `GET /api/tasks/<id>/children`
- **AND** prints direct children only (not grandchildren)

#### Scenario: Reparent task
- **WHEN** user runs `coven task reparent <id> <new-parent-id>`
- **THEN** CLI calls `POST /api/tasks/<id>/reparent`
- **AND** prints: "Reparented task <id> under <new-parent-id>"

#### Scenario: Reparent to root
- **WHEN** user runs `coven task reparent <id> --root`
- **THEN** CLI calls reparent with null parent
- **AND** prints: "Moved task <id> to root level"

#### Scenario: Reparent would create cycle
- **WHEN** user runs `coven task reparent <id> <descendant-id>`
- **THEN** CLI prints: "Error: would create cycle"
- **AND** exits 14

---

### Requirement: Task Tag Commands
The CLI SHALL support tag management.

#### Scenario: Add tags
- **WHEN** user runs `coven task tag add <id> security backend api`
- **THEN** CLI calls `POST /api/tasks/<id>/tags`
- **AND** prints: "Added tags: security, backend, api"

#### Scenario: Remove tags
- **WHEN** user runs `coven task tag remove <id> backend`
- **THEN** CLI calls `DELETE /api/tasks/<id>/tags`
- **AND** prints: "Removed tags: backend"

#### Scenario: Set tags (replace all)
- **WHEN** user runs `coven task tag set <id> new-tag-1 new-tag-2`
- **THEN** CLI calls `PUT /api/tasks/<id>/tags`
- **AND** prints: "Set tags: new-tag-1, new-tag-2"

#### Scenario: List tags
- **WHEN** user runs `coven task tag list <id>`
- **THEN** CLI prints tags one per line (for scripting)

---

### Requirement: Task History Commands
The CLI SHALL support viewing task audit history.

#### Scenario: Show history
- **WHEN** user runs `coven task history <id>`
- **THEN** CLI calls `GET /api/tasks/<id>/history`
- **AND** prints formatted history:
  ```
  2024-01-15 10:30:00  agent-123    status      open → in_progress
  2024-01-15 10:30:00  agent-123    claimed_by  (none) → agent-123
  2024-01-15 09:00:00  user         priority    2 → 1
  2024-01-15 08:00:00  system       created     (new task)
  ```

#### Scenario: Show history filtered
- **WHEN** user runs `coven task history <id> --field=status --since=2024-01-01`
- **THEN** CLI filters history by field and date

#### Scenario: Show history JSON
- **WHEN** user runs `coven task history <id> --json`
- **THEN** CLI outputs raw JSON array from API

---

### Requirement: Bulk Commands
The CLI SHALL support bulk operations on multiple tasks.

#### Scenario: Bulk close
- **WHEN** user runs `coven task bulk close <id1> <id2> <id3>`
- **THEN** CLI calls `POST /api/tasks/bulk` with action=close
- **AND** prints results:
  ```
  id1: closed
  id2: closed
  id3: error - cannot close (status: in_progress)
  ```

#### Scenario: Bulk delete
- **WHEN** user runs `coven task bulk delete <id1> <id2> --force`
- **THEN** CLI deletes multiple tasks
- **AND** prints results for each

#### Scenario: Bulk tag add
- **WHEN** user runs `coven task bulk tag add <id1> <id2> --tags=batch,processed`
- **THEN** CLI adds tags to multiple tasks

#### Scenario: Bulk from stdin
- **WHEN** user runs:
  ```bash
  coven task list --status=blocked --json | jq -r '.[].id' | coven task bulk close --stdin
  ```
- **THEN** CLI reads task IDs from stdin (one per line)
- **AND** performs bulk operation

#### Scenario: Bulk set priority
- **WHEN** user runs `coven task bulk priority <id1> <id2> --priority=0`
- **THEN** CLI sets priority on multiple tasks

---

### Requirement: Session Commands
The CLI SHALL support session management.

#### Scenario: Start session
- **WHEN** user runs `coven session start`
- **THEN** CLI calls `POST /api/session/start`
- **AND** prints: "Session started"

#### Scenario: Start session with branch
- **WHEN** user runs `coven session start --branch=feature-x`
- **THEN** CLI starts session targeting specific branch

#### Scenario: Stop session
- **WHEN** user runs `coven session stop`
- **THEN** CLI calls `POST /api/session/stop`
- **AND** prints: "Session stopped"

#### Scenario: Session status
- **WHEN** user runs `coven session status`
- **THEN** CLI calls `GET /api/session`
- **AND** prints:
  ```
  Session: active
  Branch:  feature-x
  Tasks:   3 open, 1 in_progress, 2 completed
  Agents:  1 running
  ```

---

### Requirement: Daemon Commands
The CLI SHALL support daemon management.

#### Scenario: Daemon status
- **WHEN** user runs `coven daemon status`
- **THEN** CLI calls `GET /health`
- **AND** prints:
  ```
  Daemon:   running
  PID:      12345
  Socket:   /path/to/.coven/covend.sock
  Uptime:   2h 30m
  Tasks:    15 total (5 open, 3 in_progress, 7 closed)
  ```

#### Scenario: Daemon stop
- **WHEN** user runs `coven daemon stop`
- **THEN** CLI calls `POST /shutdown`
- **AND** prints: "Daemon stopped"

#### Scenario: Daemon logs
- **WHEN** user runs `coven daemon logs`
- **THEN** CLI streams daemon logs to stdout
- **AND** supports `--follow` for live tailing

---

### Requirement: Output Formatting
The CLI SHALL support multiple output formats.

#### Scenario: Table output (default)
- **WHEN** user runs `coven task list`
- **THEN** output is human-readable table with aligned columns

#### Scenario: JSON output
- **WHEN** user runs `coven task list --json`
- **THEN** output is JSON array, suitable for `jq`

#### Scenario: Quiet output
- **WHEN** user runs `coven task create --title="X" --quiet`
- **THEN** output is just the task ID (for scripting)

#### Scenario: Wide output
- **WHEN** user runs `coven task list --wide`
- **THEN** table includes additional columns (body preview, claimed_by, created_at)

#### Scenario: No headers
- **WHEN** user runs `coven task list --no-headers`
- **THEN** table omits header row (for scripting)

---

### Requirement: Shell Completion
The CLI SHALL support shell completion for common shells.

#### Scenario: Generate bash completion
- **WHEN** user runs `coven completion bash`
- **THEN** CLI outputs bash completion script

#### Scenario: Generate zsh completion
- **WHEN** user runs `coven completion zsh`
- **THEN** CLI outputs zsh completion script

#### Scenario: Generate fish completion
- **WHEN** user runs `coven completion fish`
- **THEN** CLI outputs fish completion script

#### Scenario: Task ID completion
- **GIVEN** completion is installed
- **WHEN** user types `coven task show <TAB>`
- **THEN** shell suggests recent/open task IDs

---

### Requirement: Help and Documentation
The CLI SHALL provide comprehensive help.

#### Scenario: Global help
- **WHEN** user runs `coven --help` or `coven help`
- **THEN** CLI prints overview of all commands

#### Scenario: Command help
- **WHEN** user runs `coven task create --help`
- **THEN** CLI prints detailed help for that command including all flags

#### Scenario: Subcommand help
- **WHEN** user runs `coven task --help`
- **THEN** CLI prints list of task subcommands

#### Scenario: Version
- **WHEN** user runs `coven --version`
- **THEN** CLI prints version info: "coven v1.0.0 (commit abc123)"
