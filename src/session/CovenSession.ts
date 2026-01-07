import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { TaskManager } from '../tasks/TaskManager';
import { FamiliarManager } from '../agents/FamiliarManager';
import {
  CovenState,
  SessionConfig,
  SessionStatus,
  SessionEvents,
  DEFAULT_SESSION_CONFIG,
} from '../shared/types';

/**
 * Main orchestrator for Coven sessions.
 * Coordinates TaskManager and FamiliarManager, manages session lifecycle,
 * and provides the unified state interface.
 */
export class CovenSession extends EventEmitter {
  private status: SessionStatus = 'inactive';
  private featureBranch: string | null = null;
  private config: SessionConfig;
  private taskManager: TaskManager;
  private familiarManager: FamiliarManager;
  private covenDir: string;
  private sessionFilePath: string;
  private configFilePath: string;
  private configWatcher: fs.FSWatcher | null = null;

  constructor(workspaceRoot: string) {
    super();
    this.covenDir = path.join(workspaceRoot, '.coven');
    this.sessionFilePath = path.join(this.covenDir, 'session.json');
    this.configFilePath = path.join(this.covenDir, 'config.json');
    this.config = { ...DEFAULT_SESSION_CONFIG };
    this.taskManager = new TaskManager(workspaceRoot);
    this.familiarManager = new FamiliarManager(workspaceRoot, this.config);
    this.setupEventForwarding();
  }

  /**
   * Initialize the session, loading persisted state if available.
   */
  async initialize(): Promise<void> {
    await this.ensureCovenDir();
    await this.loadConfig();
    await this.taskManager.initialize();
    await this.familiarManager.initialize();
    await this.loadSession();
    this.watchConfigFile();
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
      this.status = 'active';
      await this.persistSession();

      this.emit('session:started', { featureBranch } satisfies SessionEvents['session:started']);
      this.emitStateChange();
    } catch (error) {
      this.status = 'inactive';
      this.featureBranch = null;
      throw error;
    }
  }

  /**
   * Stop the current session.
   */
  async stop(): Promise<void> {
    if (this.status !== 'active') {
      return;
    }

    this.status = 'stopping';
    this.emit('session:stopping', undefined satisfies SessionEvents['session:stopping']);

    try {
      // Terminate all familiars
      this.familiarManager.clear();

      // Clear session state
      this.status = 'inactive';
      this.featureBranch = null;
      await this.persistSession();

      this.emit('session:stopped', undefined satisfies SessionEvents['session:stopped']);
      this.emitStateChange();
    } catch (error) {
      this.status = 'active';
      throw error;
    }
  }

  /**
   * Get an immutable snapshot of the current session state.
   */
  getState(): CovenState {
    const tasksGrouped = this.taskManager.getTasksGroupedByStatus();

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
   * Get the TaskManager instance.
   */
  getTaskManager(): TaskManager {
    return this.taskManager;
  }

  /**
   * Get the FamiliarManager instance.
   */
  getFamiliarManager(): FamiliarManager {
    return this.familiarManager;
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
    this.taskManager.dispose();
    this.familiarManager.dispose();
    this.removeAllListeners();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupEventForwarding(): void {
    // Forward task events
    this.taskManager.on('task:created', (event) => {
      this.emit('task:created', event);
      this.emitStateChange();
    });
    this.taskManager.on('task:updated', (event) => {
      this.emit('task:updated', event);
      this.emitStateChange();
    });
    this.taskManager.on('task:deleted', (event) => {
      this.emit('task:deleted', event);
      this.emitStateChange();
    });
    this.taskManager.on('task:unblocked', (event) => {
      this.emit('task:unblocked', event);
      this.emitStateChange();
    });

    // Forward familiar events
    this.familiarManager.on('familiar:spawned', (event) => {
      this.emit('familiar:spawned', event);
      this.emitStateChange();
    });
    this.familiarManager.on('familiar:statusChanged', (event) => {
      this.emit('familiar:statusChanged', event);
      this.emitStateChange();
    });
    this.familiarManager.on('familiar:output', (event) => {
      this.emit('familiar:output', event);
    });
    this.familiarManager.on('familiar:terminated', (event) => {
      this.emit('familiar:terminated', event);
      this.emitStateChange();
    });
    this.familiarManager.on('familiar:question', (event) => {
      this.emit('familiar:question', event);
      this.emitStateChange();
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
      const loaded = JSON.parse(data) as Partial<SessionConfig>;
      // Merge with defaults to handle missing fields
      this.config = { ...DEFAULT_SESSION_CONFIG, ...loaded };
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
