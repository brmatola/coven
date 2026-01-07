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
    this.removeFamiliarPersistence(taskId);

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
    this.removeAllListeners();
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
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(this.familiarsDir, file);
            const data = await fs.promises.readFile(filePath, 'utf-8');
            const familiar = JSON.parse(data) as Familiar;
            this.familiars.set(familiar.taskId, familiar);
          } catch {
            // Skip invalid files
          }
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
  }

  private getFamiliarFilePath(taskId: string): string {
    return path.join(this.familiarsDir, `${taskId}.json`);
  }

  private persistFamiliar(familiar: Familiar): void {
    const filePath = this.getFamiliarFilePath(familiar.taskId);
    try {
      fs.writeFileSync(filePath, JSON.stringify(familiar, null, 2));
    } catch (error) {
      this.emit('error', error);
    }
  }

  private removeFamiliarPersistence(taskId: string): void {
    const filePath = this.getFamiliarFilePath(taskId);
    try {
      fs.unlinkSync(filePath);
    } catch {
      // File might not exist
    }
  }
}
