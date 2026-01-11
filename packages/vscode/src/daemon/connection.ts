import { EventEmitter } from 'events';
import { DaemonClient } from './client';
import { SSEClient, SSEEvent } from './sse';
import { StateCache } from './cache';
import { DaemonClientError } from './types';

/**
 * Connection configuration options
 */
export interface ConnectionOptions {
  /** Maximum number of reconnection attempts (default: 3) */
  maxRetries?: number;
  /** Delay between reconnection attempts in ms (default: 1000) */
  retryDelayMs?: number;
  /** Whether to use exponential backoff for retries (default: false) */
  exponentialBackoff?: boolean;
  /** Expected daemon version range (e.g., ">=1.0.0") */
  expectedVersion?: string;
}

/**
 * Events emitted by ConnectionManager
 */
export interface ConnectionManagerEvents {
  connected: () => void;
  disconnected: () => void;
  reconnecting: (attempt: number, maxAttempts: number) => void;
  error: (error: Error) => void;
  versionMismatch: (expected: string, actual: string) => void;
}

/**
 * Connection state
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * Default connection options
 */
const DEFAULT_OPTIONS: Required<ConnectionOptions> = {
  maxRetries: 3,
  retryDelayMs: 1000,
  exponentialBackoff: false,
  expectedVersion: '',
};

/**
 * Manages the connection lifecycle between the extension and daemon.
 * Handles connecting, disconnecting, and automatic reconnection.
 */
export class ConnectionManager extends EventEmitter {
  private readonly client: DaemonClient;
  private readonly sseClient: SSEClient;
  private readonly cache: StateCache;
  private readonly options: Required<ConnectionOptions>;

  private _state: ConnectionState = 'disconnected';
  private reconnectAttempt: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isDisconnecting: boolean = false;

  constructor(
    client: DaemonClient,
    sseClient: SSEClient,
    cache: StateCache,
    options: ConnectionOptions = {}
  ) {
    super();
    this.client = client;
    this.sseClient = sseClient;
    this.cache = cache;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    this.setupSSEListeners();
  }

  /**
   * Get the current connection state.
   */
  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Check if currently connected.
   */
  isConnected(): boolean {
    return this._state === 'connected';
  }

  /**
   * Connect to the daemon.
   * Performs health check, version verification, and SSE subscription.
   */
  async connect(): Promise<void> {
    if (this._state === 'connected' || this._state === 'connecting') {
      return;
    }

    // Cancel any pending reconnection attempts to avoid race conditions
    this.cancelReconnect();

    this.isDisconnecting = false;
    this._state = 'connecting';
    this.reconnectAttempt = 0;

    try {
      await this.performConnect();
    } catch (error) {
      this._state = 'disconnected';
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Disconnect from the daemon.
   */
  disconnect(): void {
    this.isDisconnecting = true;
    this.cancelReconnect();

    if (this.sseClient.connectionState !== 'disconnected') {
      this.sseClient.disconnect();
    }

    if (this._state !== 'disconnected') {
      this._state = 'disconnected';
      this.cache.clear();
      this.emit('disconnected');
    }
  }

  /**
   * Dispose of the connection manager.
   */
  dispose(): void {
    this.disconnect();
    this.removeAllListeners();
    this.sseClient.removeAllListeners();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Set up SSE client event listeners.
   */
  private setupSSEListeners(): void {
    this.sseClient.on('connected', () => {
      // SSE connected, wait for state.snapshot before declaring fully connected
    });

    this.sseClient.on('event', (event: SSEEvent) => {
      this.handleSSEEvent(event);
    });

    this.sseClient.on('disconnected', () => {
      this.handleSSEDisconnect();
    });

    this.sseClient.on('error', (error: Error) => {
      this.emit('error', error);
    });
  }

  /**
   * Perform the actual connection sequence.
   */
  private async performConnect(): Promise<void> {
    // Step 1: Health check and version verification
    const health = await this.client.getHealth();

    if (this.options.expectedVersion && health.version) {
      const isCompatible = this.checkVersionCompatibility(
        health.version,
        this.options.expectedVersion
      );
      if (!isCompatible) {
        this.emit('versionMismatch', this.options.expectedVersion, health.version);
        // Continue anyway - version mismatch is a warning, not an error
      }
    }

    // Step 2: Connect to SSE stream
    this.sseClient.connect();

    // Wait for SSE connection and state snapshot
    await this.waitForConnection();
  }

  /**
   * Wait for SSE connection and initial state snapshot.
   */
  private waitForConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new DaemonClientError('connection_timeout', 'Timed out waiting for state snapshot'));
      }, 10000);

