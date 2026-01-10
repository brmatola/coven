import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { ConnectionManager } from './connection';
import type { DaemonClient } from './client';
import type { SSEClient, SSEEvent, SSEConnectionState } from './sse';
import type { StateCache } from './cache';
import type { HealthResponse } from './types';

// Mock DaemonClient
class MockDaemonClient {
  getHealth = vi.fn<[], Promise<HealthResponse>>();
  getState = vi.fn();
}

// Mock SSEClient that auto-emits snapshot on connect (simulating real behavior)
class MockSSEClient extends EventEmitter {
  private _connectionState: SSEConnectionState = 'disconnected';
  autoSnapshot: boolean = true;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;

  get connectionState(): SSEConnectionState {
    return this._connectionState;
  }

  connect = vi.fn(() => {
    this._connectionState = 'connected';
    this.emit('connected');
    // Auto-emit snapshot like real SSE stream does
    if (this.autoSnapshot) {
      // Use setTimeout(0) which works better with fake timers
      this.snapshotTimer = setTimeout(() => {
        this.emit('event', createSnapshotEvent());
      }, 0);
    }
  });

  disconnect = vi.fn(() => {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    this._connectionState = 'disconnected';
    this.emit('disconnected');
  });

  simulateEvent(event: SSEEvent): void {
    this.emit('event', event);
  }

  simulateDisconnect(): void {
    this._connectionState = 'disconnected';
    this.emit('disconnected');
  }

  simulateError(error: Error): void {
    this.emit('error', error);
  }
}

// Mock StateCache
class MockStateCache extends EventEmitter {
  handleEvent = vi.fn();
  handleSnapshot = vi.fn();
  clear = vi.fn();
}

// Helper to create state snapshot event
function createSnapshotEvent(): SSEEvent {
  return {
    type: 'state.snapshot',
    data: {
      workflow: { id: 'wf-1', status: 'idle' },
      tasks: [],
      agents: [],
      questions: [],
      timestamp: Date.now(),
    },
    timestamp: Date.now(),
  };
}

