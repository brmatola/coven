import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DaemonClient } from './client';
import { DaemonClientError } from './types';
import type { DaemonState, HealthResponse, DaemonTask, Agent, Question } from './types';

// Mock http module
vi.mock('http', () => {
  const mockRequest = vi.fn();
  return {
    request: mockRequest,
  };
});

import * as http from 'http';
import { EventEmitter } from 'events';

// Helper to create mock response
class MockResponse extends EventEmitter {
  statusCode: number;

  constructor(statusCode: number) {
    super();
    this.statusCode = statusCode;
  }

  emitData(data: string): void {
    this.emit('data', Buffer.from(data));
  }

  emitEnd(): void {
    this.emit('end');
  }
}

// Helper to create mock request
class MockRequest extends EventEmitter {
  destroyed = false;

  write = vi.fn();
  end = vi.fn();
  destroy = vi.fn(() => {
    this.destroyed = true;
  });
}

function setupMockRequest(
  statusCode: number,
  responseData: unknown,
  error?: NodeJS.ErrnoException
): { request: MockRequest; response: MockResponse } {
  const mockReq = new MockRequest();
  const mockRes = new MockResponse(statusCode);

  (http.request as ReturnType<typeof vi.fn>).mockImplementation(
    (_options: unknown, callback: (res: MockResponse) => void) => {
      if (error) {
        // Defer error emission to allow event handlers to be set up
        setTimeout(() => mockReq.emit('error', error), 0);
      } else {
        // Call the callback with the response
        callback(mockRes);
        // Emit data and end after callback is called
        setTimeout(() => {
          if (responseData !== undefined) {
            mockRes.emitData(JSON.stringify(responseData));
          }
          mockRes.emitEnd();
        }, 0);
      }
      return mockReq;
    }
  );

  return { request: mockReq, response: mockRes };
}

