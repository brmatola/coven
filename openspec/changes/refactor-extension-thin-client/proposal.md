# Change: Refactor Extension to Thin Daemon Client

## Why

The daemon (`covend`) handles orchestration with a rich workflow model:
- **Grimoires**: Multi-step workflow definitions
- **Spells**: Templated prompts with context
- **Workflow states**: running, blocked, pending_merge, completed, failed, cancelled
- **Step types**: agent, script, loop, merge

The current extension still spawns agents directly and manages state internally. This needs to change:
- Extension should be a thin UI client
- Daemon handles all orchestration
- Extension observes and provides intervention points

## What Changes

- **REMOVED**: `session-management` spec - No session concept in daemon API
- **MODIFIED**: `agent-execution` spec - Extension delegates to daemon
- **NEW**: `daemon-connection` spec - Connection lifecycle and auto-start
- **NEW**: `workflow-ui` spec - Workflow-first UI design
- **NEW**: `initialization` spec - Workspace setup flow (git, beads, coven, openspec)
- **NEW**: DaemonClient module (`packages/vscode/src/daemon/`)
- **REMOVED**: CovenSession, FamiliarManager, ClaudeAgent, OrphanRecovery
- **REMOVED**: Direct beads watching from extension
- **REMOVED**: Session API from daemon (vestigial, daemon accepts work immediately on start)

## Architecture After Refactor

```
┌──────────────────────────────────────────────────────────────────┐
│                      VS Code Extension                           │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Sidebar Views  │  │  Workflow Panel │  │  Merge Review   │  │
│  │  - Workflows    │  │  - Step progress│  │  - Diff view    │  │
│  │  - Questions    │  │  - Output stream│  │  - Approve/Rej  │  │
│  │  - Ready Tasks  │  │  - Actions      │  │                 │  │
│  │  - Blocked      │  │                 │  │                 │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │            │
│           └────────────────────┼────────────────────┘            │
│                                │                                 │
│                    ┌───────────▼───────────┐                     │
│                    │     DaemonClient      │                     │
│                    │  ┌─────────────────┐  │                     │
│                    │  │   State Cache   │  │                     │
│                    │  │  (from daemon)  │  │                     │
│                    │  └─────────────────┘  │                     │
│                    │  ┌─────────────────┐  │                     │
│                    │  │  SSE Listener   │  │                     │
│                    │  │  (real-time)    │  │                     │
│                    │  └─────────────────┘  │                     │
│                    └───────────┬───────────┘                     │
│                                │                                 │
└────────────────────────────────┼─────────────────────────────────┘
                                 │ Unix socket
                                 ▼
                    ┌────────────────────────┐
                    │        covend          │
                    │  - Workflow engine     │
                    │  - Grimoire/Spell      │
                    │  - Agent management    │
                    │  - Beads integration   │
                    └────────────────────────┘
```

## Daemon API Surface

### Core Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Daemon health and version |
| `/state` | GET | Full state snapshot |
| `/events` | GET | SSE event stream |
| `/shutdown` | POST | Graceful daemon shutdown |

### Tasks
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/tasks` | GET | List all tasks from beads |
| `/tasks/:id/start` | POST | Start workflow for task |
| `/tasks/:id/stop` | POST | Stop task's workflow |

### Workflows
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/workflows` | GET | List active/blocked workflows |
| `/workflows/:id` | GET | Workflow detail with steps |
| `/workflows/:id/cancel` | POST | Cancel workflow |
| `/workflows/:id/retry` | POST | Retry blocked workflow |
| `/workflows/:id/approve-merge` | POST | Approve pending merge |
| `/workflows/:id/reject-merge` | POST | Reject pending merge |
| `/workflows/:id/log` | GET | Execution log (JSONL) |

### Agents
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/agents` | GET | List running agents |
| `/agents/:id` | GET | Agent details |
| `/agents/:id/output` | GET | Agent output buffer |
| `/agents/:id/kill` | POST | Terminate agent |
| `/agents/:id/respond` | POST | Send stdin response |

### Questions
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/questions` | GET | List pending questions |
| `/questions/:id` | GET | Question details |
| `/questions/:id/answer` | POST | Answer question |

### SSE Events
| Event | Data |
|-------|------|
| `state.snapshot` | Full state (heartbeat) |
| `tasks.updated` | Task list changed |
| `workflow.started` | Workflow began |
| `workflow.step_started` | Step began |
| `workflow.step_completed` | Step finished |
| `workflow.blocked` | Workflow blocked |
| `workflow.pending_merge` | Awaiting merge approval |
| `workflow.completed` | Workflow finished |
| `workflow.cancelled` | Workflow cancelled |
| `agent.started` | Agent spawned |
| `agent.output` | Agent produced output |
| `agent.completed` | Agent finished |
| `agent.failed` | Agent failed |
| `agent.question` | Agent asked question |

