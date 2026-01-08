import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { BeadsTaskSource } from '../tasks/BeadsTaskSource';
import { FamiliarManager } from '../agents/FamiliarManager';
import { AgentOrchestrator } from '../agents/AgentOrchestrator';
import { OrphanRecovery, OrphanState } from './OrphanRecovery';
import { WorktreeManager } from '../git/WorktreeManager';
import { Worktree } from '../git/types';
import { AgentResult } from '../agents/types';
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
 * Main orchestrator for Coven sessions.
 * Coordinates BeadsTaskSource and FamiliarManager, manages session lifecycle,
 * and provides the unified state interface.
 *
 * Beads is the single source of truth for tasks - this session just orchestrates.
 */
/** Maximum number of activity entries to keep in memory */
const MAX_ACTIVITY_ENTRIES = 50;

export class CovenSession extends EventEmitter {
  private status: SessionStatus = 'inactive';
  private featureBranch: string | null = null;
  private config: SessionConfig;
  private beadsTaskSource: BeadsTaskSource;
  private familiarManager: FamiliarManager;
  private agentOrchestrator: AgentOrchestrator;
  private orphanRecovery: OrphanRecovery;
  private worktreeManager: WorktreeManager;
  private covenDir: string;
  private sessionFilePath: string;
  private configFilePath: string;
  private configWatcher: fs.FSWatcher | null = null;
  private sessionId: string;
  private activityLog: ActivityEntry[] = [];

  constructor(workspaceRoot: string) {
    super();
    this.covenDir = path.join(workspaceRoot, '.coven');
    this.sessionFilePath = path.join(this.covenDir, 'session.json');
    this.configFilePath = path.join(this.covenDir, 'config.json');
    this.config = { ...DEFAULT_SESSION_CONFIG };
    this.sessionId = randomBytes(8).toString('hex');
    this.beadsTaskSource = new BeadsTaskSource(workspaceRoot, {
      syncIntervalMs: this.config.beadsSyncIntervalMs,
      autoWatch: false, // We'll start watching when session starts
    });
    this.familiarManager = new FamiliarManager(workspaceRoot, this.config);
    this.worktreeManager = new WorktreeManager(
      workspaceRoot,
      this.config.worktreeBasePath,
      this.sessionId
    );
    this.agentOrchestrator = new AgentOrchestrator(
      this.familiarManager,
      this.worktreeManager,
      undefined, // Use default ClaudeAgent
      this.config
    );
    this.orphanRecovery = new OrphanRecovery(
      workspaceRoot,
      this.config.worktreeBasePath,
      this.familiarManager,
      this.beadsTaskSource
    );
    this.setupEventForwarding();
    this.setupOrchestratorEventForwarding();
  }

  /**
   * Initialize the session, loading persisted state if available.
   */
  async initialize(): Promise<void> {
    await this.ensureCovenDir();
    await this.loadConfig();
    await this.familiarManager.initialize();
    await this.worktreeManager.initialize();
    await this.loadSession();
    this.watchConfigFile();
    this.setupWorktreeEventForwarding();

    // Check if Beads is available
    const beadsAvailable = await this.beadsTaskSource.isAvailable();
    if (!beadsAvailable) {
      this.emit('session:error', {
        error: new Error('Beads is not available. Please run `bd init` to initialize Beads.'),
      } satisfies SessionEvents['session:error']);
    }

    // If session was restored as active, sync tasks and start watching
    if (this.status === 'active') {
      await this.beadsTaskSource.fetchTasks();
      this.beadsTaskSource.watch();
      await this.recoverOrphans();
    }
  }

  /**
   * Perform orphan recovery for familiars from a previous session.
   * Returns the recovery results for each orphaned familiar.
   */
  async recoverOrphans(): Promise<OrphanState[]> {
    this.setupOrphanRecoveryEvents();
    return this.orphanRecovery.recover();
  }

  /**
   * Set up event forwarding from orphan recovery.
   */
  private setupOrphanRecoveryEvents(): void {
    this.orphanRecovery.on('orphan:reconnecting', (event) => {
      this.emit('orphan:reconnecting', event);
    });
    this.orphanRecovery.on('orphan:reconnected', (event) => {
      this.emit('orphan:reconnected', event);
      this.emitStateChange();
    });
    this.orphanRecovery.on('orphan:needsReview', (event) => {
      this.emit('orphan:needsReview', event);
      this.emitStateChange();
    });
    this.orphanRecovery.on('orphan:uncommittedChanges', (event) => {
      this.emit('orphan:uncommittedChanges', event);
      this.emitStateChange();
    });
    this.orphanRecovery.on('orphan:cleanedUp', (event) => {
      this.emit('orphan:cleanedUp', event);
    });
  }