describe('DaemonClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('stores socket path', () => {
      const client = new DaemonClient('/path/to/socket.sock');
      expect(client).toBeDefined();
    });
  });

  describe('getHealth()', () => {
    it('makes GET request to /health', async () => {
      const healthResponse: HealthResponse = {
        status: 'ok',
        version: '1.0.0',
        uptime: 12345,
        timestamp: Date.now(),
      };

      setupMockRequest(200, healthResponse);

      const client = new DaemonClient('/test.sock');
      const result = await client.getHealth();

      expect(result).toEqual(healthResponse);
      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          socketPath: '/test.sock',
          path: '/health',
          method: 'GET',
        }),
        expect.any(Function)
      );
    });
  });

  describe('getState()', () => {
    it('makes GET request to /state', async () => {
      const state: DaemonState = {
        workflow: { id: 'test', status: 'running' },
        tasks: [],
        agents: [],
        questions: [],
        timestamp: Date.now(),
      };

      setupMockRequest(200, state);

      const client = new DaemonClient('/test.sock');
      const result = await client.getState();

      expect(result).toEqual(state);
      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/state' }),
        expect.any(Function)
      );
    });
  });

  describe('Session API', () => {
    it('startSession() makes POST to /session/start', async () => {
      const mockReq = new MockRequest();
      const mockRes = new MockResponse(200);

      (http.request as ReturnType<typeof vi.fn>).mockImplementation(
        (_options: unknown, callback: (res: MockResponse) => void) => {
          callback(mockRes);
          setTimeout(() => mockRes.emitEnd(), 0);
          return mockReq;
        }
      );

      const client = new DaemonClient('/test.sock');
      await client.startSession({ featureBranch: 'feature/test' });

      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/session/start',
          method: 'POST',
        }),
        expect.any(Function)
      );
      expect(mockReq.write).toHaveBeenCalledWith(JSON.stringify({ featureBranch: 'feature/test' }));
    });

    it('stopSession() makes POST to /session/stop', async () => {
      const mockReq = new MockRequest();
      const mockRes = new MockResponse(200);

      (http.request as ReturnType<typeof vi.fn>).mockImplementation(
        (_options: unknown, callback: (res: MockResponse) => void) => {
          callback(mockRes);
          setTimeout(() => mockRes.emitEnd(), 0);
          return mockReq;
        }
      );

      const client = new DaemonClient('/test.sock');
      await client.stopSession(true);

      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/session/stop',
          method: 'POST',
        }),
        expect.any(Function)
      );
      expect(mockReq.write).toHaveBeenCalledWith(JSON.stringify({ force: true }));
    });
  });

  describe('Task API', () => {
    it('getTasks() returns task list', async () => {
      const tasks: DaemonTask[] = [
        {
          id: 'task-1',
          title: 'Test Task',
          description: 'Description',
          status: 'ready',
          priority: 2,
          dependencies: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      // Daemon returns { tasks: [...], count: N }
      setupMockRequest(200, { tasks, count: tasks.length });

      const client = new DaemonClient('/test.sock');
      const result = await client.getTasks();

      expect(result).toEqual(tasks);
    });

    it('getTask() fetches single task', async () => {
      const task: DaemonTask = {
        id: 'task-1',
        title: 'Test Task',
        description: 'Description',
        status: 'ready',
        priority: 2,
        dependencies: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      setupMockRequest(200, task);

      const client = new DaemonClient('/test.sock');
      const result = await client.getTask('task-1');

      expect(result).toEqual(task);
      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/tasks/task-1' }),
        expect.any(Function)
      );
    });

    it('getTask() URL-encodes task ID', async () => {
      setupMockRequest(200, {});

      const client = new DaemonClient('/test.sock');
      await client.getTask('task/with/slashes');

      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/tasks/task%2Fwith%2Fslashes' }),
        expect.any(Function)
      );
    });

    it('startTask() makes POST to /tasks/:id/start', async () => {
      const mockReq = new MockRequest();
      const mockRes = new MockResponse(200);

      (http.request as ReturnType<typeof vi.fn>).mockImplementation(
        (_options: unknown, callback: (res: MockResponse) => void) => {
          callback(mockRes);
          setTimeout(() => mockRes.emitEnd(), 0);
          return mockReq;
        }
      );

      const client = new DaemonClient('/test.sock');
      await client.startTask('task-1');

      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/tasks/task-1/start',
          method: 'POST',
        }),
        expect.any(Function)
      );
    });

    it('killTask() makes POST to /tasks/:id/kill', async () => {
      const mockReq = new MockRequest();
      const mockRes = new MockResponse(200);

      (http.request as ReturnType<typeof vi.fn>).mockImplementation(
        (_options: unknown, callback: (res: MockResponse) => void) => {
          callback(mockRes);
          setTimeout(() => mockRes.emitEnd(), 0);
          return mockReq;
        }
      );

      const client = new DaemonClient('/test.sock');
      await client.killTask('task-1', 'User requested');

      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/tasks/task-1/kill',
          method: 'POST',
        }),
        expect.any(Function)
      );
      expect(mockReq.write).toHaveBeenCalledWith(JSON.stringify({ reason: 'User requested' }));
    });
  });

  describe('Agent API', () => {
    it('getAgents() returns agent list', async () => {
      const agents: Agent[] = [
        {
          taskId: 'task-1',
          status: 'running',
          pid: 12345,
          startedAt: Date.now(),
        },
      ];

      setupMockRequest(200, agents);

      const client = new DaemonClient('/test.sock');
      const result = await client.getAgents();

      expect(result).toEqual(agents);
    });

    it('getAgent() fetches single agent', async () => {
      const agent: Agent = {
        taskId: 'task-1',
        status: 'running',
        pid: 12345,
        startedAt: Date.now(),
      };

      setupMockRequest(200, agent);

      const client = new DaemonClient('/test.sock');
      const result = await client.getAgent('task-1');

      expect(result).toEqual(agent);
      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/agents/task-1' }),
        expect.any(Function)
      );
    });

    it('getAgentOutput() fetches agent output', async () => {
      const output = {
        taskId: 'task-1',
        output: ['Line 1', 'Line 2'],
        totalLines: 2,
      };

      setupMockRequest(200, output);

      const client = new DaemonClient('/test.sock');
      const result = await client.getAgentOutput('task-1', 100);

      expect(result).toEqual(output);
      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/agents/task-1/output?lines=100' }),
        expect.any(Function)
      );
    });

    it('getAgentOutput() works without lines parameter', async () => {
      setupMockRequest(200, { taskId: 'task-1', output: [], totalLines: 0 });

      const client = new DaemonClient('/test.sock');
      await client.getAgentOutput('task-1');

      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/agents/task-1/output' }),
        expect.any(Function)
      );
    });
  });

  describe('Question API', () => {
    it('getQuestions() returns question list', async () => {
      const questions: Question[] = [
        {
          id: 'q-1',
          taskId: 'task-1',
          agentId: 'agent-1',
          text: 'What should I do?',
          askedAt: Date.now(),
        },
      ];

      setupMockRequest(200, questions);

      const client = new DaemonClient('/test.sock');
      const result = await client.getQuestions();

      expect(result).toEqual(questions);
    });

    it('answerQuestion() makes POST with answer', async () => {
      const mockReq = new MockRequest();
      const mockRes = new MockResponse(200);

      (http.request as ReturnType<typeof vi.fn>).mockImplementation(
        (_options: unknown, callback: (res: MockResponse) => void) => {
          callback(mockRes);
          setTimeout(() => mockRes.emitEnd(), 0);
          return mockReq;
        }
      );

      const client = new DaemonClient('/test.sock');
      await client.answerQuestion('q-1', 'Do option A');

      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/questions/q-1/answer',
          method: 'POST',
        }),
        expect.any(Function)
      );
      expect(mockReq.write).toHaveBeenCalledWith(JSON.stringify({ answer: 'Do option A' }));
    });
  });

  describe('Error handling', () => {
    it('throws DaemonClientError on connection refused', async () => {
      const error = new Error('connect ECONNREFUSED') as NodeJS.ErrnoException;
      error.code = 'ECONNREFUSED';

      setupMockRequest(0, undefined, error);

      const client = new DaemonClient('/test.sock');
      await expect(client.getHealth()).rejects.toMatchObject({
        code: 'connection_refused',
        message: 'Daemon connection refused',
      });
    });

    it('throws DaemonClientError on socket not found', async () => {
      const error = new Error('connect ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';

      setupMockRequest(0, undefined, error);

      const client = new DaemonClient('/test.sock');
      await expect(client.getHealth()).rejects.toMatchObject({
        code: 'socket_not_found',
      });
    });

    it('throws DaemonClientError on timeout', async () => {
      const mockReq = new MockRequest();

      (http.request as ReturnType<typeof vi.fn>).mockImplementation(() => {
        setTimeout(() => mockReq.emit('timeout'), 0);
        return mockReq;
      });

      const client = new DaemonClient('/test.sock');
      await expect(client.getHealth()).rejects.toMatchObject({
        code: 'connection_timeout',
      });
    });

    it('throws task_not_found for 404 on /tasks/', async () => {
      const mockRes = new MockResponse(404);

      (http.request as ReturnType<typeof vi.fn>).mockImplementation(
        (_options: unknown, callback: (res: MockResponse) => void) => {
          callback(mockRes);
          setTimeout(() => {
            mockRes.emitEnd();
          }, 0);
          return new MockRequest();
        }
      );

      const client = new DaemonClient('/test.sock');
      await expect(client.getTask('nonexistent')).rejects.toMatchObject({
        code: 'task_not_found',
      });
    });

    it('throws agent_not_found for 404 on /agents/', async () => {
      const mockRes = new MockResponse(404);

      (http.request as ReturnType<typeof vi.fn>).mockImplementation(
        (_options: unknown, callback: (res: MockResponse) => void) => {
          callback(mockRes);
          setTimeout(() => mockRes.emitEnd(), 0);
          return new MockRequest();
        }
      );

      const client = new DaemonClient('/test.sock');
      await expect(client.getAgent('nonexistent')).rejects.toMatchObject({
        code: 'agent_not_found',
      });
    });

    it('throws question_not_found for 404 on /questions/', async () => {
      const mockRes = new MockResponse(404);

      (http.request as ReturnType<typeof vi.fn>).mockImplementation(
        (_options: unknown, callback: (res: MockResponse) => void) => {
          callback(mockRes);
          setTimeout(() => mockRes.emitEnd(), 0);
          return new MockRequest();
        }
      );

      const client = new DaemonClient('/test.sock');
      await expect(client.answerQuestion('nonexistent', 'answer')).rejects.toMatchObject({
        code: 'question_not_found',
      });
    });

    it('parses error message from response body', async () => {
      const mockRes = new MockResponse(500);

      (http.request as ReturnType<typeof vi.fn>).mockImplementation(
        (_options: unknown, callback: (res: MockResponse) => void) => {
          callback(mockRes);
          setTimeout(() => {
            mockRes.emitData(JSON.stringify({ code: 'internal_error', message: 'Database error' }));
            mockRes.emitEnd();
          }, 0);
          return new MockRequest();
        }
      );

      const client = new DaemonClient('/test.sock');
      await expect(client.getState()).rejects.toMatchObject({
        code: 'internal_error',
        message: 'Database error',
      });
    });

    it('throws parse_error on invalid JSON response', async () => {
      const mockRes = new MockResponse(200);

      (http.request as ReturnType<typeof vi.fn>).mockImplementation(
        (_options: unknown, callback: (res: MockResponse) => void) => {
          callback(mockRes);
          setTimeout(() => {
            mockRes.emitData('not valid json');
            mockRes.emitEnd();
          }, 0);
          return new MockRequest();
        }
      );

      const client = new DaemonClient('/test.sock');
      await expect(client.getHealth()).rejects.toMatchObject({
        code: 'parse_error',
      });
    });

    it('handles generic errors', async () => {
      const error = new Error('Unknown error') as NodeJS.ErrnoException;
      error.code = 'UNKNOWN';

      setupMockRequest(0, undefined, error);

      const client = new DaemonClient('/test.sock');
      await expect(client.getHealth()).rejects.toMatchObject({
        code: 'request_failed',
      });
    });
  });

  describe('DaemonClientError', () => {
    it('has correct properties', () => {
      const error = new DaemonClientError('connection_refused', 'Test message', { foo: 'bar' });

      expect(error.name).toBe('DaemonClientError');
      expect(error.code).toBe('connection_refused');
      expect(error.message).toBe('Test message');
      expect(error.details).toEqual({ foo: 'bar' });
    });
  });
});
