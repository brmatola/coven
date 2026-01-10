import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { BeadsTaskSource } from '../tasks/BeadsTaskSource';
import { FamiliarManager } from '../agents/FamiliarManager';
import { DaemonClient } from '../daemon/client';
import { SSEClient, SSEEvent } from '../daemon/sse';
import { getLogger } from '../shared/logger';
import {
  CovenState,
  SessionConfig,
  SessionStatus,
  SessionEvents,
  DEFAULT_SESSION_CONFIG,
  validateSessionConfig,
  Task,
  ActivityEntry,
  ActivityType,
} from '../shared/types';

/**
 * Main orchestrator for Coven sessions - Thin Client.
 *
 * REQUIRES daemon for all operations. Uses DaemonClient for commands
 * and SSEClient for real-time updates.
 *
 * Beads is the single source of truth for tasks - daemon manages the workflow.
 */

/** Maximum number of activity entries to keep in memory */
const MAX_ACTIVITY_ENTRIES = 50;

export class CovenSession extends EventEmitter {
  private status: SessionStatus = 'inactive';
  private featureBranch: string | null = null;
  private config: SessionConfig;
  private readonly daemonClient: DaemonClient;
  private readonly sseClient: SSEClient;
  private readonly beadsTaskSource: BeadsTaskSource;
  private readonly familiarManager: FamiliarManager;
  private readonly workspaceRoot: string;
  private readonly covenDir: string;
  private readonly sessionFilePath: string;
  private readonly configFilePath: string;
  private readonly logger = getLogger();
  private configWatcher: fs.FSWatcher | null = null;
  private sessionId: string;
  private activityLog: ActivityEntry[] = [];
  private sseEventHandler: ((event: SSEEvent) => void) | null = null;

  /**
   * Create a new CovenSession.
   * @param daemonClient Required daemon client for all operations
   * @param sseClient Required SSE client for real-time updates
   * @param workspaceRoot Workspace root path
   */
  constructor(
    daemonClient: DaemonClient,
    sseClient: SSEClient,
    workspaceRoot: string
  ) {
    super();
    this.daemonClient = daemonClient;
    this.sseClient = sseClient;
    this.workspaceRoot = workspaceRoot;
    this.covenDir = path.join(workspaceRoot, '.coven');
    this.sessionFilePath = path.join(this.covenDir, 'session.json');
    this.configFilePath = path.join(this.covenDir, 'config.json');
    this.config = { ...DEFAULT_SESSION_CONFIG };
    this.sessionId = randomBytes(8).toString('hex');

    // Create BeadsTaskSource with daemon (required)
    this.beadsTaskSource = new BeadsTaskSource(
      daemonClient,
      sseClient,
      workspaceRoot,
      {
        syncIntervalMs: this.config.beadsSyncIntervalMs,
        autoWatch: false,
      }
    );

    // FamiliarManager for tracking agent state (populated via SSE events)
    this.familiarManager = new FamiliarManager(workspaceRoot, this.config);

    this.setupEventForwarding();
    this.setupSSEEventHandling();
  }

  /**
   * Initialize the session, loading persisted state if available.
   */
  async initialize(): Promise<void> {
    await this.ensureCovenDir();
    await this.loadConfig();
    await this.familiarManager.initialize();
    await this.loadSession();
    this.watchConfigFile();

    // Check if daemon is available
    const daemonAvailable = await this.beadsTaskSource.isAvailable();
    if (!daemonAvailable) {
      this.emit('session:error', {
        error: new Error('Daemon is not available. Please start the coven daemon.'),
      } satisfies SessionEvents['session:error']);
    }

    // If session was restored as active, sync tasks and start watching
    if (this.status === 'active') {
      await this.beadsTaskSource.fetchTasks();
      this.beadsTaskSource.watch();
    }
  }

  /**
   * Set up SSE event handling for daemon events.
   */
  private setupSSEEventHandling(): void {
    this.sseEventHandler = (event: SSEEvent) => {
      switch (event.type) {
        case 'agent.spawned':
          this.handleAgentSpawned(event.data as { taskId: string; agentId: string });
          break;
        case 'agent.output':
          this.handleAgentOutput(event.data as { taskId: string; output: string });
          break;
        case 'agent.completed':
          this.handleAgentCompleted(event.data as { taskId: string; success: boolean });
          break;
        case 'agent.failed':
          this.handleAgentFailed(event.data as { taskId: string; error: string });
          break;
        case 'question.asked':
          this.handleQuestionAsked(event.data as {
            questionId: string;
            taskId: string;
            question: string;
          });
          break;
        case 'workflow.completed':
          this.handleWorkflowCompleted(event.data as { workflowId: string; taskId: string });
          break;
      }
    };

    this.sseClient.on('event', this.sseEventHandler);
  }