      const onEvent = (event: SSEEvent) => {
        if (event.type === 'state.snapshot') {
          cleanup();
          resolve();
        }
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const onDisconnected = () => {
        cleanup();
        reject(new DaemonClientError('connection_refused', 'SSE disconnected before state received'));
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.sseClient.off('event', onEvent);
        this.sseClient.off('error', onError);
        this.sseClient.off('disconnected', onDisconnected);
      };

      this.sseClient.on('event', onEvent);
      this.sseClient.on('error', onError);
      this.sseClient.on('disconnected', onDisconnected);
    });
  }

  /**
   * Handle an SSE event.
   */
  private handleSSEEvent(event: SSEEvent): void {
    // Forward events to cache
    this.cache.handleEvent(event);

    // On first state.snapshot, we're fully connected
    if (event.type === 'state.snapshot' && this._state === 'connecting') {
      this._state = 'connected';
      this.reconnectAttempt = 0;
      this.emit('connected');
    }
  }

  /**
   * Handle SSE disconnect - trigger reconnection if appropriate.
   */
  private handleSSEDisconnect(): void {
    if (this.isDisconnecting) {
      return;
    }

    const wasConnected = this._state === 'connected';
    this._state = 'disconnected';

    if (wasConnected) {
      this.emit('disconnected');
    }

    // Attempt reconnection
    this.scheduleReconnect();
  }

  /**
   * Schedule a reconnection attempt.
   */
  private scheduleReconnect(): void {
    if (this.isDisconnecting) {
      return;
    }

    if (this.reconnectAttempt >= this.options.maxRetries) {
      // Max retries reached - stay disconnected
      this.emit(
        'error',
        new DaemonClientError('connection_refused', 'Max reconnection attempts reached')
      );
      return;
    }

    this.reconnectAttempt++;
    this._state = 'reconnecting';

    const delay = this.options.exponentialBackoff
      ? this.options.retryDelayMs * Math.pow(2, this.reconnectAttempt - 1)
      : this.options.retryDelayMs;

    this.emit('reconnecting', this.reconnectAttempt, this.options.maxRetries);

    this.reconnectTimer = setTimeout(() => {
      void this.attemptReconnect();
    }, delay);
  }

  /**
   * Attempt to reconnect.
   */
  private async attemptReconnect(): Promise<void> {
    this.reconnectTimer = null;

    if (this.isDisconnecting) {
      return;
    }

    this._state = 'connecting';

    try {
      await this.performConnect();
    } catch {
      // Failed - schedule another attempt
      this._state = 'disconnected';
      this.scheduleReconnect();
    }
  }

  /**
   * Cancel any pending reconnection attempt.
   */
  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
  }

  /**
   * Check if a version is compatible with expected version.
   * Simple semver-like comparison.
   */
  private checkVersionCompatibility(actual: string, expected: string): boolean {
    // Support simple >=x.y.z format
    const match = expected.match(/^>=?\s*(\d+)\.(\d+)\.(\d+)$/);
    if (!match) {
      // Can't parse expected version, assume compatible
      return true;
    }

    const actualParts = actual.split('.').map(Number);
    const expectedParts = [Number(match[1]), Number(match[2]), Number(match[3])];

    // Compare major.minor.patch
    for (let i = 0; i < 3; i++) {
      const a = actualParts[i] ?? 0;
      const e = expectedParts[i] ?? 0;
      if (a > e) return true;
      if (a < e) return false;
    }

    // Versions are equal, which satisfies >=
    return true;
  }
}
