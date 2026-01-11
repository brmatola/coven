import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DaemonClient } from './client';
import { DaemonClientError } from './types';
import {
  HealthService,
  StateService,
  TasksService,
  AgentsService,
  QuestionsService,
  WorkflowsService,
  HealthStatus,
  TaskStatus,
  AgentStatus,
  QuestionType,
  ApiError,
  Task,
} from '@coven/client-ts';

// Mock the generated services
vi.mock('@coven/client-ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@coven/client-ts')>();
  return {
    ...actual,
    CovenClient: vi.fn().mockImplementation(() => ({
      getAxiosInstance: vi.fn().mockReturnValue({
        post: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
      }),
    })),
    HealthService: {
      getHealth: vi.fn(),
    },
    StateService: {
      getState: vi.fn(),
    },
    TasksService: {
      getTasks: vi.fn(),
      startTask: vi.fn(),
      stopTask: vi.fn(),
    },
    AgentsService: {
      getAgents: vi.fn(),
      getAgentById: vi.fn(),
      getAgentOutput: vi.fn(),
    },
    QuestionsService: {
      getQuestions: vi.fn(),
      createQuestionAnswer: vi.fn(),
    },
    WorkflowsService: {
      createWorkflowApproveMerge: vi.fn(),
      updateWorkflowRejectMerge: vi.fn(),
    },
  };
});

