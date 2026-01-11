/**
 * SSE Client for Coven Daemon
 *
 * Connects to the daemon's /events endpoint over Unix socket and provides
 * typed event streaming with automatic reconnection support.
 */

import * as http from 'http';
import { EventEmitter } from 'events';
import type { Agent, Task, Question, DaemonState } from '../generated';

/**
 * SSE event types from daemon (matches API spec)
 */
export type SSEEventType =
  | 'state.snapshot'
  | 'agent.started'
  | 'agent.output'
  | 'agent.completed'
  | 'agent.failed'
  | 'agent.killed'
  | 'agent.question'
  | 'tasks.updated'
  | 'workflow.started'
  | 'workflow.step.started'
  | 'workflow.step.completed'
  | 'workflow.blocked'
  | 'workflow.merge_pending'
  | 'workflow.completed'
  | 'workflow.cancelled'
  | 'heartbeat';

/**
 * Workflow event data (common structure for workflow events)
 */
export interface WorkflowEventData {
  workflow_id: string;
  task_id: string;
  grimoire_name?: string;
  step_name?: string;
  step_type?: string;
  step_index?: number;
  success?: boolean;
  error?: string;
  duration?: string;
  reason?: string;
}

/**
 * Agent output event data
 */
export interface AgentOutputEventData {
  task_id: string;
  output: string;
}

/**
 * Agent failed event data
 */
export interface AgentFailedEventData {
  agent: Agent;
  error: string;
}

/**
 * Type mapping for event data by event type
 */
export interface SSEEventDataMap {
  'state.snapshot': DaemonState;
  'agent.started': Agent;
  'agent.output': AgentOutputEventData;
  'agent.completed': Agent;
  'agent.failed': AgentFailedEventData;
  'agent.killed': Agent;
  'agent.question': Question;
  'tasks.updated': Task[];
  'workflow.started': WorkflowEventData;
  'workflow.step.started': WorkflowEventData;
  'workflow.step.completed': WorkflowEventData;
  'workflow.blocked': WorkflowEventData;
  'workflow.merge_pending': WorkflowEventData;
  'workflow.completed': WorkflowEventData;
  'workflow.cancelled': WorkflowEventData;
  heartbeat: null;
}

/**
 * Parsed SSE event with typed data
 */
export interface SSEEvent<T extends SSEEventType = SSEEventType> {
  type: T;
  data: SSEEventDataMap[T];
  id?: string;
  timestamp: number;
}

/**
 * SSE client connection state
 */
export type SSEConnectionState = 'disconnected' | 'connecting' | 'connected';

/**
 * SSE connection error with error codes
 */
export class SSEError extends Error {
  constructor(
    public readonly code:
      | 'connection_refused'
      | 'socket_not_found'
      | 'connection_timeout'
      | 'request_failed',
    message: string
  ) {
    super(message);
    this.name = 'SSEError';
  }
}

/**
 * Heartbeat timeout in milliseconds (daemon sends every 30s)
 */
const HEARTBEAT_TIMEOUT_MS = 35000;

/**
 * SSE Client events interface for TypeScript
 */
export interface SSEClientEventMap {
  event: [SSEEvent];
  connected: [];
  disconnected: [];
  error: [SSEError | Error];
}

/**
 * SSE client for receiving real-time events from the daemon.
 *
 * Connects to the daemon's /events endpoint over Unix socket and streams
 * typed events. Handles automatic reconnection via Last-Event-ID header.
 *
 * Usage:
 * ```typescript
 * const sse = new SSEClient('/path/to/.coven/covend.sock');
 * sse.on('event', (event) => console.log(event.type, event.data));
 * sse.on('connected', () => console.log('Connected'));
 * sse.connect();
 * ```
 */
export class SSEClient extends EventEmitter {
  private readonly socketPath: string;
  private readonly path: string;

  private request: http.ClientRequest | null = null;
  private response: http.IncomingMessage | null = null;
  private buffer: string = '';
  private currentEventType: string = '';
  private currentEventData: string[] = [];
  private currentEventId: string | undefined;
  private lastEventId: string | undefined;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  private _connectionState: SSEConnectionState = 'disconnected';

  /**
   * Create a new SSE client.
   * @param socketPath Path to the Unix socket
   * @param path SSE endpoint path (default: /events)
   */
  constructor(socketPath: string, path: string = '/events') {
    super();
    this.socketPath = socketPath;
    this.path = path;
  }

  /**
   * Get the current connection state.
   */
  get connectionState(): SSEConnectionState {
    return this._connectionState;
  }

  /**
   * Get the last received event ID (for resuming streams).
   */
  getLastEventId(): string | undefined {
    return this.lastEventId;
  }

  /**
   * Connect to the SSE endpoint.
   * @param lastEventId Optional event ID to resume from
   */
  connect(lastEventId?: string): void {
    if (this._connectionState !== 'disconnected') {
      return;
    }

    this._connectionState = 'connecting';
    this.buffer = '';
    this.currentEventType = '';
    this.currentEventData = [];
    this.currentEventId = undefined;

    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    };

    // Use provided lastEventId or stored one for resumption
    const resumeId = lastEventId ?? this.lastEventId;
    if (resumeId) {
      headers['Last-Event-ID'] = resumeId;
    }

