# Change: Refactor Extension to Thin Daemon Client

## Why

With the daemon handling orchestration (`add-coven-daemon`), the extension no longer needs to:
- Spawn agent processes directly
- Manage worktrees directly
- Track agent state in memory
- Watch beads for task changes

The extension should become a thin UI client that:
- Connects to daemon via Unix socket
- Subscribes to SSE for real-time updates
- Renders state from cached daemon responses
- Forwards user actions to daemon API

This separation provides:
- Instant UI (no blocking operations)
- Agents survive VS Code restarts
- Cleaner, more testable extension code

## What Changes

- **MODIFIED**: `agent-execution` spec - Extension delegates to daemon instead of spawning directly
- **MODIFIED**: `session-management` spec - Extension delegates to daemon, focuses on UI
- **NEW**: DaemonClient module in extension (`packages/vscode/src/daemon/`)
- **NEW**: Binary bundling in extension package
- **REMOVED**: Direct agent spawning from extension
- **REMOVED**: Direct beads watching from extension
- **REMOVED**: In-extension state management for agents

## Impact

- Affected specs: `agent-execution`, `session-management`
- Affected code: `packages/vscode/src/` (most of agents/, session/)
- Dependency: Requires `add-coven-daemon` to be implemented first

## Architecture After Refactor

```
┌──────────────────────────────────────────────────────────────────┐
│                      VS Code Extension                           │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────┐    ┌────────────────┐    ┌───────────────┐  │
│  │  Sidebar UI    │    │  Webviews      │    │  Commands     │  │
│  │  (TreeViews)   │    │  (Task Detail) │    │  (palette)    │  │
│  └───────┬────────┘    └───────┬────────┘    └───────┬───────┘  │
│          │                     │                     │          │
│          └─────────────────────┼─────────────────────┘          │
│                                │                                │
│                    ┌───────────▼───────────┐                    │
│                    │    DaemonClient       │                    │
│                    │  ┌─────────────────┐  │                    │
│                    │  │  State Cache    │  │                    │
│                    │  │  (from daemon)  │  │                    │
│                    │  └─────────────────┘  │                    │
│                    │  ┌─────────────────┐  │                    │
│                    │  │  SSE Listener   │  │                    │
│                    │  │  (real-time)    │  │                    │
│                    │  └─────────────────┘  │                    │
│                    └───────────┬───────────┘                    │
│                                │                                │
└────────────────────────────────┼────────────────────────────────┘
                                 │ Unix socket
                                 ▼
                    ┌────────────────────────┐
                    │        covend          │
                    │  (handles everything)  │
                    └────────────────────────┘
```

## Consumer UX Details

### Extension Activation Flow

```typescript
// packages/vscode/src/extension.ts

async function activate(context: ExtensionContext) {
  const workspaceRoot = getWorkspaceRoot()

  // Check if coven-enabled workspace
  if (!existsSync(join(workspaceRoot, '.coven'))) {
    // Show welcome view with "Initialize Coven" button
    registerWelcomeView(context)
    return
  }

  // Create daemon client
  const client = new DaemonClient(workspaceRoot)

  // Connect to daemon (handles auto-start and version check)
  await client.connect()

  // Subscribe to events
  client.subscribe()

  // Register UI providers (they read from client.state)
  registerSidebarViews(context, client)
  registerCommands(context, client)

  // Initial UI render from cached state
  refreshAllViews()
}
```

### DaemonClient Implementation

```typescript
// packages/vscode/src/daemon/client.ts

class DaemonClient extends EventEmitter {
  private socketPath: string
  private state: RepoState | null = null
  private sseConnection: EventSource | null = null
  private bundledVersion: string

  constructor(workspaceRoot: string) {
    this.socketPath = join(workspaceRoot, '.coven/covend.sock')
    this.bundledVersion = getBundledDaemonVersion()
  }

  async connect(): Promise<void> {
    // Check if daemon running
    const health = await this.healthCheck()

    if (!health) {
      // Daemon not running, start it
      await this.startDaemon()
    } else if (health.version !== this.bundledVersion) {
      // Version mismatch, restart with new version
      await this.post('/shutdown')
      await this.waitForExit()
      await this.startDaemon()
    }

    // Fetch initial state
    this.state = await this.get('/state')
    this.emit('stateChanged', this.state)
  }

  subscribe(): void {
    // Connect to SSE stream
    this.sseConnection = new EventSource(`unix:${this.socketPath}/events`)

    this.sseConnection.onmessage = (event) => {
      this.handleEvent(JSON.parse(event.data))
    }
  }

  private handleEvent(event: DaemonEvent): void {
    switch (event.type) {
      case 'tasks.changed':
        this.state.tasks = event.tasks
        this.emit('tasksChanged')
        break

      case 'agent.spawned':
        this.state.agents.push(event.agent)
        this.emit('agentsChanged')
        break

      case 'agent.output':
        this.emit('agentOutput', event)
        break

      case 'agent.question':
        this.emit('question', event)
        break

      case 'state.snapshot':
        this.state = event.state
        this.emit('stateChanged', this.state)
        break
    }
  }

  // Cached state access (sync, instant)
  getState(): RepoState {
    return this.state
  }

  getTasks(): Task[] {
    return this.state?.tasks ?? []
  }

  getAgents(): Agent[] {
    return this.state?.agents ?? []
  }

  // Commands (async, talk to daemon)
  async startSession(config: SessionConfig): Promise<void> {
    await this.post('/session/start', config)
  }

  async stopSession(force = false): Promise<void> {
    await this.post(`/session/stop${force ? '?force=1' : ''}`)
  }

  async respondToQuestion(agentId: string, response: string): Promise<void> {
    await this.post(`/agents/${agentId}/respond`, { response })
  }

  private async startDaemon(): Promise<void> {
    const daemonPath = await ensureDaemonBinary()

    spawn(daemonPath, ['--workspace', this.workspaceRoot], {
      detached: true,
      stdio: 'ignore'
    }).unref()

    await waitForSocket(this.socketPath, 5000)
  }
}
```

