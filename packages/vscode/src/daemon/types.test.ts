import { describe, it, expect } from 'vitest';
import { DaemonClientError } from './types';
import type {
  HealthResponse,
  DaemonState,
  DaemonTask,
  Agent,
  Question,
  WorkflowStatus,
  AgentStatus,
  DaemonErrorCode,
} from './types';

describe('daemon types', () => {
  describe('DaemonClientError', () => {
    it('creates error with code and message', () => {
      const error = new DaemonClientError('connection_refused', 'Connection refused');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(DaemonClientError);
      expect(error.name).toBe('DaemonClientError');
      expect(error.code).toBe('connection_refused');
      expect(error.message).toBe('Connection refused');
      expect(error.details).toBeUndefined();
    });

    it('creates error with details', () => {
      const error = new DaemonClientError('request_failed', 'Request failed', {
        statusCode: 500,
        body: 'Internal Server Error',
      });

      expect(error.code).toBe('request_failed');
      expect(error.details).toEqual({
        statusCode: 500,
        body: 'Internal Server Error',
      });
    });

    it('is throwable and catchable', () => {
      const throwError = (): void => {
        throw new DaemonClientError('socket_not_found', 'Socket not found');
      };

      expect(throwError).toThrow(DaemonClientError);

      try {
        throwError();
      } catch (e) {
        expect(e).toBeInstanceOf(DaemonClientError);
        if (e instanceof DaemonClientError) {
          expect(e.code).toBe('socket_not_found');
        }
      }
    });
  });

  describe('Type definitions', () => {
    it('HealthResponse has correct structure', () => {
      const response: HealthResponse = {
        status: 'ok',
        version: '1.0.0',
        uptime: 12345,
        timestamp: Date.now(),
      };

      expect(response.status).toBe('ok');
      expect(response.version).toBe('1.0.0');
      expect(typeof response.uptime).toBe('number');
      expect(typeof response.timestamp).toBe('number');
    });

    it('DaemonState has correct structure', () => {
      const state: DaemonState = {
        workflow: {
          id: 'workflow-1',
          status: 'running',
          startedAt: Date.now(),
        },
        tasks: [],
        agents: [],
        questions: [],
        timestamp: Date.now(),
      };

      expect(state.workflow.status).toBe('running');
      expect(Array.isArray(state.tasks)).toBe(true);
      expect(Array.isArray(state.agents)).toBe(true);
      expect(Array.isArray(state.questions)).toBe(true);
    });

    it('DaemonTask has correct structure', () => {
      const task: DaemonTask = {
        id: 'task-1',
        title: 'Test Task',
        description: 'A test task',
        status: 'ready',
        priority: 2,
        dependencies: ['task-0'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      expect(task.id).toBe('task-1');
      expect(task.status).toBe('ready');
      expect(task.dependencies).toContain('task-0');
    });

    it('Agent has correct structure', () => {
      const agent: Agent = {
        taskId: 'task-1',
        status: 'running',
        pid: 12345,
        startedAt: Date.now(),
      };

      expect(agent.taskId).toBe('task-1');
      expect(agent.status).toBe('running');
      expect(agent.pid).toBe(12345);
    });

    it('Question has correct structure', () => {
      const question: Question = {
        id: 'q-1',
        taskId: 'task-1',
        agentId: 'agent-1',
        text: 'What should I do?',
        options: ['Option A', 'Option B'],
        askedAt: Date.now(),
      };

      expect(question.id).toBe('q-1');
      expect(question.options).toContain('Option A');
    });

    it('WorkflowStatus values are correct', () => {
      const statuses: WorkflowStatus[] = ['idle', 'running', 'paused', 'completed', 'error'];
      expect(statuses).toHaveLength(5);
    });

    it('AgentStatus values are correct', () => {
      const statuses: AgentStatus[] = ['idle', 'running', 'waiting', 'complete', 'failed', 'killed'];
      expect(statuses).toHaveLength(6);
    });

    it('DaemonErrorCode values are correct', () => {
      const codes: DaemonErrorCode[] = [
        'connection_refused',
        'connection_timeout',
        'socket_not_found',
        'request_failed',
        'parse_error',
        'task_not_found',
        'agent_not_found',
        'question_not_found',
        'session_not_active',
        'session_already_active',
        'invalid_request',
        'internal_error',
      ];
      expect(codes).toHaveLength(12);
    });
  });
});
