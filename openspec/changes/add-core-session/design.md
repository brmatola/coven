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

### Decision: .coven/ Directory for Persistence
Use `.coven/` directory with JSON files for session/task persistence, not VSCode workspace storage.
- **Rationale**: Git-trackable (or .gitignore-able), inspectable/debuggable, exportable, no VSCode API coupling, avoids sync issues between two storage systems
- **Alternatives considered**: VSCode workspace storage (opaque, not inspectable, API coupling)

**Directory Structure:**
```
.coven/
├── .gitignore        # Excludes ephemeral state from git
├── session.json      # Current session state
├── tasks.json        # Task queue and history
├── config.json       # Session configuration
├── familiars/        # Per-agent state (gitignored)
│   └── {taskId}.json # Agent state, PID info, output buffer
└── logs/             # Debug logs (gitignored)
    └── {date}.jsonl  # Structured event log (one JSON object per line)
```

**Default .gitignore:**
```
# Ephemeral runtime state
familiars/
logs/

# Keep config trackable if user wants
!config.json
```

### Decision: Session Persistence Across Restarts
Session state survives VSCode restart automatically.
- **Rationale**: Losing work state on restart would be frustrating; sessions can be long-running
- **Implementation**: Persist to `.coven/` on every state change; restore on activation
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

### Decision: Robust Process Tracking
Store comprehensive process information for reliable orphan detection and reconnection.
- **Rationale**: PIDs can be reused by OS; need additional signals to verify process identity
- **Implementation**: Store `{ pid, startTime, command, worktreePath }` in `.coven/familiars/{taskId}.json`
- **Verification**: On reconnect, check process exists AND start time matches AND command contains "claude"
- **Alternatives considered**: Just PID (unreliable), process groups (platform-specific complexity)

### Decision: Structured Event Logging
Maintain a persistent, structured log of session events for debugging and auditability.
- **Rationale**: Debugging agent orchestration issues requires visibility into state transitions, errors, and timing
- **Implementation**: JSONL format in `.coven/logs/{date}.jsonl`, one event per line
- **Log levels**: debug, info, warn, error
- **Events logged**: state transitions, agent spawns/terminations, questions, merges, errors, sync events
- **Retention**: Logs persist until session is explicitly ended or cleaned up

## Risks / Trade-offs
- **EventEmitter memory leaks** → Ensure proper listener cleanup in dispose methods
- **Concurrent state mutations** → Use async mutex for critical sections
- **Large state objects** → Consider pagination for task lists > 100 items
- **Partial agent state** → Reconnected agent loses conversation history; may need context re-injection
- **Log file growth** → Implement log rotation or size limits for long-running sessions