### Sidebar TreeView Integration

```typescript
// packages/vscode/src/sidebar/GrimoireTreeProvider.ts

class GrimoireTreeProvider implements TreeDataProvider<TaskItem> {
  private client: DaemonClient

  constructor(client: DaemonClient) {
    this.client = client

    // Refresh on any relevant event
    client.on('tasksChanged', () => this.refresh())
    client.on('agentsChanged', () => this.refresh())
    client.on('stateChanged', () => this.refresh())
  }

  getChildren(): TaskItem[] {
    // Read from cached state (sync, instant)
    const tasks = this.client.getTasks()
    const agents = this.client.getAgents()

    // Group and sort tasks
    return this.buildTaskTree(tasks, agents)
  }

  // No async operations in getChildren - always instant
}
```

### Command Handlers

```typescript
// packages/vscode/src/commands.ts

function registerCommands(context: ExtensionContext, client: DaemonClient) {

  context.subscriptions.push(
    commands.registerCommand('coven.startSession', async () => {
      const branch = await window.showInputBox({
        prompt: 'Feature branch name'
      })
      if (branch) {
        await client.startSession({ featureBranch: branch })
        // UI updates automatically via SSE events
      }
    }),

    commands.registerCommand('coven.stopSession', async () => {
      await client.stopSession()
      // UI updates automatically via SSE events
    }),

    commands.registerCommand('coven.startTask', async (taskId: string) => {
      await client.post(`/tasks/${taskId}/start`)
      // Daemon spawns agent, UI updates via SSE
    }),

    commands.registerCommand('coven.respondToQuestion', async (agentId: string) => {
      const question = client.getState().pendingQuestions
        .find(q => q.agentId === agentId)

      if (question) {
        const response = await showQuestionDialog(question)
        if (response) {
          await client.respondToQuestion(agentId, response)
        }
      }
    })
  )
}
```

### Agent Output Streaming

```typescript
// packages/vscode/src/agents/FamiliarOutputChannel.ts

class FamiliarOutputChannel {
  private outputChannel: OutputChannel
  private client: DaemonClient
  private lastSeq: number = 0

  constructor(agentId: string, client: DaemonClient) {
    this.outputChannel = window.createOutputChannel(`Agent: ${agentId}`)
    this.client = client

    // Listen for output events
    client.on('agentOutput', (event) => {
      if (event.agentId === agentId && event.seq > this.lastSeq) {
        this.outputChannel.append(event.chunk)
        this.lastSeq = event.seq
      }
    })
  }

  async fetchHistory(): Promise<void> {
    const output = await this.client.get(`/agents/${this.agentId}/output`)
    this.outputChannel.append(output.buffer)
    this.lastSeq = output.seq
  }
}
```

### Daemon Binary Management

```typescript
// packages/vscode/src/daemon/binary.ts

async function ensureDaemonBinary(): Promise<string> {
  const targetPath = join(homedir(), '.coven', 'bin', 'covend')

  // Check if we need to extract/update
  const currentVersion = await getInstalledVersion(targetPath)
  const bundledVersion = getBundledDaemonVersion()

  if (currentVersion !== bundledVersion) {
    await extractBundledBinary(targetPath)
  }

  return targetPath
}

function getBundledBinaryPath(): string {
  const platform = process.platform  // 'darwin' | 'linux'
  const arch = process.arch          // 'arm64' | 'x64'

  const binaryName = `covend-${platform}-${arch === 'x64' ? 'amd64' : arch}`

  return join(extensionPath, 'bin', binaryName)
}

async function extractBundledBinary(targetPath: string): Promise<void> {
  const bundledPath = getBundledBinaryPath()
  const targetDir = dirname(targetPath)

  await mkdir(targetDir, { recursive: true })
  await copyFile(bundledPath, targetPath)
  await chmod(targetPath, 0o755)
}
```

## Removed Functionality

The following will be **removed** from the extension:

1. **ClaudeAgent.ts** - Agent spawning moves to daemon
2. **BeadsTaskSource direct file access** - Daemon uses `bd ready --json`
3. **WorktreeManager in extension** - Daemon handles worktrees
4. **In-memory task/agent state** - State comes from daemon cache
5. **Agent process tracking** - Daemon tracks processes
6. **OrphanRecovery logic** - Daemon handles recovery

## Migration Strategy

### Phase 1: Add Daemon Client
- Implement DaemonClient class
- Add binary management (bundling, extraction)
- Add connection/reconnection logic

### Phase 2: Parallel Implementation
- Extension uses daemon for new operations
- Existing code still present but unused
- Allows incremental testing

### Phase 3: Remove Deprecated Code
- Delete ClaudeAgent, direct BeadsTaskSource, etc.
- Extension is pure daemon client
- Simpler, more maintainable codebase