describe('DaemonClient', () => {
  let client: DaemonClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new DaemonClient('/test.sock');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates client with socket path', () => {
      expect(client).toBeDefined();
    });
  });

  describe('getHealth()', () => {
    it('returns health response on success', async () => {
      const mockHealth: HealthStatus = {
        status: HealthStatus.status.OK,
        version: '1.0.0',
        uptime: 12345,
      };

      vi.mocked(HealthService.getHealth).mockResolvedValue(mockHealth);

      const result = await client.getHealth();

      expect(result.status).toBe('ok');
      expect(result.version).toBe('1.0.0');
      expect(result.uptime).toBe(12345);
      expect(result.timestamp).toBeDefined();
    });

    it('maps degraded status correctly', async () => {
      const mockHealth: HealthStatus = {
        status: HealthStatus.status.DEGRADED,
        version: '1.0.0',
        uptime: 12345,
      };

      vi.mocked(HealthService.getHealth).mockResolvedValue(mockHealth);

      const result = await client.getHealth();
      expect(result.status).toBe('degraded');
    });

    it('maps error status correctly', async () => {
      const mockHealth: HealthStatus = {
        status: HealthStatus.status.ERROR,
        version: '1.0.0',
        uptime: 12345,
      };

      vi.mocked(HealthService.getHealth).mockResolvedValue(mockHealth);

      const result = await client.getHealth();
      expect(result.status).toBe('error');
    });

    it('throws DaemonClientError on API error', async () => {
      vi.mocked(HealthService.getHealth).mockRejectedValue(
        new ApiError({} as Response, 'Service unavailable')
      );

      await expect(client.getHealth()).rejects.toBeInstanceOf(DaemonClientError);
    });
  });

  describe('getState()', () => {
    it('returns transformed state', async () => {
      const mockState = {
        state: {
          workflow: { id: 'wf-1', status: 'running' },
          tasks: [
            {
              id: 'task-1',
              title: 'Test Task',
              status: TaskStatus.OPEN,
              priority: 2,
              type: Task.type.TASK,
              created_at: '2025-01-01T00:00:00Z',
              updated_at: '2025-01-01T00:00:00Z',
            },
          ],
          agents: {
            'task-1': {
              task_id: 'task-1',
              pid: 12345,
              status: AgentStatus.RUNNING,
              worktree: '/tmp/wt',
              branch: 'test',
              started_at: '2025-01-01T00:00:00Z',
            },
          },
        },
        timestamp: '2025-01-01T00:00:00Z',
      };

      vi.mocked(StateService.getState).mockResolvedValue(mockState);

      const result = await client.getState();

      expect(result.workflow?.id).toBe('wf-1');
      expect(result.tasks).toHaveLength(1);
      expect(result.agents).toHaveLength(1);
    });

    it('handles empty state', async () => {
      const mockState = {
        state: {},
        timestamp: '2025-01-01T00:00:00Z',
      };

      vi.mocked(StateService.getState).mockResolvedValue(mockState);

      const result = await client.getState();

      expect(result.tasks).toEqual([]);
      expect(result.agents).toEqual([]);
    });
  });

  describe('Session API', () => {
    it('startSession() returns not implemented error', async () => {
      await expect(client.startSession()).rejects.toMatchObject({
        code: 'request_failed',
        message: expect.stringContaining('not yet in generated client'),
      });
    });

    it('stopSession() returns not implemented error', async () => {
      await expect(client.stopSession()).rejects.toMatchObject({
        code: 'request_failed',
        message: expect.stringContaining('not yet in generated client'),
      });
    });
  });

  describe('Task API', () => {
    it('getTasks() returns task list', async () => {
      const mockTasks = {
        tasks: [
          {
            id: 'task-1',
            title: 'Test Task',
            status: TaskStatus.OPEN,
            priority: 2,
            type: Task.type.TASK,
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
          },
        ],
        count: 1,
      };

      vi.mocked(TasksService.getTasks).mockResolvedValue(mockTasks);

      const result = await client.getTasks();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('task-1');
    });

    it('getTask() returns task by ID', async () => {
      const mockTasks = {
        tasks: [
          {
            id: 'task-1',
            title: 'Test Task',
            status: TaskStatus.OPEN,
            priority: 2,
            type: Task.type.TASK,
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
          },
        ],
        count: 1,
      };

      vi.mocked(TasksService.getTasks).mockResolvedValue(mockTasks);

      const result = await client.getTask('task-1');

      expect(result.id).toBe('task-1');
    });

    it('getTask() throws task_not_found for unknown ID', async () => {
      vi.mocked(TasksService.getTasks).mockResolvedValue({ tasks: [], count: 0 });

      await expect(client.getTask('nonexistent')).rejects.toMatchObject({
        code: 'task_not_found',
      });
    });

    it('startTask() calls TasksService.startTask', async () => {
      vi.mocked(TasksService.startTask).mockResolvedValue({});

      await client.startTask('task-1');

      expect(TasksService.startTask).toHaveBeenCalledWith({ id: 'task-1' });
    });

    it('killTask() calls TasksService.stopTask', async () => {
      vi.mocked(TasksService.stopTask).mockResolvedValue({});

      await client.killTask('task-1', 'User requested');

      expect(TasksService.stopTask).toHaveBeenCalledWith({ id: 'task-1' });
    });
  });

  describe('Agent API', () => {
    it('getAgents() returns agent list', async () => {
      const mockAgents = {
        agents: [
          {
            task_id: 'task-1',
            pid: 12345,
            status: AgentStatus.RUNNING,
            worktree: '/tmp/wt',
            branch: 'test',
            started_at: '2025-01-01T00:00:00Z',
          },
        ],
      };

      vi.mocked(AgentsService.getAgents).mockResolvedValue(mockAgents);

      const result = await client.getAgents();

      expect(result).toHaveLength(1);
      expect(result[0].task_id).toBe('task-1');
    });

    it('getAgent() returns single agent', async () => {
      const mockAgent = {
        task_id: 'task-1',
        pid: 12345,
        status: AgentStatus.RUNNING,
        worktree: '/tmp/wt',
        branch: 'test',
        started_at: '2025-01-01T00:00:00Z',
      };

      vi.mocked(AgentsService.getAgentById).mockResolvedValue(mockAgent);

      const result = await client.getAgent('task-1');

      expect(result.task_id).toBe('task-1');
      expect(AgentsService.getAgentById).toHaveBeenCalledWith({ id: 'task-1' });
    });

    it('getAgentOutput() returns output', async () => {
      const mockOutput = {
        lines: [{ line: 'Hello', timestamp: '2025-01-01T00:00:00Z' }],
        total_lines: 1,
      };

      vi.mocked(AgentsService.getAgentOutput).mockResolvedValue(mockOutput);

      const result = await client.getAgentOutput('task-1', 100);

      expect(result.lines).toHaveLength(1);
      expect(AgentsService.getAgentOutput).toHaveBeenCalledWith({ id: 'task-1', since: 100 });
    });

    it('getAgentOutput() works without since parameter', async () => {
      const mockOutput = {
        lines: [],
        total_lines: 0,
      };

      vi.mocked(AgentsService.getAgentOutput).mockResolvedValue(mockOutput);

      await client.getAgentOutput('task-1');

      expect(AgentsService.getAgentOutput).toHaveBeenCalledWith({ id: 'task-1' });
    });
  });

  describe('Question API', () => {
    it('getQuestions() returns question list', async () => {
      const mockQuestions = {
        questions: [
          {
            id: 'q-1',
            task_id: 'task-1',
            agent_id: 'agent-1',
            text: 'What should I do?',
            type: QuestionType.TEXT,
            asked_at: '2025-01-01T00:00:00Z',
          },
        ],
      };

      vi.mocked(QuestionsService.getQuestions).mockResolvedValue(mockQuestions);

      const result = await client.getQuestions();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('q-1');
    });

    it('answerQuestion() calls QuestionsService', async () => {
      vi.mocked(QuestionsService.createQuestionAnswer).mockResolvedValue({});

      await client.answerQuestion('q-1', 'Do option A');

      expect(QuestionsService.createQuestionAnswer).toHaveBeenCalledWith({
        id: 'q-1',
        requestBody: { answer: 'Do option A' },
      });
    });
  });

  describe('Workflow Review API', () => {
    it('approveWorkflow() calls WorkflowsService', async () => {
      vi.mocked(WorkflowsService.createWorkflowApproveMerge).mockResolvedValue({});

      await client.approveWorkflow('wf-1', 'Looks good');

      expect(WorkflowsService.createWorkflowApproveMerge).toHaveBeenCalledWith({
        id: 'wf-1',
        requestBody: { feedback: 'Looks good' },
      });
    });

    it('rejectWorkflow() calls WorkflowsService', async () => {
      vi.mocked(WorkflowsService.updateWorkflowRejectMerge).mockResolvedValue({});

      await client.rejectWorkflow('wf-1', 'Needs changes');

      expect(WorkflowsService.updateWorkflowRejectMerge).toHaveBeenCalledWith({
        id: 'wf-1',
        requestBody: { reason: 'Needs changes' },
      });
    });

    it('getWorkflowChanges() returns not implemented', async () => {
      await expect(client.getWorkflowChanges('wf-1')).rejects.toMatchObject({
        code: 'request_failed',
      });
    });

    it('getWorkflowReview() returns not implemented', async () => {
      await expect(client.getWorkflowReview('wf-1')).rejects.toMatchObject({
        code: 'not_implemented',
      });
    });
  });

  describe('Error handling', () => {
    it('maps ApiError to DaemonClientError', async () => {
      vi.mocked(TasksService.getTasks).mockRejectedValue(
        new ApiError({ status: 500 } as Response, 'Internal error')
      );

      await expect(client.getTasks()).rejects.toBeInstanceOf(DaemonClientError);
    });

    it('maps connection refused error', async () => {
      const error = new Error('connect ECONNREFUSED');
      vi.mocked(TasksService.getTasks).mockRejectedValue(error);

      await expect(client.getTasks()).rejects.toMatchObject({
        code: 'connection_refused',
      });
    });

    it('maps socket not found error', async () => {
      const error = new Error('connect ENOENT /test.sock');
      vi.mocked(TasksService.getTasks).mockRejectedValue(error);

      await expect(client.getTasks()).rejects.toMatchObject({
        code: 'socket_not_found',
      });
    });

    it('maps timeout error', async () => {
      const error = new Error('connection timeout');
      vi.mocked(TasksService.getTasks).mockRejectedValue(error);

      await expect(client.getTasks()).rejects.toMatchObject({
        code: 'connection_timeout',
      });
    });

    it('maps unknown errors to request_failed', async () => {
      vi.mocked(TasksService.getTasks).mockRejectedValue(new Error('Unknown error'));

      await expect(client.getTasks()).rejects.toMatchObject({
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