    const requestOptions: http.RequestOptions = {
      socketPath: this.socketPath,
      path: this.path,
      method: 'GET',
      headers,
    };

    this.request = http.request(requestOptions, (res) => {
      this.response = res;

      if (res.statusCode !== 200) {
        this._connectionState = 'disconnected';
        this.emit(
          'error',
          new SSEError(
            'request_failed',
            `SSE connection failed with status ${res.statusCode}`
          )
        );
        return;
      }

      this._connectionState = 'connected';
      this.emit('connected');
      this.resetHeartbeatTimer();

      res.setEncoding('utf-8');

      res.on('data', (chunk: string) => {
        this.onData(chunk);
      });

      res.on('end', () => {
        this.handleDisconnect();
      });

      res.on('error', (error: Error) => {
        this.handleError(error);
      });
    });

    this.request.on('error', (error: NodeJS.ErrnoException) => {
      this._connectionState = 'disconnected';

      if (error.code === 'ECONNREFUSED') {
        this.emit(
          'error',
          new SSEError('connection_refused', 'Daemon connection refused')
        );
      } else if (error.code === 'ENOENT') {
        this.emit(
          'error',
          new SSEError('socket_not_found', `Socket not found: ${this.socketPath}`)
        );
      } else {
        this.emit(
          'error',
          new SSEError('request_failed', `SSE connection failed: ${error.message}`)
        );
      }
    });

    this.request.end();
  }

  /**
   * Disconnect from the SSE endpoint.
   */
  disconnect(): void {
    this.clearHeartbeatTimer();

    if (this.request) {
      this.request.destroy();
      this.request = null;
    }

    if (this.response) {
      this.response.destroy();
      this.response = null;
    }

    if (this._connectionState !== 'disconnected') {
      this._connectionState = 'disconnected';
      this.emit('disconnected');
    }
  }

  /**
   * Handle incoming data from SSE stream.
   */
  private onData(chunk: string): void {
    this.resetHeartbeatTimer();
    this.buffer += chunk;

    // Process complete lines
    let lineEnd: number;
    while ((lineEnd = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, lineEnd);
      this.buffer = this.buffer.slice(lineEnd + 1);
      this.processLine(line.replace(/\r$/, '')); // Handle CRLF
    }
  }

  /**
   * Process a single line from the SSE stream.
   */
  private processLine(line: string): void {
    // Empty line signals end of event
    if (line === '') {
      this.dispatchEvent();
      return;
    }

    // Comment line (starts with :)
    if (line.startsWith(':')) {
      // Comments are ignored but reset heartbeat timer
      this.resetHeartbeatTimer();
      return;
    }

    // Parse field: value
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      // Field with no value
      this.processField(line, '');
      return;
    }

    const field = line.slice(0, colonIndex);
    let value = line.slice(colonIndex + 1);

    // Remove leading space from value if present
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    this.processField(field, value);
  }

  /**
   * Process a parsed field and value.
   */
  private processField(field: string, value: string): void {
    switch (field) {
      case 'event':
        this.currentEventType = value;
        break;
      case 'data':
        this.currentEventData.push(value);
        break;
      case 'id':
        this.currentEventId = value;
        break;
      case 'retry':
        // Reconnection time - we don't handle this directly
        break;
    }
  }

  /**
   * Dispatch the current buffered event.
   */
  private dispatchEvent(): void {
    // No data means no event to dispatch
    if (this.currentEventData.length === 0 && !this.currentEventType) {
      return;
    }

    const eventType = (this.currentEventType || 'message') as SSEEventType;
    const dataString = this.currentEventData.join('\n');

    // Store last event ID for resumption
    if (this.currentEventId) {
      this.lastEventId = this.currentEventId;
    }

    // Parse JSON data if present
    let data: unknown = dataString;
    if (dataString.length > 0) {
      try {
        data = JSON.parse(dataString);
      } catch {
        // Keep as string if not valid JSON
      }
    }

    const event: SSEEvent = {
      type: eventType,
      data: data as SSEEventDataMap[typeof eventType],
      id: this.currentEventId,
      timestamp: Date.now(),
    };

    // Reset for next event
    this.currentEventType = '';
    this.currentEventData = [];
    this.currentEventId = undefined;

    this.emit('event', event);
  }

  /**
   * Handle connection disconnect.
   */
  private handleDisconnect(): void {
    this.clearHeartbeatTimer();
    this._connectionState = 'disconnected';
    this.emit('disconnected');
  }

  /**
   * Handle connection error.
   */
  private handleError(error: Error): void {
    this.clearHeartbeatTimer();
    this._connectionState = 'disconnected';
    this.emit('error', error);
    this.emit('disconnected');
  }

  /**
   * Reset the heartbeat timer.
   */
  private resetHeartbeatTimer(): void {
    this.clearHeartbeatTimer();

    this.heartbeatTimer = setTimeout(() => {
      this.emit(
        'error',
        new SSEError('connection_timeout', 'SSE heartbeat timeout')
      );
      this.disconnect();
    }, HEARTBEAT_TIMEOUT_MS);
  }

  /**
   * Clear the heartbeat timer.
   */
  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
