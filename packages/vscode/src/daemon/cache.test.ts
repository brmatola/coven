import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateCache, DaemonState, WorkflowState } from './cache';
import type { Task, Agent, Question, SSEEvent } from '@coven/client-ts';
import { WorkflowStatus, AgentStatus, TaskStatus, QuestionType, Task as TaskClass } from '@coven/client-ts';

// Helper to create a mock daemon state
function createMockState(overrides: Partial<DaemonState> = {}): DaemonState {
  return {
    workflow: {
      id: 'workflow-1',
      status: WorkflowStatus.IDLE,
    },
    tasks: [],
    agents: {},
    questions: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

// Helper to create a mock task
function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test Task',
    description: 'A test task',
    status: TaskStatus.OPEN,
    priority: 2,
    type: TaskClass.type.TASK,
    depends_on: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// Helper to create a mock agent
function createMockAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    task_id: 'task-1',
    status: AgentStatus.RUNNING,
    pid: 12345,
    worktree: '/tmp/worktrees/task-1',
    branch: 'coven/task-1',
    started_at: new Date().toISOString(),
    ...overrides,
  };
}

// Helper to create a mock question
function createMockQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'question-1',
    task_id: 'task-1',
    agent_id: 'agent-1',
    text: 'What is the answer?',
    type: QuestionType.TEXT,
    asked_at: new Date().toISOString(),
    ...overrides,
  };
}

// Helper to create an SSE event
function createSSEEvent(type: string, data: unknown): SSEEvent {
  return {
    type: type as SSEEvent['type'],
    data,
    timestamp: Date.now(),
  };
}

