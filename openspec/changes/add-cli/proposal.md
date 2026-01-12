# Change: Add CLI for Coven Daemon (coven)

## Why

Agents need programmatic access to task management during workflow execution:
1. **Task decomposition** - Agent working on feature X discovers it needs subtasks A, B, C
2. **Progress tracking** - Agent marks tasks complete, blocked, or creates follow-up work
3. **Context gathering** - Agent queries task hierarchy, history, and related tasks
4. **Workflow coordination** - Agent claims next task, checks what's ready

Additionally, power users benefit from CLI access for:
- Scripting and automation
- Terminal-based workflows without VS Code
- Debugging and inspection

## What Changes

### CLI Binary

- **ADDED** `coven` CLI binary (Go, uses daemon HTTP API)
- **ADDED** Automatic daemon discovery via `.coven/covend.sock`
- **ADDED** JSON output mode for all commands (`--json`)
- **ADDED** Agent mode (`--agent-id`) for agent-initiated operations

### Task Commands

- **ADDED** `coven task create` - Create tasks with full options
- **ADDED** `coven task show <id>` - Display task details
- **ADDED** `coven task list` - List tasks with filters
- **ADDED** `coven task update <id>` - Update task properties
- **ADDED** `coven task delete <id>` - Delete task (cascade)
- **ADDED** `coven task ready` - Show claimable tasks

### Task Lifecycle Commands

- **ADDED** `coven task claim <id>` - Claim a task
- **ADDED** `coven task release <id>` - Release claim
- **ADDED** `coven task complete <id>` - Complete task
- **ADDED** `coven task block <id>` - Block task with reason
- **ADDED** `coven task unblock <id>` - Unblock task

### Task Hierarchy Commands

- **ADDED** `coven task subtree <id>` - Show task and descendants
- **ADDED** `coven task ancestors <id>` - Show ancestors to root
- **ADDED** `coven task children <id>` - Show direct children
- **ADDED** `coven task reparent <id> <new-parent>` - Move task

### Task Tag Commands

- **ADDED** `coven task tag add <id> <tags...>` - Add tags
- **ADDED** `coven task tag remove <id> <tags...>` - Remove tags
- **ADDED** `coven task tag set <id> <tags...>` - Replace all tags

### Task History Commands

- **ADDED** `coven task history <id>` - Show audit log

### Bulk Commands

- **ADDED** `coven task bulk close <ids...>` - Close multiple tasks
- **ADDED** `coven task bulk delete <ids...>` - Delete multiple tasks
- **ADDED** `coven task bulk tag add <ids...> --tags=...` - Tag multiple tasks

### Session Commands (existing, expanded)

- **ADDED** `coven session start` - Start session
- **ADDED** `coven session stop` - Stop session
- **ADDED** `coven session status` - Show session state

### Daemon Commands

- **ADDED** `coven daemon status` - Check daemon health
- **ADDED** `coven daemon stop` - Stop daemon gracefully

## Impact

- **Affected specs:** cli (new comprehensive spec)
- **Affected code:**
  - `cmd/coven/` → new CLI binary
  - Uses daemon HTTP API (no direct store access)
- **Dependencies:**
  - Requires `add-task-store` (Task HTTP API must exist)

## Key Design Decisions

1. **Thin client** - CLI is a wrapper around HTTP API, no business logic
2. **Agent-friendly** - `--agent-id` flag for agent operations, `--json` for parsing
3. **Ergonomic** - Short aliases, sensible defaults, tab completion
4. **Scriptable** - Exit codes, JSON output, stdin support for bulk operations

See `specs/cli/spec.md` for detailed command specifications.
