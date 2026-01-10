import * as vscode from 'vscode';
import { DaemonClient } from '../daemon/client';
import { SSEClient, SSEEvent } from '../daemon/sse';

/**
 * SSE event data for agent spawned
 */
interface AgentSpawnedData {
  agentId: string;
  taskId: string;
}

/**
 * SSE event data for agent output
 */
interface AgentOutputData {
  agentId: string;
  taskId: string;
  chunk: string;
}

/**
 * SSE event data for agent completed
 */
interface AgentCompletedData {
  agentId: string;
  taskId: string;
  exitCode: number;
}

/**
 * SSE event data for agent failed
 */
interface AgentFailedData {
  agentId: string;
  taskId: string;
  error: string;
}

/**
 * Manages VSCode output channels for familiars (AI agents).
 * Receives output via SSE events from the daemon and displays in output channels.
 */
export class FamiliarOutputChannel {
  private channels: Map<string, vscode.OutputChannel> = new Map();
  private activeAgentId: string | null = null;
  private activeTaskId: string | null = null;
  private taskTitles: Map<string, string> = new Map();
  private eventHandler: ((event: SSEEvent) => void) | null = null;

  constructor(
    private client: DaemonClient,
    private sseClient: SSEClient
  ) {}

  /**
   * Initialize the output channel manager.
   * Subscribes to SSE events.
   */
  initialize(): void {
    this.subscribeToEvents();
  }

  /**
   * Set the title for a task (used in output channel naming).
   */
  setTaskTitle(taskId: string, title: string): void {
    this.taskTitles.set(taskId, title);
  }

  /**
   * Get or create an output channel for a task.
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
   * Show the output channel for a task.
   */
  showChannel(taskId: string, preserveFocus = true): void {
    const channel = this.channels.get(taskId);
    if (channel) {
      channel.show(preserveFocus);
    }
  }

  /**
   * Append content to the output channel.
   */
  append(taskId: string, content: string): void {
    const channel = this.getOrCreateChannel(taskId);
    channel.append(content);
  }

  /**
   * Append a line to the output channel with timestamp.
   */
  appendLine(taskId: string, line: string): void {
    const channel = this.getOrCreateChannel(taskId);
    const timestamp = this.formatTimestamp(new Date());
    channel.appendLine(`[${timestamp}] ${line}`);
  }

  /**
   * Fetch historical output from daemon and display in channel.
   * Used when reconnecting to an active agent.
   */
  async fetchHistory(taskId: string): Promise<void> {
    try {
      const response = await this.client.getAgentOutput(taskId);
      const channel = this.getOrCreateChannel(taskId);
      channel.clear();
      for (const line of response.output) {
        channel.appendLine(line);
      }
    } catch {
      // Swallow error - agent might not exist or have no output
    }
  }

  /**
   * Clear the output channel for a task.
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
    this.taskTitles.delete(taskId);

    // Clear active agent if this was it
    if (this.activeTaskId === taskId) {
      this.activeAgentId = null;
      this.activeTaskId = null;
    }
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
   * Get the currently active task ID.
   */
  getActiveTaskId(): string | null {
    return this.activeTaskId;
  }

  /**
   * Get the currently active agent ID.
   */
  getActiveAgentId(): string | null {
    return this.activeAgentId;
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    // Unsubscribe from events
    if (this.eventHandler) {
      this.sseClient.off('event', this.eventHandler);
      this.eventHandler = null;
    }

    // Dispose all channels
    for (const channel of this.channels.values()) {
      channel.dispose();
    }
    this.channels.clear();
    this.taskTitles.clear();
    this.activeAgentId = null;
    this.activeTaskId = null;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private subscribeToEvents(): void {
    this.eventHandler = (event: SSEEvent) => {
      switch (event.type) {
        case 'agent.spawned':
          this.handleAgentSpawned(event.data as AgentSpawnedData);
          break;
        case 'agent.output':
          this.handleAgentOutput(event.data as AgentOutputData);
          break;
        case 'agent.completed':
          this.handleAgentCompleted(event.data as AgentCompletedData);
          break;
        case 'agent.failed':
          this.handleAgentFailed(event.data as AgentFailedData);
          break;
      }
    };

    this.sseClient.on('event', this.eventHandler);
  }

  private handleAgentSpawned(data: AgentSpawnedData): void {
    this.activeAgentId = data.agentId;
    this.activeTaskId = data.taskId;

    const channel = this.getOrCreateChannel(data.taskId);
    channel.clear();
    channel.show();
    this.appendLine(data.taskId, '--- Agent started ---');
  }

  private handleAgentOutput(data: AgentOutputData): void {
    // Only append output if it's for the active agent or a known task
    if (data.taskId && this.channels.has(data.taskId)) {
      const channel = this.getOrCreateChannel(data.taskId);
      channel.append(data.chunk);
    } else if (data.agentId === this.activeAgentId && this.activeTaskId) {
      const channel = this.getOrCreateChannel(this.activeTaskId);
      channel.append(data.chunk);
    }
  }

  private handleAgentCompleted(data: AgentCompletedData): void {
    const taskId = data.taskId || this.activeTaskId;
    if (taskId) {
      this.appendLine(taskId, `--- Agent completed (exit code: ${data.exitCode}) ---`);
    }

    // Clear active agent if this was it
    if (data.agentId === this.activeAgentId) {
      this.activeAgentId = null;
      this.activeTaskId = null;
    }
  }

  private handleAgentFailed(data: AgentFailedData): void {
    const taskId = data.taskId || this.activeTaskId;
    if (taskId) {
      this.appendLine(taskId, `--- Agent failed: ${data.error} ---`);
    }

    // Clear active agent if this was it
    if (data.agentId === this.activeAgentId) {
      this.activeAgentId = null;
      this.activeTaskId = null;
    }
  }

  private formatTimestamp(date: Date): string {
    return date.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
  }
}
