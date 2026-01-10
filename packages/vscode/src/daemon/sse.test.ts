import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SSEClient } from './sse';
import type { SSEEvent } from './sse';
import { DaemonClientError } from './types';
import { EventEmitter } from 'events';

// Mock http module
vi.mock('http', () => {
  const mockRequest = vi.fn();
  return {
    request: mockRequest,
  };
});

import * as http from 'http';

// Helper to create mock response
class MockResponse extends EventEmitter {
  statusCode: number;
  destroyed = false;

  constructor(statusCode: number) {
    super();
    this.statusCode = statusCode;
  }

  setEncoding = vi.fn();

  destroy(): void {
    this.destroyed = true;
  }
}

// Helper to create mock request
class MockRequest extends EventEmitter {
  destroyed = false;

  end = vi.fn();

  destroy(): void {
    this.destroyed = true;
  }
}

describe('SSEClient', () => {
  let mockRequest: MockRequest;
  let mockResponse: MockResponse;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockRequest = new MockRequest();
    mockResponse = new MockResponse(200);

    (http.request as ReturnType<typeof vi.fn>).mockImplementation(
      (_options: unknown, callback: (res: MockResponse) => void) => {
        // Defer callback to allow event handlers to be set up
        setTimeout(() => callback(mockResponse), 0);
        return mockRequest;
      }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('creates client with socket path and default path', () => {
      const client = new SSEClient('/test.sock');
      expect(client.connectionState).toBe('disconnected');
    });

    it('creates client with custom path', () => {
      const client = new SSEClient('/test.sock', '/custom/events');
      expect(client).toBeDefined();
    });
  });

  describe('connect()', () => {
    it('transitions to connecting state', () => {
      const client = new SSEClient('/test.sock');
      client.connect();

      expect(client.connectionState).toBe('connecting');
    });

    it('makes request to SSE endpoint', () => {
      const client = new SSEClient('/test.sock', '/events');
      client.connect();

      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          socketPath: '/test.sock',
          path: '/events',
          method: 'GET',
          headers: expect.objectContaining({
            Accept: 'text/event-stream',
          }),
        }),
        expect.any(Function)
      );
    });

    it('emits connected on successful connection', async () => {
      const client = new SSEClient('/test.sock');
      const connectedHandler = vi.fn();
      client.on('connected', connectedHandler);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      expect(client.connectionState).toBe('connected');
      expect(connectedHandler).toHaveBeenCalled();
    });

    it('does nothing if already connecting', () => {
      const client = new SSEClient('/test.sock');
      client.connect();
      client.connect();

      expect(http.request).toHaveBeenCalledTimes(1);
    });

    it('emits error on non-200 status', async () => {
      mockResponse.statusCode = 500;

      const client = new SSEClient('/test.sock');
      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'request_failed',
        })
      );
      expect(client.connectionState).toBe('disconnected');
    });

    it('emits error on connection refused', async () => {
      const error = new Error('connect ECONNREFUSED') as NodeJS.ErrnoException;
      error.code = 'ECONNREFUSED';

      (http.request as ReturnType<typeof vi.fn>).mockImplementation(() => {
        setTimeout(() => mockRequest.emit('error', error), 0);
        return mockRequest;
      });

      const client = new SSEClient('/test.sock');
      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'connection_refused',
        })
      );
    });

    it('emits error on socket not found', async () => {
      const error = new Error('connect ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';

      (http.request as ReturnType<typeof vi.fn>).mockImplementation(() => {
        setTimeout(() => mockRequest.emit('error', error), 0);
        return mockRequest;
      });

      const client = new SSEClient('/test.sock');
      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'socket_not_found',
        })
      );
    });
  });

  describe('disconnect()', () => {
    it('destroys request and response', async () => {
      const client = new SSEClient('/test.sock');
      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      client.disconnect();

      expect(mockRequest.destroyed).toBe(true);
      expect(mockResponse.destroyed).toBe(true);
    });

    it('emits disconnected event', async () => {
      const client = new SSEClient('/test.sock');
      const disconnectedHandler = vi.fn();
      client.on('disconnected', disconnectedHandler);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      client.disconnect();

      expect(disconnectedHandler).toHaveBeenCalled();
      expect(client.connectionState).toBe('disconnected');
    });

    it('does nothing if already disconnected', () => {
      const client = new SSEClient('/test.sock');
      const disconnectedHandler = vi.fn();
      client.on('disconnected', disconnectedHandler);

      client.disconnect();

      expect(disconnectedHandler).not.toHaveBeenCalled();
    });
  });

  describe('SSE event parsing', () => {
    it('parses simple event with data', async () => {
      const client = new SSEClient('/test.sock');
      const eventHandler = vi.fn();
      client.on('event', eventHandler);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      // Send SSE event
      mockResponse.emit('data', 'event: workflow.started\ndata: {"id": "123"}\n\n');

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'workflow.started',
          data: { id: '123' },
        })
      );
    });

    it('parses multi-line data', async () => {
      const client = new SSEClient('/test.sock');
      const eventHandler = vi.fn();
      client.on('event', eventHandler);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      mockResponse.emit('data', 'event: agent.output\ndata: line1\ndata: line2\n\n');

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent.output',
          data: 'line1\nline2',
        })
      );
    });

    it('parses event with id', async () => {
      const client = new SSEClient('/test.sock');
      const eventHandler = vi.fn();
      client.on('event', eventHandler);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      mockResponse.emit('data', 'id: 42\nevent: heartbeat\ndata: {}\n\n');

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'heartbeat',
          id: '42',
        })
      );
    });

    it('uses message as default event type', async () => {
      const client = new SSEClient('/test.sock');
      const eventHandler = vi.fn();
      client.on('event', eventHandler);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      mockResponse.emit('data', 'data: hello\n\n');

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message',
          data: 'hello',
        })
      );
    });

    it('handles chunked data', async () => {
      const client = new SSEClient('/test.sock');
      const eventHandler = vi.fn();
      client.on('event', eventHandler);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      // Send data in chunks
      mockResponse.emit('data', 'event: work');
      mockResponse.emit('data', 'flow.started\n');
      mockResponse.emit('data', 'data: {"test":true}\n\n');

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'workflow.started',
          data: { test: true },
        })
      );
    });

    it('ignores comment lines', async () => {
      const client = new SSEClient('/test.sock');
      const eventHandler = vi.fn();
      client.on('event', eventHandler);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      mockResponse.emit('data', ': this is a comment\nevent: test\ndata: {}\n\n');

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'test',
        })
      );
    });

    it('handles fields without values', async () => {
      const client = new SSEClient('/test.sock');
      const eventHandler = vi.fn();
      client.on('event', eventHandler);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      // event field without a colon sets type to empty string
      // but with data, we dispatch an event with empty type
      mockResponse.emit('data', 'event\ndata: {}\n\n');

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message', // empty event type defaults to 'message'
        })
      );
    });

    it('strips leading space from values', async () => {
      const client = new SSEClient('/test.sock');
      const eventHandler = vi.fn();
      client.on('event', eventHandler);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      mockResponse.emit('data', 'data:  test value \n\n');

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: ' test value ',
        })
      );
    });

    it('handles CRLF line endings', async () => {
      const client = new SSEClient('/test.sock');
      const eventHandler = vi.fn();
      client.on('event', eventHandler);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      mockResponse.emit('data', 'event: test\r\ndata: value\r\n\r\n');

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'test',
          data: 'value',
        })
      );
    });

    it('does not dispatch event for empty lines only', async () => {
      const client = new SSEClient('/test.sock');
      const eventHandler = vi.fn();
      client.on('event', eventHandler);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      mockResponse.emit('data', '\n\n\n');

      expect(eventHandler).not.toHaveBeenCalled();
    });

    it('keeps non-JSON data as string', async () => {
      const client = new SSEClient('/test.sock');
      const eventHandler = vi.fn();
      client.on('event', eventHandler);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      mockResponse.emit('data', 'data: not json\n\n');

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: 'not json',
        })
      );
    });
  });

  describe('heartbeat timeout', () => {
    it('emits error after 35 seconds of no data', async () => {
      const client = new SSEClient('/test.sock');
      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      // Wait for heartbeat timeout
      await vi.advanceTimersByTimeAsync(35001);

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'connection_timeout',
          message: expect.stringContaining('heartbeat'),
        })
      );
    });

    it('resets timer on data received', async () => {
      const client = new SSEClient('/test.sock');
      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      // Wait 30 seconds
      await vi.advanceTimersByTimeAsync(30000);

      // Receive data
      mockResponse.emit('data', ': heartbeat\n');

      // Wait another 30 seconds
      await vi.advanceTimersByTimeAsync(30000);

      // Should not have timed out yet
      expect(errorHandler).not.toHaveBeenCalled();
    });

    it('disconnects on heartbeat timeout', async () => {
      const client = new SSEClient('/test.sock');
      const disconnectedHandler = vi.fn();
      const errorHandler = vi.fn();
      client.on('disconnected', disconnectedHandler);
      client.on('error', errorHandler); // Prevent unhandled error

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      await vi.advanceTimersByTimeAsync(35001);

      expect(disconnectedHandler).toHaveBeenCalled();
      expect(client.connectionState).toBe('disconnected');
    });
  });

  describe('response end/error handling', () => {
    it('emits disconnected when response ends', async () => {
      const client = new SSEClient('/test.sock');
      const disconnectedHandler = vi.fn();
      client.on('disconnected', disconnectedHandler);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      mockResponse.emit('end');

      expect(disconnectedHandler).toHaveBeenCalled();
    });

    it('emits error and disconnected on response error', async () => {
      const client = new SSEClient('/test.sock');
      const errorHandler = vi.fn();
      const disconnectedHandler = vi.fn();
      client.on('error', errorHandler);
      client.on('disconnected', disconnectedHandler);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      mockResponse.emit('error', new Error('Stream error'));

      expect(errorHandler).toHaveBeenCalled();
      expect(disconnectedHandler).toHaveBeenCalled();
    });
  });

  describe('event includes timestamp', () => {
    it('adds timestamp to parsed events', async () => {
      const client = new SSEClient('/test.sock');
      const eventHandler = vi.fn();
      client.on('event', eventHandler);

      const before = Date.now();
      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      mockResponse.emit('data', 'data: test\n\n');

      const event = eventHandler.mock.calls[0]?.[0] as SSEEvent;
      expect(event.timestamp).toBeGreaterThanOrEqual(before);
    });
  });
});
