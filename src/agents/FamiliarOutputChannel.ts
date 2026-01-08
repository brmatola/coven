import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FamiliarManager } from './FamiliarManager';
import { SessionEvents } from '../shared/types';

/**
 * Manages VSCode output channels for familiars (AI agents).
 * Creates one output channel per active familiar, streams output in real-time,
 * and persists output to disk for recovery.
 */
export class FamiliarOutputChannel {
  private channels: Map<string, vscode.OutputChannel> = new Map();
  private outputDir: string;
  private fileHandles: Map<string, fs.promises.FileHandle> = new Map();
  private subscriptions: Array<() => void> = [];
  private taskTitles: Map<string, string> = new Map();

  constructor(
    private familiarManager: FamiliarManager,
    workspaceRoot: string
  ) {
    this.outputDir = path.join(workspaceRoot, '.coven', 'output');
  }

  /**
   * Initialize the output channel manager.
   * Subscribes to FamiliarManager events.
   */
  async initialize(): Promise<void> {
    await this.ensureOutputDir();
    this.subscribeToEvents();
  }

  /**
   * Set the title for a task (used in output channel naming).
   */
  setTaskTitle(taskId: string, title: string): void {
    this.taskTitles.set(taskId, title);
  }

  /**
   * Get or create an output channel for a familiar.
   */
  getOrCreateChannel(taskId: string): vscode.OutputChannel {
    let channel = this.channels.get(taskId);
    if (!channel) {
      const title = this.taskTitles.get(taskId) || taskId;
      channel = vscode.window.createOutputChannel(`Coven: ${title}`);
      this.channels.set(taskId, channel);
    }
    return channel;
  }

  /**
   * Show the output channel for a familiar.
   */
  showChannel(taskId: string, preserveFocus = true): void {
    const channel = this.channels.get(taskId);
    if (channel) {
      channel.show(preserveFocus);
    }
  }

  /**
   * Append a line to the output channel with timestamp.
   */
  appendLine(taskId: string, line: string): void {
    const channel = this.getOrCreateChannel(taskId);
    const timestamp = this.formatTimestamp(new Date());
    channel.appendLine(`[${timestamp}] ${line}`);

    // Also persist to file (fire and forget)
    void this.persistLine(taskId, timestamp, line);
  }

  /**
   * Load persisted output into a channel (for recovery).
   */
  async loadPersistedOutput(taskId: string): Promise<void> {
    const filePath = this.getOutputFilePath(taskId);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const channel = this.getOrCreateChannel(taskId);
      channel.append(content);
    } catch {
      // File doesn't exist or can't be read - that's okay
    }
  }

  /**
   * Clear the output channel for a familiar.
   */
  clearChannel(taskId: string): void {
    const channel = this.channels.get(taskId);
    if (channel) {
      channel.clear();
    }
  }

  /**
   * Dispose of a specific channel (keeps the output for review).
   */
  disposeChannel(taskId: string): void {
    const channel = this.channels.get(taskId);
    if (channel) {
      channel.dispose();
      this.channels.delete(taskId);
    }

    // Close file handle if open
    const handle = this.fileHandles.get(taskId);
    if (handle) {
      void handle.close();
      this.fileHandles.delete(taskId);
    }

    this.taskTitles.delete(taskId);
  }

  /**
   * Get all active channel task IDs.
   */
  getActiveChannelIds(): string[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Check if a channel exists for a task.
   */
  hasChannel(taskId: string): boolean {
    return this.channels.has(taskId);
  }

  /**
   * Clean up old output files based on retention policy.
   */
  async cleanupOldOutputFiles(retentionDays: number): Promise<number> {
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    try {
      const files = await fs.promises.readdir(this.outputDir);
      for (const file of files) {
        if (!file.endsWith('.log')) continue;

        const filePath = path.join(this.outputDir, file);
        try {
          const stats = await fs.promises.stat(filePath);
          if (stats.mtimeMs < cutoffTime) {
            await fs.promises.unlink(filePath);
            deletedCount++;
          }
        } catch {
          // Skip files we can't stat or delete
        }
      }
    } catch {
      // Directory might not exist
    }

    return deletedCount;
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    // Unsubscribe from events
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
    this.subscriptions = [];

    // Dispose all channels
    for (const channel of this.channels.values()) {
      channel.dispose();
    }
    this.channels.clear();

    // Close all file handles
    for (const handle of this.fileHandles.values()) {
      void handle.close();
    }
    this.fileHandles.clear();

    this.taskTitles.clear();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async ensureOutputDir(): Promise<void> {
    try {
      await fs.promises.mkdir(this.outputDir, { recursive: true });
    } catch {
      // Directory might already exist
    }
  }

  private subscribeToEvents(): void {
    // Subscribe to familiar:spawned - create channel
    const onSpawned = (event: SessionEvents['familiar:spawned']): void => {
      this.getOrCreateChannel(event.familiar.taskId);
      this.appendLine(event.familiar.taskId, '--- Agent started ---');
    };
    this.familiarManager.on('familiar:spawned', onSpawned);
    this.subscriptions.push(() => this.familiarManager.off('familiar:spawned', onSpawned));

    // Subscribe to familiar:output - append line
    const onOutput = (event: SessionEvents['familiar:output']): void => {
      this.appendLine(event.familiarId, event.line);
    };
    this.familiarManager.on('familiar:output', onOutput);
    this.subscriptions.push(() => this.familiarManager.off('familiar:output', onOutput));

    // Subscribe to familiar:terminated - add termination message
    const onTerminated = (event: SessionEvents['familiar:terminated']): void => {
      this.appendLine(event.familiarId, `--- Agent terminated: ${event.reason} ---`);
      // Note: We don't dispose the channel here so user can review output
    };
    this.familiarManager.on('familiar:terminated', onTerminated);
    this.subscriptions.push(() => this.familiarManager.off('familiar:terminated', onTerminated));

    // Subscribe to familiar:statusChanged - log status changes
    const onStatusChanged = (event: SessionEvents['familiar:statusChanged']): void => {
      const { familiar, previousStatus } = event;
      this.appendLine(familiar.taskId, `--- Status: ${previousStatus} → ${familiar.status} ---`);
    };
    this.familiarManager.on('familiar:statusChanged', onStatusChanged);
    this.subscriptions.push(() => this.familiarManager.off('familiar:statusChanged', onStatusChanged));

    // Subscribe to familiar:question - log question
    const onQuestion = (event: SessionEvents['familiar:question']): void => {
      this.appendLine(event.question.taskId, `--- Question: ${event.question.question} ---`);
    };
    this.familiarManager.on('familiar:question', onQuestion);
    this.subscriptions.push(() => this.familiarManager.off('familiar:question', onQuestion));
  }

  private formatTimestamp(date: Date): string {
    return date.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
  }

  private getOutputFilePath(taskId: string): string {
    // Sanitize taskId to prevent path traversal
    const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.outputDir, `${safeTaskId}.log`);
  }

  private async persistLine(taskId: string, timestamp: string, line: string): Promise<void> {
    const filePath = this.getOutputFilePath(taskId);
    const formattedLine = `[${timestamp}] ${line}\n`;

    try {
      // Use appendFile for simplicity (could optimize with file handles for high-frequency writes)
      await fs.promises.appendFile(filePath, formattedLine);
    } catch {
      // Swallow errors - persistence is best-effort
    }
  }
}
