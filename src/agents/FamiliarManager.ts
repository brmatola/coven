import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import {
  Familiar,
  FamiliarStatus,
  ProcessInfo,
  PendingQuestion,
  SessionConfig,
  SessionEvents,
  validateFamiliar,
} from '../shared/types';

/**
 * Manages the lifecycle of familiars (AI agents) working on tasks.
 * Handles spawning, termination, state tracking, and question queuing.
 */
export class FamiliarManager extends EventEmitter {
  private familiars: Map<string, Familiar> = new Map();
  private pendingQuestions: Map<string, PendingQuestion> = new Map();
  private covenDir: string;
  private familiarsDir: string;
  private config: SessionConfig;
  private pendingPersists: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private timeoutCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(workspaceRoot: string, config: SessionConfig) {
    super();
    this.covenDir = path.join(workspaceRoot, '.coven');
    this.familiarsDir = path.join(this.covenDir, 'familiars');
    this.config = config;
  }

  /**
   * Initialize the FamiliarManager, creating directories and loading persisted state.
   */
  async initialize(): Promise<void> {
    await this.ensureDirs();
    await this.loadPersistedFamiliars();
    this.startTimeoutCheck();
  }

  /**
   * Start periodic timeout checks.
   */
  private startTimeoutCheck(): void {
    // Check every 30 seconds for timed out familiars
    this.timeoutCheckInterval = setInterval(() => {
      this.checkTimeouts();
    }, 30000);
  }

  /**
   * Check all active familiars for timeout.
   */
  private checkTimeouts(): void {
    const now = Date.now();
    const timeoutMs = this.config.agentTimeoutMs;

    for (const familiar of this.familiars.values()) {
      // Only check active (working/waiting) familiars
      if (familiar.status !== 'working' && familiar.status !== 'waiting') {
        continue;
      }

      const elapsed = now - familiar.spawnedAt;
      if (elapsed > timeoutMs) {
        this.emit('familiar:timeout', {
          familiarId: familiar.taskId,
          elapsed,
          timeout: timeoutMs,
        });
        this.updateStatus(familiar.taskId, 'failed');
        this.terminateFamiliar(familiar.taskId, 'timeout');
      }
    }
  }

  /**
   * Get the remaining time before a familiar times out.
   * Returns null if familiar not found or not active.
   */
  getRemainingTime(taskId: string): number | null {
    const familiar = this.familiars.get(taskId);
    if (!familiar || (familiar.status !== 'working' && familiar.status !== 'waiting')) {
      return null;
    }
    const elapsed = Date.now() - familiar.spawnedAt;
    return Math.max(0, this.config.agentTimeoutMs - elapsed);
  }

  /**
   * Update the configuration.
   */
  updateConfig(config: SessionConfig): void {
    this.config = config;
  }

  /**
   * Check if we can spawn a new familiar (respects maxConcurrentAgents).
   */
  canSpawn(): boolean {
    const activeFamiliars = this.getActiveFamiliars();
    return activeFamiliars.length < this.config.maxConcurrentAgents;
  }

  /**
   * Get the number of available spawn slots.
   */
  getAvailableSlots(): number {
    const activeFamiliars = this.getActiveFamiliars();
    return Math.max(0, this.config.maxConcurrentAgents - activeFamiliars.length);
  }

  /**
   * Spawn a new familiar for a task.
   * Note: This creates the tracking record. Actual process spawning is handled elsewhere.
   */
  spawnFamiliar(taskId: string, processInfo: ProcessInfo): Familiar {
    if (!this.canSpawn()) {
      throw new Error('Maximum concurrent agents reached');
    }

    if (this.familiars.has(taskId)) {
      throw new Error(`Familiar already exists for task: ${taskId}`);
    }

    const familiar: Familiar = {
      taskId,
      status: 'working',
      processInfo,
      spawnedAt: Date.now(),
      outputBuffer: [],
    };

    this.familiars.set(taskId, familiar);
    this.persistFamiliar(familiar);
    this.emit('familiar:spawned', { familiar } satisfies SessionEvents['familiar:spawned']);

    return familiar;
  }