## UI Design: Workflow-First

### Sidebar Structure

```
┌──────────────────────────────────────────────────────────────┐
│  COVEN                                              [⟳] [⚙]  │
├──────────────────────────────────────────────────────────────┤
│  🔄 ACTIVE WORKFLOWS (2)                                     │
│  ├── beads-abc "Add user auth"                              │
│  │   └── Step 2/4: test-loop (iter 3) [Cancel]              │
│  └── beads-def "Fix login bug"                              │
│      └── ⏸ Pending Merge [Approve] [Reject]                 │
├──────────────────────────────────────────────────────────────┤
│  ❓ QUESTIONS (1)                                            │
│  └── beads-abc "Use Redis or Memcached?" [Answer]           │
├──────────────────────────────────────────────────────────────┤
│  📋 READY TASKS (3)                                          │
│  ├── beads-ghi "Add dark mode" [Start]                      │
│  ├── beads-jkl "Update deps" [Start]                        │
│  └── beads-mno "Write docs" [Start]                         │
├──────────────────────────────────────────────────────────────┤
│  ⚠️ BLOCKED (1)                                              │
│  └── beads-pqr "Migrate DB" - max iterations [Retry]        │
├──────────────────────────────────────────────────────────────┤
│  ✅ COMPLETED (5)                                            │
│  └── [Show all...]                                           │
└──────────────────────────────────────────────────────────────┘
```

### Workflow Detail Panel

Clicking a workflow opens detail view:

```
┌──────────────────────────────────────────────────────────────┐
│  WORKFLOW: beads-abc - "Add user auth"                       │
│  Grimoire: implement-with-tests | Started: 10m ago           │
├──────────────────────────────────────────────────────────────┤
│  STEPS:                                                      │
│  ✅ 1. implement (agent) - 4m 32s                           │
│  ✅ 2. initial-tests (agent) - 2m 15s                       │
│  🔄 3. test-loop (loop) - iteration 3/10                    │
│     ├── run-tests (script) ✅ 45s                           │
│     └── fix-failures (agent) 🔄 running...                  │
│  ⏳ 4. merge                                                 │
├──────────────────────────────────────────────────────────────┤
│  OUTPUT:                                                     │
│  > Looking at test failures...                               │
│  > Found 2 failing: auth.test.ts, session.test.ts           │
│  > Fixing auth.test.ts...                                    │
├──────────────────────────────────────────────────────────────┤
│  [View Log] [Cancel Workflow]                                │
└──────────────────────────────────────────────────────────────┘
```

### Merge Review Panel

When workflow reaches `pending_merge`:

```
┌──────────────────────────────────────────────────────────────┐
│  MERGE REVIEW: beads-def - "Fix login bug"                   │
│  Branch: coven/beads-def → main                              │
├──────────────────────────────────────────────────────────────┤
│  FILES CHANGED:                                              │
│  📄 src/auth/login.ts                    +45 -12            │
│  📄 src/auth/session.ts                  +23 -8             │
│  📄 tests/auth.test.ts                   +67 -0             │
│  ─────────────────────────────────────────────               │
│  3 files, +135 -20                                           │
├──────────────────────────────────────────────────────────────┤
│  STEP OUTPUTS:                                               │
│  implement: "Fixed session token validation logic"          │
│  add-tests: "Added 5 test cases for edge cases"             │
├──────────────────────────────────────────────────────────────┤
│  [View Diff] [Open Worktree]                                 │
│  [✓ Approve & Merge] [✗ Reject]                             │
└──────────────────────────────────────────────────────────────┘
```

### Status Bar

```
covend: 2 active, 1 pending │ 📡
```

Click → reveal sidebar

## DaemonClient Implementation

