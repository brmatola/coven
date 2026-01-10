import * as http from 'http';
import { EventEmitter } from 'events';
import { DaemonClientError } from './types';

/**
 * SSE event types from daemon
 */
export type SSEEventType =
  | 'state.snapshot'
  | 'workflow.started'
  | 'workflow.completed'
  | 'workflow.failed'
  | 'workflow.paused'
  | 'workflow.resumed'
  | 'agent.spawned'
  | 'agent.output'
  | 'agent.completed'
  | 'agent.failed'
  | 'agent.killed'
  | 'tasks.updated'
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'questions.asked'
  | 'questions.answered'
  | 'heartbeat';

/**
 * Parsed SSE event
 */
export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
  id?: string;
  timestamp: number;
}

/**
 * Events emitted by SSEClient
 */
export interface SSEClientEvents {
  event: (event: SSEEvent) => void;
  error: (error: Error) => void;
  connected: () => void;
  disconnected: () => void;
}

/**
 * SSE client connection state
 */
export type SSEConnectionState = 'disconnected' | 'connecting' | 'connected';

/**
 * Heartbeat timeout in milliseconds
 */
const HEARTBEAT_TIMEOUT_MS = 35000; // 35 seconds (daemon sends every 30s)

/**
 * SSE client for receiving real-time events from the daemon.
 * Connects to the daemon's /events endpoint and parses SSE stream.
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
   * Connect to the SSE endpoint.
   */
  connect(): void {
    if (this._connectionState !== 'disconnected') {
      return;
    }

    this._connectionState = 'connecting';
    this.buffer = '';
    this.currentEventType = '';
    this.currentEventData = [];
    this.currentEventId = undefined;

    const requestOptions: http.RequestOptions = {
      socketPath: this.socketPath,
      path: this.path,
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    };

    this.request = http.request(requestOptions, (res) => {
      this.response = res;

      if (res.statusCode !== 200) {
        this._connectionState = 'disconnected';
        this.emit(
          'error',
          new DaemonClientError('request_failed', `SSE connection failed with status ${res.statusCode}`)
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
        this.emit('error', new DaemonClientError('connection_refused', 'Daemon connection refused'));
      } else if (error.code === 'ENOENT') {
        this.emit('error', new DaemonClientError('socket_not_found', `Socket not found: ${this.socketPath}`));
      } else {
        this.emit('error', new DaemonClientError('request_failed', `SSE connection failed: ${error.message}`));
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

    const eventType = this.currentEventType || 'message';
    const dataString = this.currentEventData.join('\n');

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
      type: eventType as SSEEventType,
      data,
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
      this.emit('error', new DaemonClientError('connection_timeout', 'SSE heartbeat timeout'));
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
