import { EventEmitter } from 'events';
import { vi } from 'vitest';
import type { SSEEvent, SSEEventType, SSEConnectionState } from '@coven/client-ts';
import { DaemonClientError } from '../../daemon/types';

/**
 * Queued event with optional delay
 */
interface QueuedEvent {
  event: SSEEvent;
  delayMs?: number;
}

/**
 * Mock SSE stream for unit testing.
 * Simulates SSE event streams without actual socket communication.
 *
 * @example
 * ```typescript
 * const mock = new MockSSEStream();
 *
 * // Set up event handler
 * const events: SSEEvent[] = [];
 * mock.on('event', (e) => events.push(e));
 *
 * // Simulate connection
 * mock.connect();
 *
 * // Emit events
 * mock.emitEvent({ type: 'workflow.started', data: { id: 'wf-1' }, timestamp: Date.now() });
 *
 * // Queue multiple events
 * mock.queueEvents([
 *   { type: 'agent.spawned', data: { taskId: 'task-1' }, timestamp: Date.now() },
 *   { type: 'agent.completed', data: { taskId: 'task-1' }, timestamp: Date.now() + 1000 },
 * ]);
 * mock.flushQueue();
 *
 * // Simulate disconnect
 * mock.simulateDisconnect();
 * ```
 */
export class MockSSEStream extends EventEmitter {
  private _connectionState: SSEConnectionState = 'disconnected';
  private eventQueue: QueuedEvent[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];

  // Track event emissions for verification
  private emittedEvents: SSEEvent[] = [];

  // Mock functions for spying
  connect = vi.fn(() => this.doConnect());
  disconnect = vi.fn(() => this.doDisconnect());

  /**
   * Get the current connection state.
   */
  get connectionState(): SSEConnectionState {
    return this._connectionState;
  }

  /**
   * Get all events that have been emitted.
   */
  getEmittedEvents(): SSEEvent[] {
    return [...this.emittedEvents];
  }

  /**
   * Get emitted events of a specific type.
   */
  getEventsOfType(type: SSEEventType): SSEEvent[] {
    return this.emittedEvents.filter((e) => e.type === type);
  }

  // ============================================================================
  // Connection Control
  // ============================================================================

  private doConnect(): void {
    if (this._connectionState !== 'disconnected') {
      return;
    }

    this._connectionState = 'connecting';

    // Simulate async connection
    setTimeout(() => {
      if (this._connectionState === 'connecting') {
        this._connectionState = 'connected';
        this.emit('connected');
      }
    }, 0);
  }

  private doDisconnect(): void {
    this.clearTimers();

    if (this._connectionState !== 'disconnected') {
      this._connectionState = 'disconnected';
      this.emit('disconnected');
    }
  }

  /**
   * Immediately set connected state (useful for synchronous tests).
   */
  setConnected(): void {
    this._connectionState = 'connected';
    this.emit('connected');
  }

  /**
   * Immediately set disconnected state.
   */
  setDisconnected(): void {
    this._connectionState = 'disconnected';
    this.emit('disconnected');
  }

  // ============================================================================
  // Event Emission
  // ============================================================================

  /**
   * Emit a single SSE event immediately.
   */
  emitEvent(event: SSEEvent): void {
    this.emittedEvents.push(event);
    this.emit('event', event);
  }