```typescript
// packages/vscode/src/daemon/client.ts

class DaemonClient extends EventEmitter {
  private socketPath: string
  private state: DaemonState | null = null
  private sseConnection: AbortController | null = null

  constructor(workspaceRoot: string) {
    this.socketPath = join(workspaceRoot, '.coven/covend.sock')
  }

  // Connection lifecycle
  async connect(): Promise<void>        // Connect → fetch state → subscribe SSE
  async ensureDaemonRunning(): Promise<void>
  disconnect(): void
  subscribe(): void

  // Cached state (sync, instant)
  getState(): DaemonState
  getWorkflows(): Workflow[]
  getQuestions(): Question[]
  getTasks(): Task[]
  getAgents(): Agent[]

  // Commands (async, HTTP to daemon)
  async startTask(taskId: string): Promise<void>
  async stopTask(taskId: string): Promise<void>
  async cancelWorkflow(id: string): Promise<void>
  async retryWorkflow(id: string): Promise<void>
  async approveMerge(id: string): Promise<MergeResult>
  async rejectMerge(id: string, reason?: string): Promise<void>
  async answerQuestion(id: string, answer: string): Promise<void>
  async shutdown(): Promise<void>

  // Events (from SSE)
  on('connected', () => void): this
  on('disconnected', () => void): this
  on('state', (state: DaemonState) => void): this
  on('workflow:started', (data: WorkflowEvent) => void): this
  on('workflow:step_started', (data: StepEvent) => void): this
  on('workflow:step_completed', (data: StepEvent) => void): this
  on('workflow:blocked', (data: WorkflowEvent) => void): this
  on('workflow:pending_merge', (data: WorkflowEvent) => void): this
  on('workflow:completed', (data: WorkflowEvent) => void): this
  on('question', (data: QuestionEvent) => void): this
  on('agent:output', (data: OutputEvent) => void): this
}
```

## Daemon Lifecycle

### Auto-Start Flow

```
Extension activates
       │
       ▼
Check for .coven/ directory
       │
       ├── Not found → Show welcome/init view
       │
       ▼
Try connect to covend.sock
       │
       ├── Success → Subscribe to SSE, render UI
       │
       ▼
Start bundled covend binary
       │
       ▼
Wait for socket (5s timeout)
       │
       ├── Success → Subscribe to SSE, render UI
       │
       ▼
Show error with "View Logs" action
```

### Auto-Stop: None

The daemon continues running after VS Code closes. This allows:
- Workflows to complete without VS Code open
- Quick reconnection on next activation
- Background processing

User can explicitly stop via "Coven: Stop Daemon" command.

## Removed Functionality

The following will be **deleted** from the extension:

1. `CovenSession` - No session concept
2. `FamiliarManager` - Daemon manages agents
3. `ClaudeAgent` - Daemon spawns agents
4. `BeadsTaskSource` direct file access - Daemon provides `/tasks`
5. `WorktreeManager` in extension - Daemon manages worktrees
6. `OrphanRecovery` - Daemon handles recovery
7. `AgentOrchestrator` - Daemon orchestrates
8. Session-related tree providers and commands

## Migration Strategy

### Phase 1: Add DaemonClient
- Implement DaemonClient class
- Add binary bundling and auto-start
- Add connection/reconnection logic
- Keep existing code working in parallel

### Phase 2: New UI Components
- Implement WorkflowTreeProvider
- Implement QuestionsTreeProvider
- Implement WorkflowDetailPanel
- Update MergeReviewPanel for workflow context

### Phase 3: Wire Up
- Connect new UI to DaemonClient
- Replace old commands with daemon API calls
- Update status bar for daemon status

### Phase 4: Remove Deprecated Code
- Delete CovenSession and related classes
- Delete direct agent/beads code
- Clean up unused dependencies
- Update tests

## Testing Strategy

Testing is critical for this refactor. The extension becomes a thin client, so we must verify:
1. Daemon communication works correctly
2. UI updates in response to events
3. Error handling is robust
4. User workflows function end-to-end

### Unit Test Coverage (80% minimum)

#### DaemonClient Tests
| Test Area | Scenarios |
|-----------|-----------|
| Connection | Connect success, connect timeout, connect refused |
| Reconnection | Auto-reconnect on drop, max retries exceeded, backoff timing |
| Session | Auto-start session on connect, session already active, session start failure |
| SSE Parsing | Valid events, malformed events, heartbeat handling |
| State Cache | Initial population, incremental updates, cache invalidation |
| API Calls | Success responses, error responses, timeout handling |
| Event Emission | Correct event types, event data integrity |

#### WorkflowTreeProvider Tests
| Test Area | Scenarios |
|-----------|-----------|
| Sections | Active workflows render, questions with badge, ready tasks, blocked, completed collapsed |
| Grouping | Workflows grouped by status, correct ordering |
| Updates | Real-time updates on state change, optimistic updates |
| Actions | Start task, cancel workflow, approve/reject merge, retry blocked |
| Edge Cases | Empty sections, many items, rapid updates |

#### WorkflowDetailPanel Tests
| Test Area | Scenarios |
|-----------|-----------|
| Metadata | Grimoire name, started time, workflow ID |
| Step List | All steps rendered, status icons correct, nested loops indented |
| Progress | Current step highlighted, iteration counts for loops |
| Output | Initial fetch, streaming append, auto-scroll |
| Actions | Button visibility per status, action API calls |

#### MergeReviewPanel Tests
| Test Area | Scenarios |
|-----------|-----------|
| Diff Display | Files changed list, additions/deletions counts |
| Step Outputs | Summary from each step |
| Approve | Success merge, conflict detection, open worktree on conflict |
| Reject | Reject with reason, reject without reason |