  /**
   * Get a familiar by task ID.
   */
  getFamiliar(taskId: string): Familiar | undefined {
    return this.familiars.get(taskId);
  }

  /**
   * Get all familiars.
   */
  getAllFamiliars(): Familiar[] {
    return Array.from(this.familiars.values());
  }

  /**
   * Get active familiars (working or waiting).
   */
  getActiveFamiliars(): Familiar[] {
    return Array.from(this.familiars.values()).filter(
      (f) => f.status === 'working' || f.status === 'waiting'
    );
  }

  /**
   * Get familiars by status.
   */
  getFamiliarsByStatus(status: FamiliarStatus): Familiar[] {
    return Array.from(this.familiars.values()).filter((f) => f.status === status);
  }

  /**
   * Update a familiar's status.
   */
  updateStatus(taskId: string, status: FamiliarStatus): Familiar {
    const familiar = this.familiars.get(taskId);
    if (!familiar) {
      throw new Error(`Familiar not found for task: ${taskId}`);
    }

    const previousStatus = familiar.status;
    const updated: Familiar = {
      ...familiar,
      status,
    };

    this.familiars.set(taskId, updated);
    this.persistFamiliar(updated);
    this.emit('familiar:statusChanged', {
      familiar: updated,
      previousStatus,
    } satisfies SessionEvents['familiar:statusChanged']);

    return updated;
  }

  /**
   * Add output to a familiar's buffer.
   */
  addOutput(taskId: string, line: string): void {
    const familiar = this.familiars.get(taskId);
    if (!familiar) {
      return;
    }

    // Keep only last 100 lines in buffer
    const maxBufferSize = 100;
    const newBuffer = [...familiar.outputBuffer, line].slice(-maxBufferSize);

    const updated: Familiar = {
      ...familiar,
      outputBuffer: newBuffer,
    };

    this.familiars.set(taskId, updated);
    this.emit('familiar:output', {
      familiarId: taskId,
      line,
    } satisfies SessionEvents['familiar:output']);
  }

  /**
   * Terminate a familiar.
   */
  terminateFamiliar(taskId: string, reason: string): void {
    const familiar = this.familiars.get(taskId);
    if (!familiar) {
      return;
    }

    this.familiars.delete(taskId);

    // Fire and forget the async cleanup
    void this.removeFamiliarPersistence(taskId);

    // Also remove any pending questions from this familiar
    this.pendingQuestions.delete(taskId);

    this.emit('familiar:terminated', {
      familiarId: taskId,
      reason,
    } satisfies SessionEvents['familiar:terminated']);
  }

  /**
   * Add a pending question from a familiar.
   */
  addQuestion(question: Omit<PendingQuestion, 'askedAt'>): PendingQuestion {
    const fullQuestion: PendingQuestion = {
      ...question,
      askedAt: Date.now(),
    };

    this.pendingQuestions.set(question.familiarId, fullQuestion);

    // Update familiar status to waiting
    const familiar = this.familiars.get(question.taskId);
    if (familiar && familiar.status === 'working') {
      this.updateStatus(question.taskId, 'waiting');
    }

    this.emit('familiar:question', {
      question: fullQuestion,
    } satisfies SessionEvents['familiar:question']);

    return fullQuestion;
  }

  /**
   * Answer a pending question.
   */
  answerQuestion(familiarId: string): void {
    const question = this.pendingQuestions.get(familiarId);
    if (!question) {
      return;
    }

    this.pendingQuestions.delete(familiarId);

    // Update familiar status back to working
    const familiar = this.familiars.get(question.taskId);
    if (familiar && familiar.status === 'waiting') {
      this.updateStatus(question.taskId, 'working');
    }
  }

  /**
   * Get all pending questions.
   */
  getPendingQuestions(): PendingQuestion[] {
    return Array.from(this.pendingQuestions.values());
  }

  /**
   * Get a pending question for a specific familiar.
   */
  getQuestion(familiarId: string): PendingQuestion | undefined {
    return this.pendingQuestions.get(familiarId);
  }

