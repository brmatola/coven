# Implementation Tasks

## Dependencies

- Requires: `add-task-store` (Task HTTP API must be implemented first)

## Phase 1: Core CLI Infrastructure

- [ ] Set up `cmd/coven/` with cobra command structure
- [ ] Implement daemon socket discovery (walk up from CWD)
- [ ] Implement HTTP client for Unix socket
- [ ] Add global flags: `--json`, `--agent-id`, `--quiet`
- [ ] Add exit code handling per spec
- [ ] Add `coven --version` and `coven --help`

## Phase 2: Task CRUD Commands

- [ ] `coven task create` with all flags
- [ ] `coven task create --stdin` for JSON input
- [ ] `coven task show <id>`
- [ ] `coven task list` with filter flags
- [ ] `coven task ready`
- [ ] `coven task update <id>`
- [ ] `coven task delete <id>` with confirmation

## Phase 3: Task Lifecycle Commands

- [ ] `coven task claim <id>`
- [ ] `coven task release <id>`
- [ ] `coven task complete <id>` with `--summary`
- [ ] `coven task block <id>` with `--reason`
- [ ] `coven task unblock <id>`

## Phase 4: Task Hierarchy Commands

- [ ] `coven task subtree <id>` with tree visualization
- [ ] `coven task subtree <id> --flat`
- [ ] `coven task ancestors <id>`
- [ ] `coven task children <id>`
- [ ] `coven task reparent <id> <new-parent>`

## Phase 5: Task Tag & History Commands

- [ ] `coven task tag add <id> <tags...>`
- [ ] `coven task tag remove <id> <tags...>`
- [ ] `coven task tag set <id> <tags...>`
- [ ] `coven task tag list <id>`
- [ ] `coven task history <id>` with filters

## Phase 6: Bulk Commands

- [ ] `coven task bulk close <ids...>`
- [ ] `coven task bulk delete <ids...>`
- [ ] `coven task bulk tag add <ids...> --tags=...`
- [ ] `coven task bulk priority <ids...> --priority=N`
- [ ] `--stdin` support for reading IDs from pipe

## Phase 7: Session & Daemon Commands

- [ ] `coven session start`
- [ ] `coven session stop`
- [ ] `coven session status`
- [ ] `coven daemon status`
- [ ] `coven daemon stop`
- [ ] `coven daemon logs` with `--follow`

## Phase 8: Output Formatting

- [ ] Table output with aligned columns
- [ ] JSON output for all commands
- [ ] `--wide` for additional columns
- [ ] `--no-headers` for scripting
- [ ] `--quiet` for minimal output

## Phase 9: Shell Completion & Polish

- [ ] `coven completion bash`
- [ ] `coven completion zsh`
- [ ] `coven completion fish`
- [ ] Task ID completion suggestions
- [ ] Add CLI to Makefile build targets

## Phase 10: Testing

- [ ] Unit tests for command parsing
- [ ] Integration tests against mock daemon
- [ ] E2E tests for critical paths (create → claim → complete)