#### QuestionHandler Tests
| Test Area | Scenarios |
|-----------|-----------|
| Notification | Question notification shows, preview text correct |
| Dialog | Answer dialog opens, answer submitted |
| Sidebar | Badge count updates, question removal on answer |
| Edge Cases | Multiple questions, rapid questions |

#### StatusBar Tests
| Test Area | Scenarios |
|-----------|-----------|
| Display | Connected state, disconnected state, not initialized |
| Counts | Active workflow count, pending merge count |
| Click | Reveal sidebar on click |

### E2E Test Coverage

#### Critical Path Tests (Must Pass)

| Test | Steps | Validation |
|------|-------|------------|
| **Daemon auto-start** | 1. Open coven workspace 2. Wait for activation | Daemon process running, socket exists, SSE connected |
| **Start task workflow** | 1. Click [Start] on ready task 2. Wait for workflow | Task moves to active, workflow.started event received |
| **Workflow completion** | 1. Start task 2. Wait for completion | All steps complete, workflow.completed event, task in completed section |
| **Merge approval** | 1. Workflow reaches pending_merge 2. Click Approve | Merge executes, task closed, worktree cleaned |
| **Question handling** | 1. Agent emits question 2. Answer via dialog | Question appears, answer delivered, agent continues |
| **Cancel workflow** | 1. Start workflow 2. Click Cancel | Agent terminated, workflow cancelled |

#### Error Recovery Tests

| Test | Steps | Validation |
|------|-------|------------|
| **Daemon crash recovery** | 1. Start workflow 2. Kill daemon process 3. Wait | Extension shows disconnected, offers restart, workflow state recovered |
| **Connection drop** | 1. Connect 2. Simulate network drop 3. Wait | Reconnection attempts, success after network restored |
| **Session timeout** | 1. Start session 2. Let daemon idle 3. Attempt action | Session auto-restarts if needed |
| **API error handling** | 1. Trigger API error (e.g., start non-existent task) | User-friendly error shown, UI remains stable |

#### Workflow Lifecycle Tests

| Test | Steps | Validation |
|------|-------|------------|
| **Multi-step workflow** | 1. Start workflow with 3+ steps | Each step transitions correctly, outputs captured |
| **Loop step execution** | 1. Start workflow with loop 2. Observe iterations | Iteration count displays, loop completes or hits max |
| **Blocked workflow retry** | 1. Start workflow that will fail 2. Fix issue 3. Retry | Workflow resumes, completes successfully |
| **Reject merge** | 1. Workflow pending merge 2. Reject with reason | Workflow blocked, reason recorded |
| **Merge conflict** | 1. Create conflicting changes 2. Approve merge | Conflict detected, files listed, worktree openable |

#### Concurrent Operations Tests

| Test | Steps | Validation |
|------|-------|------------|
| **Multiple active workflows** | 1. Start 2+ workflows simultaneously | All tracked independently, UI shows all |
| **Multiple pending questions** | 1. Trigger multiple questions | All display in sidebar, answerable in any order |
| **Rapid task starts** | 1. Click Start on 3 tasks quickly | All start without race conditions |

#### UI State Tests

| Test | Steps | Validation |
|------|-------|------------|
| **Sidebar sections** | 1. Create tasks in various states | All sections render correctly |
| **Detail panel updates** | 1. Open detail 2. Workflow progresses | Panel updates in real-time |
| **Output streaming** | 1. Open detail during agent run | Output streams, auto-scrolls |
| **Optimistic updates** | 1. Click action 2. Check UI before confirmation | UI updates immediately, confirms or reverts |

### Test Infrastructure Requirements

#### Unit Test Infrastructure
- **Mock DaemonClient**: Simulates socket responses and SSE events
- **Mock SSE Stream**: Emits configurable event sequences
- **State Fixtures**: Pre-built state snapshots for various scenarios
- **Timer Mocks**: Control reconnection timing in tests

#### E2E Test Infrastructure
- **Test Workspace**: Fixture workspace with .coven/ and beads
- **Mock Agent**: Binary that simulates claude behavior (outputs, questions, completion)
- **Daemon Control**: Start/stop daemon between tests
- **Event Assertions**: Wait for specific SSE events with timeout

### Coverage Exclusions (Allowed)

Only these patterns may be excluded from 80% coverage:
- `*.test.ts` - Test files themselves
- `test/**/*` - Test infrastructure
- `e2e/**/*` - E2E test code
- Type definitions only (`*.d.ts`)

NOT allowed to exclude:
- Any source code in `src/`
- "Covered by E2E" comments
- Error handlers or edge case code