  /**
   * Clear all familiars (used during session stop).
   */
  clear(): void {
    for (const taskId of this.familiars.keys()) {
      this.terminateFamiliar(taskId, 'session stopped');
    }
    this.pendingQuestions.clear();
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    // Clear timeout check interval
    if (this.timeoutCheckInterval) {
      clearInterval(this.timeoutCheckInterval);
      this.timeoutCheckInterval = null;
    }

    // Clear all pending persist timeouts
    for (const timeout of this.pendingPersists.values()) {
      clearTimeout(timeout);
    }
    this.pendingPersists.clear();
    this.removeAllListeners();
  }

  /**
   * Flush all pending persist operations.
   */
  async flush(): Promise<void> {
    const taskIds = Array.from(this.pendingPersists.keys());
    for (const taskId of taskIds) {
      const timeout = this.pendingPersists.get(taskId);
      if (timeout) {
        clearTimeout(timeout);
        this.pendingPersists.delete(taskId);
        const familiar = this.familiars.get(taskId);
        if (familiar) {
          await this.doPersistFamiliar(familiar);
        }
      }
    }
  }

  // ============================================================================
  // Recovery Methods (used by orphan recovery)
  // ============================================================================

  /**
   * Register a recovered familiar (from orphan recovery).
   */
  registerRecoveredFamiliar(familiar: Familiar): void {
    this.familiars.set(familiar.taskId, familiar);
    this.emit('familiar:spawned', { familiar } satisfies SessionEvents['familiar:spawned']);
  }

  /**
   * Get persisted familiar info for a task (for orphan recovery).
   */
  async getPersistedFamiliarInfo(taskId: string): Promise<Familiar | null> {
    const filePath = this.getFamiliarFilePath(taskId);
    try {
      const data = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(data) as Familiar;
    } catch {
      return null;
    }
  }

  /**
   * Get all persisted familiar IDs (for orphan recovery).
   */
  async getPersistedFamiliarIds(): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(this.familiarsDir);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async ensureDirs(): Promise<void> {
    try {
      await fs.promises.mkdir(this.familiarsDir, { recursive: true });
    } catch {
      // Directory might already exist
    }
  }

  private async loadPersistedFamiliars(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.familiarsDir);
      let skipped = 0;

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(this.familiarsDir, file);
            const data = await fs.promises.readFile(filePath, 'utf-8');
            const parsed: unknown = JSON.parse(data);
            const familiar = validateFamiliar(parsed);

            if (familiar) {
              this.familiars.set(familiar.taskId, familiar);
            } else {
              skipped++;
            }
          } catch {
            skipped++;
          }
        }
      }

      if (skipped > 0) {
        this.emit('error', new Error(`Skipped ${skipped} invalid familiars during load`));
      }
    } catch {
      // Directory doesn't exist yet
    }
  }

  private getFamiliarFilePath(taskId: string): string {
    return path.join(this.familiarsDir, `${taskId}.json`);
  }

  /**
   * Schedule an async persist with debouncing.
   */
  private persistFamiliar(familiar: Familiar): void {
    // Clear any pending persist for this familiar
    const existingTimeout = this.pendingPersists.get(familiar.taskId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Debounce writes by 10ms
    const timeout = setTimeout(() => {
      this.pendingPersists.delete(familiar.taskId);
      this.doPersistFamiliar(familiar).catch((error) => {
        this.emit('error', error);
      });
    }, 10);

    this.pendingPersists.set(familiar.taskId, timeout);
  }

  /**
   * Actually write familiar to disk.
   */
  private async doPersistFamiliar(familiar: Familiar): Promise<void> {
    const filePath = this.getFamiliarFilePath(familiar.taskId);
    try {
      await fs.promises.writeFile(filePath, JSON.stringify(familiar, null, 2));
    } catch (error) {
      this.emit('error', error);
    }
  }

  private async removeFamiliarPersistence(taskId: string): Promise<void> {
    // Cancel any pending persist
    const existingTimeout = this.pendingPersists.get(taskId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      this.pendingPersists.delete(taskId);
    }

    const filePath = this.getFamiliarFilePath(taskId);
    try {
      await fs.promises.unlink(filePath);
    } catch {
      // File might not exist
    }
  }
}