  private setupWorktreeEventForwarding(): void {
    this.worktreeManager.on('worktree:created', (event: SessionEvents['worktree:created']) => {
      this.emit('worktree:created', event);
      this.emitStateChange();
    });
    this.worktreeManager.on('worktree:deleted', (event: SessionEvents['worktree:deleted']) => {
      this.emit('worktree:deleted', event);
      this.emitStateChange();
    });
    this.worktreeManager.on('worktree:merged', (event: SessionEvents['worktree:merged']) => {
      if (event.result.success) {
        this.addActivity('merge_success', 'Changes merged successfully', {
          taskId: event.taskId,
        });
      }
      this.emit('worktree:merged', event);
      this.emitStateChange();
    });
    this.worktreeManager.on('worktree:conflict', (event: SessionEvents['worktree:conflict']) => {
      this.addActivity('conflict', `Merge conflict detected`, {
        taskId: event.taskId,
        details: { conflictCount: event.conflicts.length },
      });
      this.emit('worktree:conflict', event);
    });
    this.worktreeManager.on('worktree:orphan', (event: SessionEvents['worktree:orphan']) => {
      this.emit('worktree:orphan', event);
    });
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

      // Initial sync from Beads
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
   * Paused sessions don't spawn new agents but keep existing ones running.
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
   * Check if the session is paused.
   */
  isPaused(): boolean {
    return this.status === 'paused';
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
      // Stop watching Beads
      this.beadsTaskSource.stopWatch();

      // Terminate all familiars
      this.familiarManager.clear();

      // Clear session state
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
   * Manually refresh tasks from Beads.
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
   * Get the recent activity log entries.
   */
  getActivityLog(): ActivityEntry[] {
    return [...this.activityLog];
  }

  /**
   * Add an entry to the activity log.
   * @param type - The type of activity
   * @param message - The message describing the activity
   * @param options - Optional task/familiar IDs and details
   */
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

    // Add to front (most recent first)
    this.activityLog.unshift(entry);

    // Trim to max entries
    if (this.activityLog.length > MAX_ACTIVITY_ENTRIES) {
      this.activityLog = this.activityLog.slice(0, MAX_ACTIVITY_ENTRIES);
    }
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
   * Update the configuration.
   */
  async updateConfig(updates: Partial<SessionConfig>): Promise<void> {
    this.config = { ...this.config, ...updates };
    this.familiarManager.updateConfig(this.config);
    await this.persistConfig();
    this.emit('config:changed', { config: this.config } satisfies SessionEvents['config:changed']);
    this.emitStateChange();
  }

  /**
   * Create a worktree for a task.
   * Returns the created worktree with its isolated working directory.
   */
  async createWorktreeForTask(taskId: string): Promise<Worktree> {
    if (!this.featureBranch) {
      throw new Error('Cannot create worktree without an active session');
    }
    return this.worktreeManager.createForTask(taskId, this.featureBranch);
  }

  /**
   * Get the worktree for a task if it exists.
   */
  getWorktreeForTask(taskId: string): Worktree | undefined {
    return this.worktreeManager.getWorktree(taskId);
  }

  /**
   * Merge a task's worktree back to the feature branch and clean up.
   */
  async mergeAndCleanupWorktree(taskId: string): Promise<void> {
    if (!this.featureBranch) {
      throw new Error('Cannot merge worktree without an active session');
    }
    const result = await this.worktreeManager.mergeToFeature(taskId, this.featureBranch);
    if (result.success) {
      await this.worktreeManager.cleanupForTask(taskId);
    }
  }

  /**
   * Get the WorktreeManager instance.
   */
  getWorktreeManager(): WorktreeManager {
    return this.worktreeManager;
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
   * Get the AgentOrchestrator instance.
   */
  getAgentOrchestrator(): AgentOrchestrator {
    return this.agentOrchestrator;
  }

  /**
   * Spawn an agent to work on a task.
   * Creates worktree isolation and starts the agent process.
   */
  async spawnAgentForTask(taskId: string): Promise<void> {
    if (this.status !== 'active') {
      throw new Error('Cannot spawn agent: session not active');
    }

    if (!this.featureBranch) {
      throw new Error('Cannot spawn agent: no feature branch set');
    }

    // Get task details
    const tasks = await this.beadsTaskSource.fetchTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Spawn via orchestrator
    await this.agentOrchestrator.spawnForTask({
      task,
      featureBranch: this.featureBranch,
    });
  }

  /**
   * Terminate an agent working on a task.
   */
  async terminateAgent(taskId: string, reason = 'user requested'): Promise<void> {
    await this.agentOrchestrator.terminateAgent(taskId, reason);
  }

  /**
   * Respond to an agent question.
   */
  async respondToAgentQuestion(taskId: string, response: string): Promise<void> {
    await this.agentOrchestrator.respondToQuestion(taskId, response);
  }

  /**
   * Check if agent provider (Claude) is available.
   */
  async isAgentAvailable(): Promise<boolean> {
    return this.agentOrchestrator.isAvailable();
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
    this.beadsTaskSource.dispose();
    this.familiarManager.dispose();
    this.agentOrchestrator.dispose();
    this.worktreeManager.dispose();
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
        // Emit individual events for UI updates
        for (const task of event.added) {
          this.emit('task:created', { task } satisfies SessionEvents['task:created']);
        }
        for (const task of event.updated) {
          // Log activity for significant status changes
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

    // Forward familiar events
    this.familiarManager.on('familiar:spawned', (event: SessionEvents['familiar:spawned']) => {
      this.addActivity('task_started', `Agent spawned for task`, {
        taskId: event.familiar.taskId,
        familiarId: event.familiar.taskId,
      });
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
      this.addActivity('agent_question', `Agent needs input: ${event.question.question.slice(0, 50)}...`, {
        taskId: event.question.taskId,
        familiarId: event.question.familiarId,
      });
      this.emit('familiar:question', event);
      this.emitStateChange();
    });
  }

  private setupOrchestratorEventForwarding(): void {
    this.agentOrchestrator.on('agent:spawned', (event: { taskId: string; worktreePath: string }) => {
      this.emit('agent:spawned', event);
    });

    this.agentOrchestrator.on('agent:complete', (event: { taskId: string; result: AgentResult }) => {
      this.emit('agent:complete', event);
      this.emitStateChange();
    });

    this.agentOrchestrator.on('agent:error', (event: { taskId: string; error: Error }) => {
      this.emit('agent:error', event);
    });
  }

  private emitStateChange(): void {
    this.emit('state:changed', { state: this.getState() } satisfies SessionEvents['state:changed']);
    this.persistSession().catch((error: unknown) => {
      this.emit('session:error', { error: error as Error } satisfies SessionEvents['session:error']);
    });
  }

  private async ensureCovenDir(): Promise<void> {
    try {
      await fs.promises.mkdir(this.covenDir, { recursive: true });

      // Create default .gitignore if it doesn't exist
      const gitignorePath = path.join(this.covenDir, '.gitignore');
      try {
        await fs.promises.access(gitignorePath);
      } catch {
        const defaultGitignore = `# Ephemeral runtime state
familiars/
logs/
worktrees/

# Keep config trackable if user wants
!config.json
`;
        await fs.promises.writeFile(gitignorePath, defaultGitignore);
      }
    } catch {
      // Directory might already exist
    }
  }

  private async loadConfig(): Promise<void> {
    try {
      const data = await fs.promises.readFile(this.configFilePath, 'utf-8');
      const parsed: unknown = JSON.parse(data);
      // Validate and merge with defaults for any missing/invalid fields
      this.config = validateSessionConfig(parsed);
    } catch {
      // File doesn't exist, use defaults and create it
      this.config = { ...DEFAULT_SESSION_CONFIG };
      await this.persistConfig();
    }
    this.familiarManager.updateConfig(this.config);
  }

  private async persistConfig(): Promise<void> {
    try {
      await fs.promises.writeFile(this.configFilePath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      this.emit('session:error', { error: error as Error } satisfies SessionEvents['session:error']);
    }
  }

  private watchConfigFile(): void {
    try {
      this.configWatcher = fs.watch(this.configFilePath, (eventType) => {
        if (eventType === 'change') {
          void this.loadConfig().then(() => {
            this.emit('config:changed', {
              config: this.config,
            } satisfies SessionEvents['config:changed']);
            this.emitStateChange();
          });
        }
      });
    } catch {
      // File might not exist yet, which is fine
    }
  }

  private async loadSession(): Promise<void> {
    try {
      const data = await fs.promises.readFile(this.sessionFilePath, 'utf-8');
      const session = JSON.parse(data) as { status?: string; featureBranch?: string };
      if (session.status === 'active' && session.featureBranch) {
        this.status = 'active';
        this.featureBranch = session.featureBranch;
      }
    } catch {
      // No session to restore
      this.status = 'inactive';
      this.featureBranch = null;
    }
  }

  private async persistSession(): Promise<void> {
    const session = {
      status: this.status,
      featureBranch: this.featureBranch,
      timestamp: Date.now(),
    };
    try {
      await fs.promises.writeFile(this.sessionFilePath, JSON.stringify(session, null, 2));
    } catch (error) {
      this.emit('session:error', { error: error as Error } satisfies SessionEvents['session:error']);
    }
  }
}