describe('ConnectionManager', () => {
  let client: MockDaemonClient;
  let sseClient: MockSSEClient;
  let cache: MockStateCache;
  let manager: ConnectionManager;

  beforeEach(() => {
    client = new MockDaemonClient();
    sseClient = new MockSSEClient();
    cache = new MockStateCache();

    // Default health response
    client.getHealth.mockResolvedValue({
      status: 'ok',
      version: '1.0.0',
      uptime: 1000,
      timestamp: Date.now(),
    });

    manager = new ConnectionManager(
      client as unknown as DaemonClient,
      sseClient as unknown as SSEClient,
      cache as unknown as StateCache
    );
  });

  afterEach(() => {
    vi.clearAllTimers();
    manager.dispose();
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('starts disconnected', () => {
      expect(manager.state).toBe('disconnected');
      expect(manager.isConnected()).toBe(false);
    });
  });

  describe('connect()', () => {
    it('performs health check first', async () => {
      await manager.connect();

      expect(client.getHealth).toHaveBeenCalled();
    });

    it('connects to SSE stream after health check', async () => {
      await manager.connect();

      expect(sseClient.connect).toHaveBeenCalled();
    });

    it('transitions to connected after receiving state.snapshot', async () => {
      const connectedHandler = vi.fn();
      manager.on('connected', connectedHandler);

      expect(manager.state).toBe('disconnected');
      await manager.connect();

      expect(manager.state).toBe('connected');
      expect(manager.isConnected()).toBe(true);
      expect(connectedHandler).toHaveBeenCalled();
    });

    it('does nothing if already connected', async () => {
      await manager.connect();
      await manager.connect();

      expect(client.getHealth).toHaveBeenCalledTimes(1);
    });

    it('does nothing if already connecting', async () => {
      const promise1 = manager.connect();
      const promise2 = manager.connect();

      await Promise.all([promise1, promise2]);

      expect(client.getHealth).toHaveBeenCalledTimes(1);
    });

    it('throws error if health check fails', async () => {
      client.getHealth.mockRejectedValue(new Error('Connection refused'));

      const errorHandler = vi.fn();
      manager.on('error', errorHandler);

      await expect(manager.connect()).rejects.toThrow('Connection refused');
      expect(manager.state).toBe('disconnected');
      expect(errorHandler).toHaveBeenCalled();
    });

    it('times out if state.snapshot not received', async () => {
      vi.useFakeTimers();
      sseClient.autoSnapshot = false;

      let error: Error | null = null;
      const connectPromise = manager.connect().catch((e) => {
        error = e;
      });

      // Advance time past timeout
      await vi.advanceTimersByTimeAsync(10001);
      await connectPromise;

      expect(error).toBeTruthy();
      expect(error?.message).toContain('Timed out waiting for state snapshot');
    });

    it('rejects if SSE disconnects before snapshot', async () => {
      vi.useFakeTimers();
      sseClient.autoSnapshot = false;
      sseClient.connect = vi.fn(() => {
        sseClient['_connectionState'] = 'connected';
        sseClient.emit('connected');
        // Disconnect immediately instead of sending snapshot
        setTimeout(() => sseClient.simulateDisconnect(), 0);
      });

      let error: Error | null = null;
      const connectPromise = manager.connect().catch((e) => {
        error = e;
      });
      await vi.advanceTimersByTimeAsync(1);
      await connectPromise;

      expect(error).toBeTruthy();
      expect(error?.message).toContain('SSE disconnected');
    });
  });

  describe('disconnect()', () => {
    it('disconnects SSE client', async () => {
      await manager.connect();

      manager.disconnect();

      expect(sseClient.disconnect).toHaveBeenCalled();
    });

    it('emits disconnected event', async () => {
      await manager.connect();

      const disconnectedHandler = vi.fn();
      manager.on('disconnected', disconnectedHandler);

      manager.disconnect();

      expect(disconnectedHandler).toHaveBeenCalled();
      expect(manager.state).toBe('disconnected');
    });

    it('clears cache on disconnect', async () => {
      await manager.connect();

      manager.disconnect();

      expect(cache.clear).toHaveBeenCalled();
    });

    it('does nothing if already disconnected', () => {
      const disconnectedHandler = vi.fn();
      manager.on('disconnected', disconnectedHandler);

      manager.disconnect();

      expect(disconnectedHandler).not.toHaveBeenCalled();
    });

    it('cancels pending reconnection', async () => {
      vi.useFakeTimers();

      const connectPromise = manager.connect();
      await vi.advanceTimersByTimeAsync(1); // Let snapshot fire
      await connectPromise;

      // Simulate disconnect to trigger reconnection
      sseClient.simulateDisconnect();
      expect(manager.state).toBe('reconnecting');

      // Now manually disconnect
      manager.disconnect();

      // Advance time past retry delay
      await vi.advanceTimersByTimeAsync(2000);

      // Should not have attempted to reconnect
      expect(client.getHealth).toHaveBeenCalledTimes(1);
    });
  });

  describe('auto-reconnection', () => {
    it('attempts reconnect after disconnect', async () => {
      vi.useFakeTimers();

      const connectPromise = manager.connect();
      await vi.advanceTimersByTimeAsync(1); // Let snapshot fire
      await connectPromise;

      const reconnectingHandler = vi.fn();
      manager.on('reconnecting', reconnectingHandler);

      // Simulate unexpected disconnect
      sseClient.simulateDisconnect();

      expect(reconnectingHandler).toHaveBeenCalledWith(1, 3);
      expect(manager.state).toBe('reconnecting');
    });

    it('waits retryDelayMs before reconnecting', async () => {
      vi.useFakeTimers();
      manager = new ConnectionManager(
        client as unknown as DaemonClient,
        sseClient as unknown as SSEClient,
        cache as unknown as StateCache,
        { retryDelayMs: 2000 }
      );

      const connectPromise = manager.connect();
      await vi.advanceTimersByTimeAsync(1); // Let snapshot fire
      await connectPromise;

      client.getHealth.mockClear();
      sseClient.simulateDisconnect();

      // Check that reconnecting event was emitted with correct retry info
      expect(manager.state).toBe('reconnecting');

      // After full delay, reconnect should be attempted
      await vi.advanceTimersByTimeAsync(2001);
      expect(client.getHealth).toHaveBeenCalled();
    });

    it('retries up to maxRetries times', async () => {
      vi.useFakeTimers();
      manager = new ConnectionManager(
        client as unknown as DaemonClient,
        sseClient as unknown as SSEClient,
        cache as unknown as StateCache,
        { maxRetries: 2, retryDelayMs: 100 }
      );

      const connectPromise = manager.connect();
      await vi.advanceTimersByTimeAsync(1); // Let snapshot fire
      await connectPromise;

      // Make health check fail for retries
      client.getHealth.mockRejectedValue(new Error('Connection failed'));
      client.getHealth.mockClear();

      const reconnectingHandler = vi.fn();
      const errorHandler = vi.fn();
      manager.on('reconnecting', reconnectingHandler);
      manager.on('error', errorHandler);

      sseClient.simulateDisconnect();

      // First retry
      expect(reconnectingHandler).toHaveBeenCalledWith(1, 2);
      await vi.advanceTimersByTimeAsync(101);

      // Second retry
      expect(reconnectingHandler).toHaveBeenCalledWith(2, 2);
      await vi.advanceTimersByTimeAsync(101);

      // Max retries reached
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Max reconnection attempts'),
        })
      );
    });

    it('supports exponential backoff option', () => {
      // Verify exponential backoff option is accepted
      const backoffManager = new ConnectionManager(
        client as unknown as DaemonClient,
        sseClient as unknown as SSEClient,
        cache as unknown as StateCache,
        { maxRetries: 3, retryDelayMs: 1000, exponentialBackoff: true }
      );

      // Just verify the manager was created with the option
      expect(backoffManager).toBeDefined();
      expect(backoffManager.state).toBe('disconnected');

      backoffManager.dispose();
    });

    it('reconnects successfully and emits connected', async () => {
      vi.useFakeTimers();

      const connectPromise = manager.connect();
      await vi.advanceTimersByTimeAsync(1); // Let snapshot fire
      await connectPromise;

      const connectedHandler = vi.fn();
      const disconnectedHandler = vi.fn();
      manager.on('connected', connectedHandler);
      manager.on('disconnected', disconnectedHandler);

      // Simulate disconnect
      sseClient.simulateDisconnect();
      expect(disconnectedHandler).toHaveBeenCalled();

      // Advance to retry
      await vi.advanceTimersByTimeAsync(1001);

      // Wait for snapshot to fire
      await vi.advanceTimersByTimeAsync(1);

      expect(connectedHandler).toHaveBeenCalled();
      expect(manager.isConnected()).toBe(true);
    });

    it('does not reconnect after manual disconnect', async () => {
      vi.useFakeTimers();

      const connectPromise = manager.connect();
      await vi.advanceTimersByTimeAsync(1); // Let snapshot fire
      await connectPromise;

      client.getHealth.mockClear();
      manager.disconnect();

      // SSE client emits disconnected in our mock
      // But manager should not attempt reconnect

      await vi.advanceTimersByTimeAsync(5000);
      expect(client.getHealth).not.toHaveBeenCalled();
    });
  });

  describe('SSE event forwarding', () => {
    it('forwards SSE events to cache', async () => {
      await manager.connect();

      const event: SSEEvent = {
        type: 'workflow.started',
        data: { workflowId: 'wf-2' },
        timestamp: Date.now(),
      };

      sseClient.simulateEvent(event);

      expect(cache.handleEvent).toHaveBeenCalledWith(event);
    });

    it('forwards SSE errors to manager error event', async () => {
      const errorHandler = vi.fn();
      manager.on('error', errorHandler);

      await manager.connect();

      const error = new Error('SSE stream error');
      sseClient.simulateError(error);

      expect(errorHandler).toHaveBeenCalledWith(error);
    });
  });

  describe('version checking', () => {
    it('emits versionMismatch for incompatible versions', async () => {
      manager = new ConnectionManager(
        client as unknown as DaemonClient,
        sseClient as unknown as SSEClient,
        cache as unknown as StateCache,
        { expectedVersion: '>=2.0.0' }
      );

      client.getHealth.mockResolvedValue({
        status: 'ok',
        version: '1.5.0',
        uptime: 1000,
        timestamp: Date.now(),
      });

      const versionHandler = vi.fn();
      manager.on('versionMismatch', versionHandler);

      await manager.connect();

      expect(versionHandler).toHaveBeenCalledWith('>=2.0.0', '1.5.0');
      // But still connects
      expect(manager.isConnected()).toBe(true);
    });

    it('does not emit versionMismatch for compatible versions', async () => {
      manager = new ConnectionManager(
        client as unknown as DaemonClient,
        sseClient as unknown as SSEClient,
        cache as unknown as StateCache,
        { expectedVersion: '>=1.0.0' }
      );

      const versionHandler = vi.fn();
      manager.on('versionMismatch', versionHandler);

      await manager.connect();

      expect(versionHandler).not.toHaveBeenCalled();
    });

    it('skips version check if no expected version specified', async () => {
      const versionHandler = vi.fn();
      manager.on('versionMismatch', versionHandler);

      await manager.connect();

      expect(versionHandler).not.toHaveBeenCalled();
    });

    it('handles equal versions as compatible', async () => {
      manager = new ConnectionManager(
        client as unknown as DaemonClient,
        sseClient as unknown as SSEClient,
        cache as unknown as StateCache,
        { expectedVersion: '>=1.0.0' }
      );

      client.getHealth.mockResolvedValue({
        status: 'ok',
        version: '1.0.0',
        uptime: 1000,
        timestamp: Date.now(),
      });

      const versionHandler = vi.fn();
      manager.on('versionMismatch', versionHandler);

      await manager.connect();

      expect(versionHandler).not.toHaveBeenCalled();
    });

    it('handles higher major version as compatible', async () => {
      manager = new ConnectionManager(
        client as unknown as DaemonClient,
        sseClient as unknown as SSEClient,
        cache as unknown as StateCache,
        { expectedVersion: '>=1.0.0' }
      );

      client.getHealth.mockResolvedValue({
        status: 'ok',
        version: '2.0.0',
        uptime: 1000,
        timestamp: Date.now(),
      });

      const versionHandler = vi.fn();
      manager.on('versionMismatch', versionHandler);

      await manager.connect();

      expect(versionHandler).not.toHaveBeenCalled();
    });

    it('treats unparseable expected version as compatible', async () => {
      manager = new ConnectionManager(
        client as unknown as DaemonClient,
        sseClient as unknown as SSEClient,
        cache as unknown as StateCache,
        { expectedVersion: 'invalid' }
      );

      const versionHandler = vi.fn();
      manager.on('versionMismatch', versionHandler);

      await manager.connect();

      expect(versionHandler).not.toHaveBeenCalled();
    });
  });

  describe('dispose()', () => {
    it('disconnects and removes all listeners', async () => {
      await manager.connect();

      const handler = vi.fn();
      manager.on('connected', handler);

      manager.dispose();

      expect(manager.state).toBe('disconnected');
      expect(manager.listenerCount('connected')).toBe(0);
    });
  });
});