  private handleAgentSpawned(data: { taskId: string; agentId: string }): void {
    this.addActivity('task_started', `Agent spawned for task`, { taskId: data.taskId });
    this.emit('familiar:spawned', {
      familiar: {
        taskId: data.taskId,
        status: 'running',
        pid: 0, // Daemon manages the process
        startTime: Date.now(),
        worktreePath: '',
      },
    });
    this.emitStateChange();
  }

  private handleAgentOutput(data: { taskId: string; output: string }): void {
    this.emit('familiar:output', {
      taskId: data.taskId,
      output: data.output,
    });
  }

  private handleAgentCompleted(data: { taskId: string; success: boolean }): void {
    if (data.success) {
      this.addActivity('task_completed', `Task completed successfully`, { taskId: data.taskId });
    }
    this.emit('familiar:terminated', {
      taskId: data.taskId,
      reason: data.success ? 'completed' : 'failed',
      exitCode: data.success ? 0 : 1,
    });
    this.emitStateChange();
  }

  private handleAgentFailed(data: { taskId: string; error: string }): void {
    this.addActivity('agent_error', `Agent failed: ${data.error}`, { taskId: data.taskId });
    this.emit('familiar:terminated', {
      taskId: data.taskId,
      reason: 'failed',
      exitCode: 1,
    });
    this.emitStateChange();
  }

  private handleQuestionAsked(data: { questionId: string; taskId: string; question: string }): void {
    this.addActivity('agent_question', `Agent needs input: ${data.question.slice(0, 50)}...`, {
      taskId: data.taskId,
    });
    this.emit('familiar:question', {
      question: {
        id: data.questionId,
        taskId: data.taskId,
        familiarId: data.taskId,
        question: data.question,
        timestamp: Date.now(),
      },
    });
    this.emitStateChange();
  }

  private handleWorkflowCompleted(data: { workflowId: string; taskId: string }): void {
    this.addActivity('workflow_completed', `Workflow ready for review`, { taskId: data.taskId });
    this.emit('workflow:completed', { workflowId: data.workflowId, taskId: data.taskId });
    this.emitStateChange();
  }

  /**
   * Start a new session with the given feature branch.
   */
  async start(featureBranch: string): Promise<void> {
    if (this.status === 'active') {
      throw new Error('Session already active');
    }

    this.status = 'starting';
    this.emit('session:starting', { featureBranch } satisfies SessionEvents['session:starting']);

    try {
      this.featureBranch = featureBranch;

      // Start session via daemon
      await this.daemonClient.startSession({ branch: featureBranch });

      // Initial sync from daemon
      await this.beadsTaskSource.fetchTasks();

      // Start watching for changes
      this.beadsTaskSource.watch();

      this.status = 'active';
      await this.persistSession();

      this.addActivity('session_started', `Session started on branch ${featureBranch}`);
      this.emit('session:started', { featureBranch } satisfies SessionEvents['session:started']);
      this.emitStateChange();
    } catch (error) {
      this.status = 'inactive';
      this.featureBranch = null;
      throw error;
    }
  }

  /**
   * Pause the current session.
   */
  async pause(): Promise<void> {
    if (this.status !== 'active') {
      return;
    }

    this.status = 'paused';
    await this.persistSession();

    this.emit('session:paused', undefined satisfies SessionEvents['session:paused']);
    this.emitStateChange();
  }

  /**
   * Resume a paused session.
   */
  async resume(): Promise<void> {
    if (this.status !== 'paused') {
      return;
    }

    this.status = 'active';
    await this.persistSession();

    this.emit('session:resumed', undefined satisfies SessionEvents['session:resumed']);
    this.emitStateChange();
  }

  /**
   * Stop the current session.
   */
  async stop(): Promise<void> {
    if (this.status !== 'active' && this.status !== 'paused') {
      return;
    }

    this.status = 'stopping';
    this.emit('session:stopping', undefined satisfies SessionEvents['session:stopping']);

    try {
      // Stop session via daemon
      await this.daemonClient.stopSession();

      // Stop watching
      this.beadsTaskSource.stopWatch();

      // Clear local state
      this.familiarManager.clear();

      this.status = 'inactive';
      this.featureBranch = null;
      await this.persistSession();

      this.addActivity('session_stopped', 'Session stopped');
      this.emit('session:stopped', undefined satisfies SessionEvents['session:stopped']);
      this.emitStateChange();
    } catch (error) {
      this.status = 'active';
      throw error;
    }
  }

