/**
 * SSE event helpers for E2E tests.
 *
 * Provides utilities to wait for and assert on SSE events from the daemon.
 */
import * as http from 'http';
import { EventEmitter } from 'events';

/**
 * Parsed SSE event from daemon.
 */
export interface SSEEvent {
  type: string;
  data: unknown;
  timestamp?: number;
}

/**
 * Event types emitted by the daemon.
 */
export type DaemonEventType =
  | 'state.snapshot'
  | 'session.started'
  | 'session.stopped'
  | 'workflow.started'
  | 'workflow.step'
  | 'workflow.completed'
  | 'workflow.failed'
  | 'agent.spawned'
  | 'agent.output'
  | 'agent.completed'
  | 'agent.failed'
  | 'tasks.updated'
  | 'questions.asked'
  | 'questions.answered'
  | 'heartbeat';

/**
 * SSE client for receiving events from daemon.
 */
export class SSEClient extends EventEmitter {
  private readonly socketPath: string;
  private request: http.ClientRequest | null = null;
  private buffer = '';
  private connected = false;

  constructor(socketPath: string) {
    super();
    this.socketPath = socketPath;
  }

  /**
   * Connect to the SSE endpoint.
   */
  connect(): void {
    if (this.connected) {
      return;
    }

    const options: http.RequestOptions = {
      socketPath: this.socketPath,
      path: '/events',
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    };

    this.request = http.request(options, (res) => {
      if (res.statusCode !== 200) {
        this.emit('error', new Error(`SSE connection failed: ${res.statusCode}`));
        return;
      }

      this.connected = true;
      this.emit('connect');

      res.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString();
        this.processBuffer();
      });

      res.on('end', () => {
        this.connected = false;
        this.emit('disconnect');
      });
    });

    this.request.on('error', (err) => {
      this.connected = false;
      this.emit('error', err);
    });

    this.request.end();
  }

  /**
   * Disconnect from the SSE endpoint.
   */
  disconnect(): void {
    if (this.request) {
      this.request.destroy();
      this.request = null;
    }
    this.connected = false;
    this.buffer = '';
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Process the buffer for complete SSE events.
   */
  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = '';

    let eventType = 'message';
    let eventData = '';

    for (const line of lines) {
      if (line === '') {
        // End of event
        if (eventData) {
          try {
            const data = JSON.parse(eventData);
            const event: SSEEvent = {
              type: eventType,
              data,
              timestamp: Date.now(),
            };
            this.emit('event', event);
            this.emit(eventType, data);
          } catch {
            // Non-JSON data
            this.emit('event', { type: eventType, data: eventData });
          }
          eventType = 'message';
          eventData = '';
        }
      } else if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        eventData += line.slice(5).trim();
      } else {
        // Incomplete line, put back in buffer
        this.buffer = line;
      }
    }
  }
}

/**
 * Helper for waiting on SSE events during tests.
 */
export class EventWaiter {
  private readonly client: SSEClient;
  private readonly events: SSEEvent[] = [];
  private readonly socketPath: string;
  private cleanupFn: (() => void) | null = null;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
    this.client = new SSEClient(socketPath);

    // Collect all events
    this.client.on('event', (event: SSEEvent) => {
      this.events.push(event);
    });
  }

  /**
   * Start listening for events.
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout connecting to SSE endpoint'));
      }, 5000);

      this.client.once('connect', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.client.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.client.connect();
    });
  }

  /**
   * Stop listening for events.
   */
  stop(): void {
    this.client.disconnect();
    if (this.cleanupFn) {
      this.cleanupFn();
    }
  }

  /**
   * Wait for a specific event type.
   *
   * @param eventType The event type to wait for
   * @param timeout Maximum time to wait in ms (default: 10000)
   * @param predicate Optional predicate to filter events
   */
  async waitForEvent<T = unknown>(
    eventType: DaemonEventType | string,
    timeout = 10000,
    predicate?: (data: T) => boolean
  ): Promise<SSEEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for event '${eventType}' after ${timeout}ms`));
      }, timeout);

      const handler = (event: SSEEvent) => {
        if (event.type === eventType) {
          if (!predicate || predicate(event.data as T)) {
            clearTimeout(timer);
            this.client.off('event', handler);
            resolve(event);
          }
        }
      };

      // Check already-received events first
      const existing = this.events.find(
        (e) => e.type === eventType && (!predicate || predicate(e.data as T))
      );
      if (existing) {
        clearTimeout(timer);
        resolve(existing);
        return;
      }

      this.client.on('event', handler);
    });
  }

  /**
   * Wait for a sequence of events in order.
   *
   * @param eventTypes List of event types to wait for in order
   * @param timeout Maximum time to wait for all events in ms (default: 30000)
   */
  async waitForEventSequence(
    eventTypes: (DaemonEventType | string)[],
    timeout = 30000
  ): Promise<SSEEvent[]> {
    const results: SSEEvent[] = [];
    const perEventTimeout = Math.floor(timeout / eventTypes.length);

    for (const eventType of eventTypes) {
      const event = await this.waitForEvent(eventType, perEventTimeout);
      results.push(event);
    }

    return results;
  }

  /**
   * Get all events received so far.
   */
  getEvents(): SSEEvent[] {
    return [...this.events];
  }

  /**
   * Get events of a specific type.
   */
  getEventsByType(eventType: DaemonEventType | string): SSEEvent[] {
    return this.events.filter((e) => e.type === eventType);
  }

  /**
   * Clear the event buffer.
   */
  clearEvents(): void {
    this.events.length = 0;
  }

  /**
   * Assert that an event was received.
   *
   * @throws Error if event was not received
   */
  assertEventReceived(eventType: DaemonEventType | string): SSEEvent {
    const event = this.events.find((e) => e.type === eventType);
    if (!event) {
      throw new Error(
        `Expected event '${eventType}' was not received. ` +
        `Received events: ${this.events.map((e) => e.type).join(', ')}`
      );
    }
    return event;
  }

  /**
   * Assert that an event was NOT received.
   *
   * @throws Error if event was received
   */
  assertEventNotReceived(eventType: DaemonEventType | string): void {
    const event = this.events.find((e) => e.type === eventType);
    if (event) {
      throw new Error(
        `Event '${eventType}' was received but should not have been`
      );
    }
  }
}

/**
 * Create an EventWaiter that will start listening immediately.
 */
export async function createEventWaiter(socketPath: string): Promise<EventWaiter> {
  const waiter = new EventWaiter(socketPath);
  await waiter.start();
  return waiter;
}