  /**
   * Emit event with a delay.
   * Returns a promise that resolves when the event is emitted.
   */
  emitWithDelay(event: SSEEvent, delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.emitEvent(event);
        resolve();
      }, delayMs);
      this.timers.push(timer);
    });
  }

  /**
   * Queue events to be emitted later.
   * Use flushQueue() to emit all at once, or flushQueueWithDelays() to respect delays.
   */
  queueEvents(events: SSEEvent[]): void {
    events.forEach((event) => {
      this.eventQueue.push({ event });
    });
  }

  /**
   * Queue events with delays between them.
   * @param events Array of events with optional delays
   */
  queueEventsWithDelays(events: QueuedEvent[]): void {
    this.eventQueue.push(...events);
  }

  /**
   * Emit all queued events immediately (ignoring delays).
   */
  flushQueue(): void {
    const queue = [...this.eventQueue];
    this.eventQueue = [];

    queue.forEach(({ event }) => {
      this.emitEvent(event);
    });
  }

  /**
   * Emit queued events respecting their delays.
   * Returns a promise that resolves when all events are emitted.
   */
  async flushQueueWithDelays(): Promise<void> {
    const queue = [...this.eventQueue];
    this.eventQueue = [];

    for (const { event, delayMs } of queue) {
      if (delayMs && delayMs > 0) {
        await this.delay(delayMs);
      }
      this.emitEvent(event);
    }
  }

  /**
   * Clear the event queue without emitting.
   */
  clearQueue(): void {
    this.eventQueue = [];
  }

  // ============================================================================
  // Error Simulation
  // ============================================================================

  /**
   * Simulate a connection error.
   */
  simulateError(error?: Error): void {
    const err = error ?? new DaemonClientError('request_failed', 'SSE connection failed');
    this.emit('error', err);
  }

  /**
   * Simulate connection refused error.
   */
  simulateConnectionRefused(): void {
    this.simulateError(new DaemonClientError('connection_refused', 'Daemon connection refused'));
  }

  /**
   * Simulate socket not found error.
   */
  simulateSocketNotFound(): void {
    this.simulateError(new DaemonClientError('socket_not_found', 'Socket not found'));
  }

  /**
   * Simulate heartbeat timeout.
   */
  simulateHeartbeatTimeout(): void {
    this.simulateError(new DaemonClientError('connection_timeout', 'SSE heartbeat timeout'));
    this.doDisconnect();
  }

  // ============================================================================
  // Disconnect/Reconnect Simulation
  // ============================================================================

  /**
   * Simulate an unexpected disconnect.
   */
  simulateDisconnect(): void {
    this._connectionState = 'disconnected';
    this.emit('disconnected');
  }

  /**
   * Simulate reconnection after disconnect.
   */
  simulateReconnect(): void {
    this._connectionState = 'connecting';

    setTimeout(() => {
      this._connectionState = 'connected';
      this.emit('connected');
    }, 0);
  }

  /**
   * Simulate disconnect followed by reconnect after delay.
   */
  async simulateDisconnectAndReconnect(delayMs: number = 100): Promise<void> {
    this.simulateDisconnect();
    await this.delay(delayMs);
    this.simulateReconnect();
    // Wait for the async connect to complete
    await this.delay(0);
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Clear all timers (useful for cleanup).
   */
  clearTimers(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers = [];
  }

  /**
   * Clear emitted events history.
   */
  clearEmittedEvents(): void {
    this.emittedEvents = [];
  }

  /**
   * Reset all mock state.
   */
  reset(): void {
    this.clearTimers();
    this.eventQueue = [];
    this.emittedEvents = [];
    this._connectionState = 'disconnected';
    this.removeAllListeners();
    vi.clearAllMocks();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.timers.push(timer);
    });
  }
}

/**
 * Create a pre-connected MockSSEStream for tests that don't need connection logic.
 */
export function createConnectedMockSSEStream(): MockSSEStream {
  const mock = new MockSSEStream();
  mock.setConnected();
  return mock;
}

/**
 * Create event sequence helpers for common patterns.
 */
export const SSESequences = {
  /**
   * Create a workflow start to completion sequence.
   */
  workflowComplete(workflowId: string, taskId: string): SSEEvent[] {
    const now = Date.now();
    return [
      { type: 'workflow.started', data: { id: workflowId }, timestamp: now },
      { type: 'agent.spawned', data: { task_id: taskId }, timestamp: now + 10 },
      { type: 'agent.completed', data: { task_id: taskId, exit_code: 0 }, timestamp: now + 100 },
      { type: 'task.completed', data: { task_id: taskId }, timestamp: now + 110 },
      { type: 'workflow.completed', data: { id: workflowId }, timestamp: now + 120 },
    ];
  },

  /**
   * Create a workflow with failure sequence.
   */
  workflowFailed(workflowId: string, taskId: string, error: string): SSEEvent[] {
    const now = Date.now();
    return [
      { type: 'workflow.started', data: { id: workflowId }, timestamp: now },
      { type: 'agent.spawned', data: { task_id: taskId }, timestamp: now + 10 },
      { type: 'agent.failed', data: { task_id: taskId, error }, timestamp: now + 100 },
      { type: 'task.failed', data: { task_id: taskId, error }, timestamp: now + 110 },
      { type: 'workflow.failed', data: { id: workflowId, error }, timestamp: now + 120 },
    ];
  },

  /**
   * Create agent output events.
   */
  agentOutput(taskId: string, lines: string[]): SSEEvent[] {
    return lines.map((line, i) => ({
      type: 'agent.output' as SSEEventType,
      data: { task_id: taskId, line },
      timestamp: Date.now() + i,
    }));
  },

  /**
   * Create a question asked event.
   */
  questionAsked(questionId: string, taskId: string, text: string, options?: string[]): SSEEvent {
    return {
      type: 'questions.asked',
      data: { id: questionId, task_id: taskId, text, options },
      timestamp: Date.now(),
    };
  },

  /**
   * Create heartbeat events at intervals.
   */
  heartbeats(count: number, intervalMs: number = 30000): QueuedEvent[] {
    return Array.from({ length: count }, (_, i) => ({
      event: { type: 'heartbeat' as SSEEventType, data: {}, timestamp: Date.now() + i * intervalMs },
      delayMs: i === 0 ? 0 : intervalMs,
    }));
  },
};