  /**
   * Manually refresh tasks from daemon.
   */
  async refreshTasks(): Promise<void> {
    await this.beadsTaskSource.sync();
    this.emitStateChange();
  }

  /**
   * Get an immutable snapshot of the current session state.
   */
  getState(): CovenState {
    const tasksGrouped = this.beadsTaskSource.getTasksGroupedByStatus();

    return Object.freeze({
      sessionStatus: this.status,
      featureBranch: this.featureBranch,
      config: { ...this.config },
      tasks: {
        ready: [...tasksGrouped.ready],
        working: [...tasksGrouped.working],
        review: [...tasksGrouped.review],
        done: [...tasksGrouped.done],
        blocked: [...tasksGrouped.blocked],
      },
      familiars: [...this.familiarManager.getAllFamiliars()],
      pendingQuestions: [...this.familiarManager.getPendingQuestions()],
      activityLog: [...this.activityLog],
      timestamp: Date.now(),
    });
  }

  /**
   * Get the current session status.
   */
  getStatus(): SessionStatus {
    return this.status;
  }

  /**
   * Get the current feature branch.
   */
  getFeatureBranch(): string | null {
    return this.featureBranch;
  }

  /**
   * Get the current configuration.
   */
  getConfig(): SessionConfig {
    return { ...this.config };
  }

  /**
   * Update configuration.
   */
  async updateConfig(updates: Partial<SessionConfig>): Promise<void> {
    const newConfig = { ...this.config, ...updates };
    // validateSessionConfig normalizes and returns a valid config with defaults
    this.config = validateSessionConfig(newConfig);
    await this.persistConfig();

    this.emit('config:changed', { config: this.config });
    this.emitStateChange();
  }

  /**
   * Get the recent activity log entries.
   */
  getActivityLog(): ActivityEntry[] {
    return [...this.activityLog];
  }

  /**
   * Get the BeadsTaskSource instance.
   */
  getBeadsTaskSource(): BeadsTaskSource {
    return this.beadsTaskSource;
  }

  /**
   * Get the FamiliarManager instance.
   */
  getFamiliarManager(): FamiliarManager {
    return this.familiarManager;
  }

  /**
   * Get the DaemonClient instance.
   */
  getDaemonClient(): DaemonClient {
    return this.daemonClient;
  }

  /**
   * Get the SSEClient instance.
   */
  getSSEClient(): SSEClient {
    return this.sseClient;
  }

  /**
   * Spawn an agent to work on a task via daemon.
   */
  async spawnAgentForTask(taskId: string): Promise<void> {
    if (this.status !== 'active') {
      throw new Error('Cannot spawn agent: session not active');
    }

    this.logger.info('Starting task via daemon', { taskId });
    await this.daemonClient.startTask(taskId);
  }

  /**
   * Terminate an agent working on a task via daemon.
   */
  async terminateAgent(taskId: string, reason = 'user requested'): Promise<void> {
    this.logger.info('Killing task via daemon', { taskId, reason });
    await this.daemonClient.killTask(taskId, reason);
  }

  /**
   * Respond to an agent question via daemon.
   */
  async respondToAgentQuestion(questionId: string, response: string): Promise<void> {
    this.logger.info('Answering question via daemon', { questionId });
    await this.daemonClient.answerQuestion(questionId, response);
  }

  /**
   * Check if daemon is available.
   */
  async isDaemonAvailable(): Promise<boolean> {
    return this.beadsTaskSource.isAvailable();
  }

  /**
   * Check if the session is paused.
   */
  isPaused(): boolean {
    return this.status === 'paused';
  }