describe('StateCache', () => {
  let cache: StateCache;

  beforeEach(() => {
    cache = new StateCache();
  });

  describe('initial state', () => {
    it('returns empty state before initialization', () => {
      expect(cache.getWorkflow()).toBeNull();
      expect(cache.getTasks()).toEqual([]);
      expect(cache.getAgents()).toEqual([]);
      expect(cache.getQuestions()).toEqual([]);
      expect(cache.isInitialized()).toBe(false);
      expect(cache.getLastTimestamp()).toBe(0);
    });

    it('returns inactive session state before initialization', () => {
      const session = cache.getSessionState();
      expect(session.active).toBe(false);
      expect(session.workflowId).toBeUndefined();
      expect(session.workflowStatus).toBeUndefined();
    });
  });

  describe('handleSnapshot()', () => {
    it('populates all state from snapshot', () => {
      const task = createMockTask({ id: 'task-1' });
      const agent = createMockAgent({ task_id: 'task-1' });
      const question = createMockQuestion({ id: 'q-1' });
      const workflow: WorkflowState = { id: 'wf-1', status: WorkflowStatus.RUNNING };
      const timestamp = Date.now();

      const state = createMockState({
        workflow,
        tasks: [task],
        agents: { 'task-1': agent },
        questions: [question],
        timestamp,
      });

      cache.handleSnapshot(state);

      expect(cache.getWorkflow()).toEqual(workflow);
      expect(cache.getTasks()).toEqual([task]);
      expect(cache.getAgents()).toEqual([agent]);
      expect(cache.getQuestions()).toEqual([question]);
      expect(cache.isInitialized()).toBe(true);
      expect(cache.getLastTimestamp()).toBe(timestamp);
    });

    it('replaces existing state on subsequent snapshots', () => {
      const state1 = createMockState({
        tasks: [createMockTask({ id: 't-1' }), createMockTask({ id: 't-2' })],
      });
      const state2 = createMockState({
        tasks: [createMockTask({ id: 't-3' })],
      });

      cache.handleSnapshot(state1);
      expect(cache.getTasks()).toHaveLength(2);

      cache.handleSnapshot(state2);
      expect(cache.getTasks()).toHaveLength(1);
      expect(cache.getTask('t-1')).toBeUndefined();
      expect(cache.getTask('t-3')).toBeDefined();
    });

    it('emits change events for all collections', () => {
      const workflowHandler = vi.fn();
      const tasksHandler = vi.fn();
      const agentsHandler = vi.fn();
      const questionsHandler = vi.fn();
      const stateResetHandler = vi.fn();

      cache.on('workflows.changed', workflowHandler);
      cache.on('tasks.changed', tasksHandler);
      cache.on('agents.changed', agentsHandler);
      cache.on('questions.changed', questionsHandler);
      cache.on('state.reset', stateResetHandler);

      const state = createMockState({
        workflow: { id: 'wf-1', status: WorkflowStatus.RUNNING },
        tasks: [createMockTask()],
        agents: { 'task-1': createMockAgent() },
        questions: [createMockQuestion()],
      });

      cache.handleSnapshot(state);

      expect(workflowHandler).toHaveBeenCalledWith(state.workflow);
      expect(tasksHandler).toHaveBeenCalledWith([state.tasks[0]]);
      expect(agentsHandler).toHaveBeenCalledWith([Object.values(state.agents)[0]]);
      expect(questionsHandler).toHaveBeenCalledWith([state.questions[0]]);
      expect(stateResetHandler).toHaveBeenCalled();
    });
  });

  describe('getters', () => {
    beforeEach(() => {
      cache.handleSnapshot(
        createMockState({
          tasks: [
            createMockTask({ id: 't-1', title: 'Task 1' }),
            createMockTask({ id: 't-2', title: 'Task 2' }),
          ],
          agents: {
            't-1': createMockAgent({ task_id: 't-1' }),
            't-2': createMockAgent({ task_id: 't-2', status: AgentStatus.COMPLETED }),
          },
          questions: [
            createMockQuestion({ id: 'q-1', task_id: 't-1' }),
            createMockQuestion({ id: 'q-2', task_id: 't-2' }),
          ],
        })
      );
    });

    it('getTask returns specific task by ID', () => {
      const task = cache.getTask('t-1');
      expect(task?.title).toBe('Task 1');
    });

    it('getTask returns undefined for unknown ID', () => {
      expect(cache.getTask('unknown')).toBeUndefined();
    });

    it('getAgent returns specific agent by task ID', () => {
      const agent = cache.getAgent('t-2');
      expect(agent?.status).toBe(AgentStatus.COMPLETED);
    });

    it('getAgent returns undefined for unknown task ID', () => {
      expect(cache.getAgent('unknown')).toBeUndefined();
    });

    it('getQuestion returns specific question by ID', () => {
      const question = cache.getQuestion('q-1');
      expect(question?.task_id).toBe('t-1');
    });

    it('getQuestion returns undefined for unknown ID', () => {
      expect(cache.getQuestion('unknown')).toBeUndefined();
    });
  });

  describe('getSessionState()', () => {
    it('returns inactive when workflow is idle', () => {
      cache.handleSnapshot(
        createMockState({
          workflow: { id: 'wf-1', status: WorkflowStatus.IDLE },
        })
      );

      const session = cache.getSessionState();
      expect(session.active).toBe(false);
    });

    it('returns active with workflow info when running', () => {
      cache.handleSnapshot(
        createMockState({
          workflow: { id: 'wf-1', status: WorkflowStatus.RUNNING },
        })
      );

      const session = cache.getSessionState();
      expect(session.active).toBe(true);
      expect(session.workflowId).toBe('wf-1');
      expect(session.workflowStatus).toBe(WorkflowStatus.RUNNING);
    });

    it('returns active for paused workflow', () => {
      cache.handleSnapshot(
        createMockState({
          workflow: { id: 'wf-1', status: WorkflowStatus.PAUSED },
        })
      );

      expect(cache.getSessionState().active).toBe(true);
    });
  });

  describe('handleEvent() - workflow events', () => {
    beforeEach(() => {
      cache.handleSnapshot(createMockState());
    });

    it('handles workflow.started event', () => {
      const handler = vi.fn();
      cache.on('workflows.changed', handler);

      cache.handleEvent(createSSEEvent('workflow.started', { workflow_id: 'wf-2', started_at: '2025-01-01T00:00:00Z' }));

      const workflow = cache.getWorkflow();
      expect(workflow?.id).toBe('wf-2');
      expect(workflow?.status).toBe(WorkflowStatus.RUNNING);
      expect(workflow?.started_at).toBe('2025-01-01T00:00:00Z');
      expect(handler).toHaveBeenCalled();
    });

    it('handles workflow.completed event', () => {
      cache.handleEvent(createSSEEvent('workflow.started', { workflow_id: 'wf-1' }));
      cache.handleEvent(createSSEEvent('workflow.completed', { workflow_id: 'wf-1', completed_at: '2025-01-01T01:00:00Z' }));

      const workflow = cache.getWorkflow();
      expect(workflow?.status).toBe(WorkflowStatus.COMPLETED);
      expect(workflow?.completed_at).toBe('2025-01-01T01:00:00Z');
    });

    it('handles workflow.blocked event', () => {
      cache.handleEvent(createSSEEvent('workflow.blocked', { workflow_id: 'wf-1' }));

      expect(cache.getWorkflow()?.status).toBe(WorkflowStatus.BLOCKED);
    });

    it('handles workflow.merge_pending event', () => {
      cache.handleEvent(createSSEEvent('workflow.merge_pending', { workflow_id: 'wf-1' }));

      expect(cache.getWorkflow()?.status).toBe(WorkflowStatus.PENDING_MERGE);
    });

    it('handles workflow.cancelled event', () => {
      cache.handleEvent(createSSEEvent('workflow.cancelled', { workflow_id: 'wf-1' }));

      expect(cache.getWorkflow()?.status).toBe(WorkflowStatus.CANCELLED);
    });

    it('handles workflow event with id instead of workflow_id', () => {
      cache.handleEvent(createSSEEvent('workflow.started', { id: 'wf-alt' }));

      expect(cache.getWorkflow()?.id).toBe('wf-alt');
    });
  });

  describe('handleEvent() - agent events', () => {
    beforeEach(() => {
      cache.handleSnapshot(createMockState());
    });

    it('handles agent.started event', () => {
      const handler = vi.fn();
      cache.on('agents.changed', handler);

      cache.handleEvent(
        createSSEEvent('agent.started', { task_id: 'task-1', pid: 9999, started_at: '2025-01-01T00:00:00Z', worktree: '/tmp/wt', branch: 'coven/task-1' })
      );

      const agent = cache.getAgent('task-1');
      expect(agent?.status).toBe(AgentStatus.RUNNING);
      expect(agent?.pid).toBe(9999);
      expect(agent?.started_at).toBe('2025-01-01T00:00:00Z');
      expect(handler).toHaveBeenCalled();
    });

    it('handles agent.completed event', () => {
      cache.handleEvent(createSSEEvent('agent.started', { task_id: 'task-1', worktree: '/tmp', branch: 'test' }));
      cache.handleEvent(
        createSSEEvent('agent.completed', { task_id: 'task-1', exit_code: 0, ended_at: '2025-01-01T01:00:00Z' })
      );

      const agent = cache.getAgent('task-1');
      expect(agent?.status).toBe(AgentStatus.COMPLETED);
      expect(agent?.exit_code).toBe(0);
      expect(agent?.ended_at).toBe('2025-01-01T01:00:00Z');
    });

    it('handles agent.failed event', () => {
      cache.handleEvent(createSSEEvent('agent.started', { task_id: 'task-1', worktree: '/tmp', branch: 'test' }));
      cache.handleEvent(
        createSSEEvent('agent.failed', { task_id: 'task-1', exit_code: 1, error: 'Something broke' })
      );

      const agent = cache.getAgent('task-1');
      expect(agent?.status).toBe(AgentStatus.FAILED);
      expect(agent?.exit_code).toBe(1);
      expect(agent?.error).toBe('Something broke');
    });

    it('handles agent.killed event', () => {
      cache.handleEvent(createSSEEvent('agent.started', { task_id: 'task-1', worktree: '/tmp', branch: 'test' }));
      cache.handleEvent(createSSEEvent('agent.killed', { task_id: 'task-1' }));

      expect(cache.getAgent('task-1')?.status).toBe(AgentStatus.KILLED);
    });

    it('handles agent.output event without modifying agent state', () => {
      cache.handleEvent(createSSEEvent('agent.started', { task_id: 'task-1', worktree: '/tmp', branch: 'test' }));

      const handler = vi.fn();
      cache.on('agents.changed', handler);

      cache.handleEvent(createSSEEvent('agent.output', { task_id: 'task-1', output: 'hello' }));

      // Agent state unchanged
      expect(cache.getAgent('task-1')?.status).toBe(AgentStatus.RUNNING);
      // But change event still emitted to notify UI
      expect(handler).toHaveBeenCalled();
    });

    it('ignores agent events without task_id', () => {
      cache.handleEvent(createSSEEvent('agent.started', {}));

      expect(cache.getAgents()).toHaveLength(0);
    });
  });

  describe('handleEvent() - task events', () => {
    beforeEach(() => {
      cache.handleSnapshot(
        createMockState({
          tasks: [createMockTask({ id: 'task-1', status: TaskStatus.OPEN })],
        })
      );
    });

    it('handles tasks.updated event with full task list', () => {
      const handler = vi.fn();
      cache.on('tasks.changed', handler);

      const newTasks = [
        createMockTask({ id: 'task-2', title: 'New Task' }),
        createMockTask({ id: 'task-3', title: 'Another Task' }),
      ];

      cache.handleEvent(createSSEEvent('tasks.updated', { tasks: newTasks }));

      expect(cache.getTasks()).toHaveLength(2);
      expect(cache.getTask('task-1')).toBeUndefined();
      expect(cache.getTask('task-2')).toBeDefined();
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('handleEvent() - question events', () => {
    beforeEach(() => {
      cache.handleSnapshot(createMockState());
    });

    it('handles agent.question event', () => {
      const handler = vi.fn();
      cache.on('questions.changed', handler);

      const question = createMockQuestion({ id: 'q-new', text: 'What now?' });
      cache.handleEvent(createSSEEvent('agent.question', question));

      expect(cache.getQuestion('q-new')?.text).toBe('What now?');
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('handleEvent() - other events', () => {
    it('handles state.snapshot event by delegating to handleSnapshot', () => {
      const state = createMockState({
        tasks: [createMockTask({ id: 'snap-task' })],
      });

      cache.handleEvent(createSSEEvent('state.snapshot', state));

      expect(cache.getTask('snap-task')).toBeDefined();
    });

    it('ignores heartbeat events', () => {
      const handler = vi.fn();
      cache.on('workflows.changed', handler);
      cache.on('tasks.changed', handler);

      cache.handleEvent(createSSEEvent('heartbeat', {}));

      expect(handler).not.toHaveBeenCalled();
    });

    it('updates lastTimestamp on each event', () => {
      const before = cache.getLastTimestamp();

      cache.handleEvent({ type: 'heartbeat', data: {}, timestamp: 99999 });

      expect(cache.getLastTimestamp()).toBe(99999);
      expect(cache.getLastTimestamp()).not.toBe(before);
    });
  });

  describe('clear()', () => {
    it('clears all cached state', () => {
      cache.handleSnapshot(
        createMockState({
          workflow: { id: 'wf-1', status: WorkflowStatus.RUNNING },
          tasks: [createMockTask()],
          agents: { 'task-1': createMockAgent() },
          questions: [createMockQuestion()],
          timestamp: 12345,
        })
      );

      cache.clear();

      expect(cache.getWorkflow()).toBeNull();
      expect(cache.getTasks()).toEqual([]);
      expect(cache.getAgents()).toEqual([]);
      expect(cache.getQuestions()).toEqual([]);
      expect(cache.isInitialized()).toBe(false);
      expect(cache.getLastTimestamp()).toBe(0);
    });

    it('emits state.reset event', () => {
      const handler = vi.fn();
      cache.on('state.reset', handler);

      cache.clear();

      expect(handler).toHaveBeenCalled();
    });
  });
});
