import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MockSSEStream, createConnectedMockSSEStream, SSESequences } from './MockSSEStream';
import type { SSEEvent } from '../../daemon/sse';
import { DaemonClientError } from '../../daemon/types';

describe('MockSSEStream', () => {
  let mock: MockSSEStream;

  beforeEach(() => {
    mock = new MockSSEStream();
  });

  afterEach(() => {
    mock.reset();
  });

  describe('connection state', () => {
    it('starts disconnected', () => {
      expect(mock.connectionState).toBe('disconnected');
    });

    it('transitions through connecting to connected', async () => {
      const states: string[] = [];

      mock.on('connected', () => states.push('connected'));
      mock.connect();

      expect(mock.connectionState).toBe('connecting');

      await vi.waitFor(() => expect(mock.connectionState).toBe('connected'));
      expect(states).toContain('connected');
    });

    it('setConnected immediately sets connected state', () => {
      const handler = vi.fn();
      mock.on('connected', handler);

      mock.setConnected();

      expect(mock.connectionState).toBe('connected');
      expect(handler).toHaveBeenCalled();
    });

    it('disconnect emits disconnected event', () => {
      const handler = vi.fn();
      mock.on('disconnected', handler);
      mock.setConnected();

      mock.disconnect();

      expect(mock.connectionState).toBe('disconnected');
      expect(handler).toHaveBeenCalled();
    });

    it('ignores connect when already connected', () => {
      mock.setConnected();

      mock.connect();

      expect(mock.connectionState).toBe('connected');
    });
  });

  describe('event emission', () => {
    it('emitEvent emits event immediately', () => {
      const handler = vi.fn();
      mock.on('event', handler);

      const event: SSEEvent = {
        type: 'workflow.started',
        data: { id: 'wf-1' },
        timestamp: Date.now(),
      };
      mock.emitEvent(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('emitEvent records emitted events', () => {
      const event: SSEEvent = {
        type: 'workflow.started',
        data: { id: 'wf-1' },
        timestamp: Date.now(),
      };
      mock.emitEvent(event);

      expect(mock.getEmittedEvents()).toEqual([event]);
    });

    it('getEventsOfType filters by event type', () => {
      const event1: SSEEvent = { type: 'workflow.started', data: {}, timestamp: Date.now() };
      const event2: SSEEvent = { type: 'agent.spawned', data: {}, timestamp: Date.now() };
      const event3: SSEEvent = { type: 'workflow.completed', data: {}, timestamp: Date.now() };

      mock.emitEvent(event1);
      mock.emitEvent(event2);
      mock.emitEvent(event3);

      const workflowEvents = mock.getEventsOfType('workflow.started');

      expect(workflowEvents).toEqual([event1]);
    });

    it('emitWithDelay emits after delay', async () => {
      const handler = vi.fn();
      mock.on('event', handler);

      const event: SSEEvent = {
        type: 'workflow.started',
        data: { id: 'wf-1' },
        timestamp: Date.now(),
      };

      const promise = mock.emitWithDelay(event, 50);

      expect(handler).not.toHaveBeenCalled();

      await promise;

      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  describe('event queue', () => {
    it('queueEvents stores events for later emission', () => {
      const events: SSEEvent[] = [
        { type: 'workflow.started', data: {}, timestamp: Date.now() },
        { type: 'workflow.completed', data: {}, timestamp: Date.now() },
      ];

      mock.queueEvents(events);

      // Not emitted yet
      expect(mock.getEmittedEvents()).toHaveLength(0);
    });

    it('flushQueue emits all queued events immediately', () => {
      const handler = vi.fn();
      mock.on('event', handler);

      const events: SSEEvent[] = [
        { type: 'workflow.started', data: {}, timestamp: Date.now() },
        { type: 'workflow.completed', data: {}, timestamp: Date.now() },
      ];
      mock.queueEvents(events);

      mock.flushQueue();

      expect(handler).toHaveBeenCalledTimes(2);
      expect(mock.getEmittedEvents()).toHaveLength(2);
    });

    it('flushQueueWithDelays respects delays', async () => {
      const handler = vi.fn();
      mock.on('event', handler);

      mock.queueEventsWithDelays([
        { event: { type: 'workflow.started', data: {}, timestamp: Date.now() }, delayMs: 0 },
        { event: { type: 'workflow.completed', data: {}, timestamp: Date.now() }, delayMs: 30 },
      ]);

      const start = Date.now();
      await mock.flushQueueWithDelays();
      const elapsed = Date.now() - start;

      expect(handler).toHaveBeenCalledTimes(2);
      expect(elapsed).toBeGreaterThanOrEqual(25);
    });

    it('clearQueue removes queued events without emitting', () => {
      mock.queueEvents([{ type: 'workflow.started', data: {}, timestamp: Date.now() }]);

      mock.clearQueue();
      mock.flushQueue();

      expect(mock.getEmittedEvents()).toHaveLength(0);
    });
  });

  describe('error simulation', () => {
    it('simulateError emits error event', () => {
      const handler = vi.fn();
      mock.on('error', handler);

      mock.simulateError();

      expect(handler).toHaveBeenCalledWith(expect.any(DaemonClientError));
    });

    it('simulateError with custom error', () => {
      const handler = vi.fn();
      mock.on('error', handler);
      const error = new Error('Custom error');

      mock.simulateError(error);

      expect(handler).toHaveBeenCalledWith(error);
    });

    it('simulateConnectionRefused emits connection_refused error', () => {
      const handler = vi.fn();
      mock.on('error', handler);

      mock.simulateConnectionRefused();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'connection_refused' })
      );
    });

    it('simulateSocketNotFound emits socket_not_found error', () => {
      const handler = vi.fn();
      mock.on('error', handler);

      mock.simulateSocketNotFound();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'socket_not_found' })
      );
    });

    it('simulateHeartbeatTimeout emits error and disconnects', () => {
      const errorHandler = vi.fn();
      const disconnectHandler = vi.fn();
      mock.on('error', errorHandler);
      mock.on('disconnected', disconnectHandler);
      mock.setConnected();

      mock.simulateHeartbeatTimeout();

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'connection_timeout' })
      );
      expect(disconnectHandler).toHaveBeenCalled();
      expect(mock.connectionState).toBe('disconnected');
    });
  });

  describe('disconnect/reconnect simulation', () => {
    it('simulateDisconnect changes state and emits event', () => {
      const handler = vi.fn();
      mock.on('disconnected', handler);
      mock.setConnected();

      mock.simulateDisconnect();

      expect(mock.connectionState).toBe('disconnected');
      expect(handler).toHaveBeenCalled();
    });

    it('simulateReconnect transitions through connecting to connected', async () => {
      mock.setConnected();
      mock.simulateDisconnect();

      mock.simulateReconnect();

      expect(mock.connectionState).toBe('connecting');
      await vi.waitFor(() => expect(mock.connectionState).toBe('connected'));
    });

    it('simulateDisconnectAndReconnect handles full cycle', async () => {
      const disconnectHandler = vi.fn();
      const connectHandler = vi.fn();
      mock.on('disconnected', disconnectHandler);
      mock.on('connected', connectHandler);
      mock.setConnected();

      await mock.simulateDisconnectAndReconnect(10);

      expect(disconnectHandler).toHaveBeenCalled();
      expect(connectHandler).toHaveBeenCalledTimes(2); // Initial + reconnect
    });
  });

  describe('cleanup', () => {
    it('clearEmittedEvents clears history', () => {
      mock.emitEvent({ type: 'workflow.started', data: {}, timestamp: Date.now() });

      mock.clearEmittedEvents();

      expect(mock.getEmittedEvents()).toHaveLength(0);
    });

    it('reset clears all state', () => {
      mock.setConnected();
      mock.emitEvent({ type: 'workflow.started', data: {}, timestamp: Date.now() });
      mock.queueEvents([{ type: 'workflow.completed', data: {}, timestamp: Date.now() }]);

      mock.reset();

      expect(mock.connectionState).toBe('disconnected');
      expect(mock.getEmittedEvents()).toHaveLength(0);
    });
  });

  describe('createConnectedMockSSEStream', () => {
    it('creates pre-connected stream', () => {
      const connected = createConnectedMockSSEStream();

      expect(connected.connectionState).toBe('connected');
    });
  });

  describe('SSESequences', () => {
    describe('workflowComplete', () => {
      it('creates workflow completion sequence', () => {
        const events = SSESequences.workflowComplete('wf-1', 'task-1');

        expect(events).toHaveLength(5);
        expect(events[0].type).toBe('workflow.started');
        expect(events[1].type).toBe('agent.spawned');
        expect(events[2].type).toBe('agent.completed');
        expect(events[3].type).toBe('task.completed');
        expect(events[4].type).toBe('workflow.completed');
      });
    });

    describe('workflowFailed', () => {
      it('creates workflow failure sequence', () => {
        const events = SSESequences.workflowFailed('wf-1', 'task-1', 'Error message');

        expect(events).toHaveLength(5);
        expect(events[0].type).toBe('workflow.started');
        expect(events[4].type).toBe('workflow.failed');
        expect(events[4].data).toMatchObject({ error: 'Error message' });
      });
    });

    describe('agentOutput', () => {
      it('creates output events for each line', () => {
        const events = SSESequences.agentOutput('task-1', ['Line 1', 'Line 2', 'Line 3']);

        expect(events).toHaveLength(3);
        events.forEach((e) => expect(e.type).toBe('agent.output'));
        expect(events[0].data).toMatchObject({ task_id: 'task-1', line: 'Line 1' });
      });
    });

    describe('questionAsked', () => {
      it('creates question event', () => {
        const event = SSESequences.questionAsked('q-1', 'task-1', 'What to do?', ['A', 'B']);

        expect(event.type).toBe('questions.asked');
        expect(event.data).toMatchObject({
          id: 'q-1',
          task_id: 'task-1',
          text: 'What to do?',
          options: ['A', 'B'],
        });
      });
    });

    describe('heartbeats', () => {
      it('creates heartbeat sequence', () => {
        const events = SSESequences.heartbeats(3, 1000);

        expect(events).toHaveLength(3);
        expect(events[0].delayMs).toBe(0);
        expect(events[1].delayMs).toBe(1000);
        expect(events[2].delayMs).toBe(1000);
      });
    });
  });
});
