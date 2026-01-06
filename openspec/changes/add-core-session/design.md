## Context
Coven orchestrates multiple AI agents working in parallel. The core layer must manage complex state transitions, handle concurrent operations safely, and provide a clean API for the UI layer.

## Goals / Non-Goals
- **Goals**:
  - Type-safe state management
  - Event-driven architecture for UI reactivity
  - Clean separation between orchestration and external integrations
  - Support for concurrent agent operations
- **Non-Goals**:
  - Distributed/multi-machine coordination (single VSCode instance only)
  - Real-time collaboration features
  - Agent implementation details (delegated to AgentProvider)

## Decisions

### Decision: EventEmitter for State Changes
Use Node.js EventEmitter pattern for state change notifications rather than observables or signals.
- **Rationale**: Native to Node.js, well understood, sufficient for single-process VSCode extension
- **Alternatives considered**: RxJS (too heavy), custom pub/sub (reinventing wheel)

### Decision: Immutable State Snapshots
`getState()` returns immutable snapshots; mutations go through methods that emit events.
- **Rationale**: Prevents UI from accidentally mutating state, makes debugging easier
- **Alternatives considered**: Proxy-based reactive state (complexity not warranted)

### Decision: Task Status State Machine
Tasks follow a strict state machine: ready → working → review → done (with blocked as side state).
- **Rationale**: Clear lifecycle, prevents invalid transitions
- **Alternatives considered**: Free-form status (harder to reason about)

### Decision: Workspace Storage for Persistence
Use VSCode workspace storage API for session/task persistence, not filesystem.
- **Rationale**: Built-in, handles cleanup, workspace-scoped
- **Alternatives considered**: JSON files in .coven/ (manual cleanup burden)

### Decision: Session Persistence Across Restarts
Session state survives VSCode restart automatically.
- **Rationale**: Losing work state on restart would be frustrating; sessions can be long-running
- **Implementation**: Persist to workspace storage on every state change; restore on activation
- **User control**: User can explicitly end session to clear state

### Decision: Orphan Recovery Strategy
Attempt to rescue orphaned familiars rather than discard them.
- **Rationale**: Agents may have done significant work; better to continue than restart
- **Recovery flow**:
  1. On restart, detect worktrees from previous session
  2. Check if agent process is still running (store PID, check process table)
  3. If agent alive → reconnect to output stream, resume monitoring
  4. If agent dead but worktree has uncommitted changes → offer to spawn new agent to continue
  5. If agent dead and worktree clean → task was likely complete, check for unmerged commits
- **Alternatives considered**: Always clean up orphans (loses work), always restart from scratch (wasteful)

## Risks / Trade-offs
- **EventEmitter memory leaks** → Ensure proper listener cleanup in dispose methods
- **Concurrent state mutations** → Use async mutex for critical sections
- **Large state objects** → Consider pagination for task lists > 100 items
- **Stale PIDs** → PID could be reused by different process; verify process is actually claude
- **Partial agent state** → Reconnected agent loses conversation history; may need context re-injection
