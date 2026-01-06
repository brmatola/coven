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

## Risks / Trade-offs
- **EventEmitter memory leaks** → Ensure proper listener cleanup in dispose methods
- **Concurrent state mutations** → Use async mutex for critical sections
- **Large state objects** → Consider pagination for task lists > 100 items

## Open Questions
- Should session state survive VSCode restart? (Leaning yes, with user confirmation)
- How to handle orphaned familiars from crashed sessions?
