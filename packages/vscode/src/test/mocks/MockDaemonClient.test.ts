import { describe, it, expect, beforeEach } from 'vitest';
import { MockDaemonClient, createMockDaemonClient } from './MockDaemonClient';
import { DaemonClientError } from '../../daemon/types';
import { healthyResponse, emptyState, runningTask } from '../fixtures/stateFixtures';

describe('MockDaemonClient', () => {
  let mock: MockDaemonClient;

  beforeEach(() => {
    mock = new MockDaemonClient();
  });

  describe('response configuration', () => {
    it('returns configured health response', async () => {
      mock.setHealthResponse(healthyResponse);

      const result = await mock.getHealth();

      expect(result).toEqual(healthyResponse);
    });

    it('returns configured state response', async () => {
      mock.setStateResponse(emptyState);

      const result = await mock.getState();

      expect(result).toEqual(emptyState);
    });

    it('returns configured tasks response', async () => {
      mock.setTasksResponse([runningTask]);

      const result = await mock.getTasks();

      expect(result).toEqual([runningTask]);
    });

    it('returns configured single task response', async () => {
      mock.setTaskResponse('task-1', runningTask);

      const result = await mock.getTask('task-1');

      expect(result).toEqual(runningTask);
    });

    it('returns undefined for unconfigured endpoints', async () => {
      const result = await mock.getHealth();

      expect(result).toBeUndefined();
    });

    it('supports delayed responses', async () => {
      mock.setDelayedResponse('/health', healthyResponse, 50);

      const start = Date.now();
      const result = await mock.getHealth();
      const elapsed = Date.now() - start;

      expect(result).toEqual(healthyResponse);
      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some tolerance
    });
  });

  describe('error configuration', () => {
    it('throws configured error', async () => {
      const error = new DaemonClientError('task_not_found', 'Task not found');
      mock.setError('/tasks/task-1', error);

      await expect(mock.getTask('task-1')).rejects.toMatchObject({
        code: 'task_not_found',
        message: 'Task not found',
      });
    });

    it('throws connection refused for all endpoints', async () => {
      mock.setConnectionRefused();

      await expect(mock.getHealth()).rejects.toMatchObject({
        code: 'connection_refused',
      });
      await expect(mock.getState()).rejects.toMatchObject({
        code: 'connection_refused',
      });
    });

    it('throws socket not found for all endpoints', async () => {
      mock.setSocketNotFound();

      await expect(mock.getHealth()).rejects.toMatchObject({
        code: 'socket_not_found',
      });
    });

    it('provides task not found helper', async () => {
      mock.setTaskNotFound('nonexistent');

      await expect(mock.getTask('nonexistent')).rejects.toMatchObject({
        code: 'task_not_found',
      });
    });

    it('provides agent not found helper', async () => {
      mock.setAgentNotFound('nonexistent');

      await expect(mock.getAgent('nonexistent')).rejects.toMatchObject({
        code: 'agent_not_found',
      });
    });

    it('provides question not found helper', async () => {
      mock.setQuestionNotFound('nonexistent');

      await expect(mock.answerQuestion('nonexistent', 'answer')).rejects.toMatchObject({
        code: 'question_not_found',
      });
    });
  });

  describe('call history', () => {
    it('records GET calls', async () => {
      mock.setHealthResponse(healthyResponse);
      await mock.getHealth();

      const history = mock.getCallHistory();

      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        endpoint: '/health',
        method: 'GET',
      });
    });

    it('records POST calls with body', async () => {
      await mock.startSession({ featureBranch: 'feature/test' });

      const history = mock.getCallHistory();

      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        endpoint: '/session/start',
        method: 'POST',
        body: { featureBranch: 'feature/test' },
      });
    });

    it('records calls to specific endpoint', async () => {
      mock.setHealthResponse(healthyResponse);
      mock.setStateResponse(emptyState);

      await mock.getHealth();
      await mock.getState();
      await mock.getHealth();

      const healthCalls = mock.getCallsTo('/health');

      expect(healthCalls).toHaveLength(2);
    });

    it('clears history', async () => {
      mock.setHealthResponse(healthyResponse);
      await mock.getHealth();

      mock.clearHistory();

      expect(mock.getCallHistory()).toHaveLength(0);
    });
  });

  describe('assertions', () => {
    it('assertCalled passes when endpoint was called', async () => {
      mock.setHealthResponse(healthyResponse);
      await mock.getHealth();

      expect(() => mock.assertCalled('/health')).not.toThrow();
    });

    it('assertCalled throws when endpoint was not called', () => {
      expect(() => mock.assertCalled('/health')).toThrow(
        'Expected /health to be called, but it was not called'
      );
    });

    it('assertCalled with count passes when called expected times', async () => {
      mock.setHealthResponse(healthyResponse);
      await mock.getHealth();
      await mock.getHealth();

      expect(() => mock.assertCalled('/health', 2)).not.toThrow();
    });

    it('assertCalled with count throws when called different times', async () => {
      mock.setHealthResponse(healthyResponse);
      await mock.getHealth();

      expect(() => mock.assertCalled('/health', 2)).toThrow(
        'Expected /health to be called 2 times, but was called 1 times'
      );
    });

    it('assertNotCalled passes when endpoint was not called', () => {
      expect(() => mock.assertNotCalled('/health')).not.toThrow();
    });

    it('assertNotCalled throws when endpoint was called', async () => {
      mock.setHealthResponse(healthyResponse);
      await mock.getHealth();

      expect(() => mock.assertNotCalled('/health')).toThrow(
        'Expected /health not to be called, but it was called 1 times'
      );
    });
  });

  describe('API methods', () => {
    it('startTask encodes task ID', async () => {
      await mock.startTask('task/with/slashes');

      mock.assertCalled('/tasks/task%2Fwith%2Fslashes/start');
    });

    it('killTask includes reason', async () => {
      await mock.killTask('task-1', 'User requested');

      const calls = mock.getCallsTo('/tasks/task-1/kill');
      expect(calls[0].body).toEqual({ reason: 'User requested' });
    });

    it('answerQuestion includes answer', async () => {
      await mock.answerQuestion('q-1', 'Do option A');

      const calls = mock.getCallsTo('/questions/q-1/answer');
      expect(calls[0].body).toEqual({ answer: 'Do option A' });
    });

    it('getAgentOutput includes lines parameter', async () => {
      await mock.getAgentOutput('task-1', 100);

      mock.assertCalled('/agents/task-1/output?lines=100');
    });

    it('getAgentOutput works without lines parameter', async () => {
      await mock.getAgentOutput('task-1');

      mock.assertCalled('/agents/task-1/output');
    });

    it('approveWorkflow includes feedback', async () => {
      await mock.approveWorkflow('wf-1', 'Looks good!');

      const calls = mock.getCallsTo('/workflows/wf-1/approve');
      expect(calls[0].body).toEqual({ feedback: 'Looks good!' });
    });

    it('rejectWorkflow includes reason', async () => {
      await mock.rejectWorkflow('wf-1', 'Needs more tests');

      const calls = mock.getCallsTo('/workflows/wf-1/reject');
      expect(calls[0].body).toEqual({ reason: 'Needs more tests' });
    });
  });

  describe('reset', () => {
    it('clears responses and history', async () => {
      mock.setHealthResponse(healthyResponse);
      await mock.getHealth();

      mock.reset();

      expect(mock.getCallHistory()).toHaveLength(0);
      const result = await mock.getHealth();
      expect(result).toBeUndefined();
    });
  });

  describe('createMockDaemonClient', () => {
    it('creates mock with default responses', async () => {
      const defaultMock = createMockDaemonClient();

      const health = await defaultMock.getHealth();
      const state = await defaultMock.getState();
      const tasks = await defaultMock.getTasks();

      expect(health.status).toBe('ok');
      expect(state.workflow.status).toBe('idle');
      expect(tasks).toEqual([]);
    });
  });
});