  /**
   * Check if the session is active.
   */
  isActive(): boolean {
    return this.status === 'active';
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    if (this.configWatcher) {
      this.configWatcher.close();
      this.configWatcher = null;
    }
    if (this.sseEventHandler) {
      this.sseClient.off('event', this.sseEventHandler);
      this.sseEventHandler = null;
    }
    this.beadsTaskSource.dispose();
    this.familiarManager.dispose();
    this.removeAllListeners();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupEventForwarding(): void {
    // Forward task sync events from BeadsTaskSource
    this.beadsTaskSource.on(
      'sync',
      (event: { added: Task[]; updated: Task[]; removed: string[] }) => {
        for (const task of event.added) {
          this.emit('task:created', { task } satisfies SessionEvents['task:created']);
        }
        for (const task of event.updated) {
          if (task.status === 'working') {
            this.addActivity('task_started', `Started: ${task.title}`, { taskId: task.id });
          } else if (task.status === 'done') {
            this.addActivity('task_completed', `Completed: ${task.title}`, { taskId: task.id });
          } else if (task.status === 'blocked') {
            this.addActivity('task_blocked', `Blocked: ${task.title}`, {
              taskId: task.id,
              details: { dependencies: task.dependencies },
            });
          }
          this.emit('task:updated', { task } satisfies SessionEvents['task:updated']);
        }
        for (const taskId of event.removed) {
          this.emit('task:deleted', { taskId } satisfies SessionEvents['task:deleted']);
        }
        this.emitStateChange();
      }
    );

    this.beadsTaskSource.on('error', (event: { source: string; error: string }) => {
      this.emit('session:error', {
        error: new Error(event.error),
      } satisfies SessionEvents['session:error']);
    });

    // Forward familiar events (for UI state tracking)
    this.familiarManager.on('familiar:spawned', (event: SessionEvents['familiar:spawned']) => {
      this.emit('familiar:spawned', event);
      this.emitStateChange();
    });
    this.familiarManager.on('familiar:statusChanged', (event: SessionEvents['familiar:statusChanged']) => {
      this.emit('familiar:statusChanged', event);
      this.emitStateChange();
    });
    this.familiarManager.on('familiar:output', (event: SessionEvents['familiar:output']) => {
      this.emit('familiar:output', event);
    });
    this.familiarManager.on('familiar:terminated', (event: SessionEvents['familiar:terminated']) => {
      this.emit('familiar:terminated', event);
      this.emitStateChange();
    });
    this.familiarManager.on('familiar:question', (event: SessionEvents['familiar:question']) => {
      this.emit('familiar:question', event);
      this.emitStateChange();
    });
  }

  private addActivity(
    type: ActivityType,
    message: string,
    options?: { taskId?: string; familiarId?: string; details?: Record<string, unknown> }
  ): void {
    const entry: ActivityEntry = {
      id: `${Date.now()}-${randomBytes(4).toString('hex')}`,
      type,
      message,
      timestamp: Date.now(),
      taskId: options?.taskId,
      familiarId: options?.familiarId,
      details: options?.details,
    };

    this.activityLog.unshift(entry);

    if (this.activityLog.length > MAX_ACTIVITY_ENTRIES) {
      this.activityLog = this.activityLog.slice(0, MAX_ACTIVITY_ENTRIES);
    }

    this.emit('activity', { entry });
  }

  private emitStateChange(): void {
    this.emit('state:changed', { state: this.getState() });
  }

  private async ensureCovenDir(): Promise<void> {
    await fs.promises.mkdir(this.covenDir, { recursive: true });
  }

  private async loadConfig(): Promise<void> {
    try {
      const configData = await fs.promises.readFile(this.configFilePath, 'utf-8');
      const loaded = JSON.parse(configData) as Partial<SessionConfig>;
      this.config = { ...DEFAULT_SESSION_CONFIG, ...loaded };
    } catch {
      // Use default config if file doesn't exist
    }
  }

  private async persistConfig(): Promise<void> {
    await fs.promises.writeFile(
      this.configFilePath,
      JSON.stringify(this.config, null, 2)
    );
  }

  private async loadSession(): Promise<void> {
    try {
      const sessionData = await fs.promises.readFile(this.sessionFilePath, 'utf-8');
      const loaded = JSON.parse(sessionData) as {
        status: SessionStatus;
        featureBranch: string | null;
        sessionId: string;
      };
      this.status = loaded.status;
      this.featureBranch = loaded.featureBranch;
      this.sessionId = loaded.sessionId;
    } catch {
      // No session to restore
    }
  }

  private async persistSession(): Promise<void> {
    await fs.promises.writeFile(
      this.sessionFilePath,
      JSON.stringify({
        status: this.status,
        featureBranch: this.featureBranch,
        sessionId: this.sessionId,
      }, null, 2)
    );
  }

  private watchConfigFile(): void {
    try {
      this.configWatcher = fs.watch(this.configFilePath, async () => {
        await this.loadConfig();
        this.emit('config:changed', { config: this.config });
        this.emitStateChange();
      });
    } catch {
      // Config file might not exist yet
    }
  }
}
