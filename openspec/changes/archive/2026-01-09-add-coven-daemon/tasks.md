## 1. Monorepo Setup

- [ ] 1.1 Create root package.json with workspaces config
- [ ] 1.2 Move existing src/ to packages/vscode/src/
- [ ] 1.3 Move existing package.json to packages/vscode/
- [ ] 1.4 Update packages/vscode/tsconfig.json paths
- [ ] 1.5 Create packages/daemon/ directory structure
- [ ] 1.6 Initialize Go module in packages/daemon/
- [ ] 1.7 Create Makefile for daemon build/test
- [ ] 1.8 Update root scripts to run workspace commands
- [ ] 1.9 Verify `npm install` works from root
- [ ] 1.10 Verify `npm test` runs vscode tests
- [ ] 1.11 Update CI workflow for monorepo structure

## 2. Daemon Core Infrastructure

- [ ] 2.1 Implement Unix socket HTTP server (`internal/api/server.go`)
- [ ] 2.2 Implement daemon lifecycle (start, shutdown, PID file)
- [ ] 2.3 Implement stale socket detection and cleanup
- [ ] 2.4 Implement structured logging to file
- [ ] 2.5 Implement configuration loading from `.coven/config.json`
- [ ] 2.6 Implement state persistence to `.coven/state.json`

## 3. State Management

- [ ] 3.1 Define state types (`pkg/types/types.go`)
- [ ] 3.2 Implement in-memory state store (`internal/state/store.go`)
- [ ] 3.3 Implement state persistence/recovery (`internal/state/persist.go`)
- [ ] 3.4 Implement GET /state endpoint
- [ ] 3.5 Implement GET /health endpoint
- [ ] 3.6 Implement GET /version endpoint

## 4. Beads Integration

- [ ] 4.1 Implement beads CLI wrapper (`internal/beads/client.go`)
- [ ] 4.2 Implement `bd ready --json` parsing
- [ ] 4.3 Implement `bd update` for status changes
- [ ] 4.4 Implement polling loop (1s interval)
- [ ] 4.5 Implement GET /tasks endpoint (returns cached tasks)
- [ ] 4.6 Emit `tasks.changed` events on poll delta

## 5. SSE Event Stream

- [ ] 5.1 Implement SSE handler (`internal/api/events.go`)
- [ ] 5.2 Implement event broadcast to all clients
- [ ] 5.3 Implement heartbeat (state.snapshot every 30s)
- [ ] 5.4 Implement client disconnect cleanup
- [ ] 5.5 Add event types: session.*, tasks.*, agent.*

## 6. Session Control

- [ ] 6.1 Implement POST /session/start
- [ ] 6.2 Implement POST /session/stop
- [ ] 6.3 Implement force stop with SIGKILL
- [ ] 6.4 Implement session state persistence
- [ ] 6.5 Implement session recovery on daemon restart

## 7. Worktree Management

- [ ] 7.1 Implement worktree creation (`internal/git/worktree.go`)
- [ ] 7.2 Implement worktree cleanup
- [ ] 7.3 Implement orphan worktree detection on startup
- [ ] 7.4 Implement orphan recovery flow

## 8. Agent Process Management

- [ ] 8.1 Implement agent spawning (`internal/agent/process.go`)
- [ ] 8.2 Implement output capture with sequence numbers
- [ ] 8.3 Implement output ring buffer (10MB cap)
- [ ] 8.4 Implement process info persistence
- [ ] 8.5 Implement graceful termination (SIGTERM -> SIGKILL)
- [ ] 8.6 Implement timeout handling
- [ ] 8.7 Implement completion detection
- [ ] 8.8 Implement failure detection

## 9. Agent API

- [ ] 9.1 Implement GET /agents endpoint
- [ ] 9.2 Implement GET /agents/:id/output endpoint
- [ ] 9.3 Implement POST /agents/:id/kill endpoint
- [ ] 9.4 Implement POST /agents/:id/respond endpoint

## 10. Question Handling

- [ ] 10.1 Implement question detection from agent output
- [ ] 10.2 Implement question parsing and categorization
- [ ] 10.3 Implement GET /questions endpoint
- [ ] 10.4 Implement response injection to agent stdin
- [ ] 10.5 Implement unanswered question reminders

## 11. Scheduler

- [ ] 11.1 Implement reconciliation loop (`internal/scheduler/scheduler.go`)
- [ ] 11.2 Implement ready task selection from beads cache
- [ ] 11.3 Implement agent slot management (maxAgents)
- [ ] 11.4 Implement task assignment (calls bd update)
- [ ] 11.5 Implement scheduler start/stop on session lifecycle

## 12. Task API

- [ ] 12.1 Implement POST /tasks/:id/start (force start)
- [ ] 12.2 Implement POST /tasks/:id/stop (stop agent)

## 13. Unit Tests

- [ ] 13.1 Set up Go test infrastructure with coverage
- [ ] 13.2 Configure 80% coverage threshold in Makefile
- [ ] 13.3 Unit tests for state/store.go
- [ ] 13.4 Unit tests for state/persist.go
- [ ] 13.5 Unit tests for beads/client.go (mock bd CLI)
- [ ] 13.6 Unit tests for scheduler/scheduler.go
- [ ] 13.7 Unit tests for agent/output.go (ring buffer)
- [ ] 13.8 Unit tests for agent/process.go (mock process)
- [ ] 13.9 Unit tests for api/ handlers
- [ ] 13.10 Unit tests for config/config.go
- [ ] 13.11 Verify coverage meets 80% threshold

## 14. Daemon E2E Tests

- [ ] 14.1 Set up E2E test infrastructure (temp repos, daemon lifecycle)
- [ ] 14.2 Create mock agent binary for fast E2E tests
- [ ] 14.3 Test: daemon starts and creates socket
- [ ] 14.4 Test: daemon handles stale socket
- [ ] 14.5 Test: session start/stop lifecycle
- [ ] 14.6 Test: task sync from beads via bd ready
- [ ] 14.7 Test: agent spawns for ready task
- [ ] 14.8 Test: agent completion updates task via bd update
- [ ] 14.9 Test: agent timeout handling
- [ ] 14.10 Test: question detection and response
- [ ] 14.11 Test: graceful shutdown stops agents
- [ ] 14.12 Test: state recovery after daemon restart
- [ ] 14.13 Test: SSE event delivery
- [ ] 14.14 Test: concurrent agent operations

