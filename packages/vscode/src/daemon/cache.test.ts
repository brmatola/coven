import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateCache } from './cache';
import type { DaemonState, DaemonTask, Agent, Question, WorkflowState } from './types';
import type { SSEEvent } from './sse';

// Helper to create a mock daemon state
function createMockState(overrides: Partial<DaemonState> = {}): DaemonState {
  return {
    workflow: {
      id: 'workflow-1',
      status: 'idle',
    },
    tasks: [],
    agents: [],
    questions: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

// Helper to create a mock task
function createMockTask(overrides: Partial<DaemonTask> = {}): DaemonTask {
  return {
    id: 'task-1',
    title: 'Test Task',
    description: 'A test task',
    status: 'pending',
    priority: 2,
    dependencies: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// Helper to create a mock agent
function createMockAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    taskId: 'task-1',
    status: 'running',
    pid: 12345,
    startedAt: Date.now(),
    ...overrides,
  };
}

// Helper to create a mock question
function createMockQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'question-1',
    taskId: 'task-1',
    agentId: 'agent-1',
    text: 'What is the answer?',
    askedAt: Date.now(),
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
      const agent = createMockAgent({ taskId: 'task-1' });
      const question = createMockQuestion({ id: 'q-1' });
      const workflow: WorkflowState = { id: 'wf-1', status: 'running' };
      const timestamp = Date.now();

      const state = createMockState({
        workflow,
        tasks: [task],
        agents: [agent],
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
        workflow: { id: 'wf-1', status: 'running' },
        tasks: [createMockTask()],
        agents: [createMockAgent()],
        questions: [createMockQuestion()],
      });

      cache.handleSnapshot(state);

      expect(workflowHandler).toHaveBeenCalledWith(state.workflow);
      expect(tasksHandler).toHaveBeenCalledWith([state.tasks[0]]);
      expect(agentsHandler).toHaveBeenCalledWith([state.agents[0]]);
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
          agents: [
            createMockAgent({ taskId: 't-1' }),
            createMockAgent({ taskId: 't-2', status: 'complete' }),
          ],
          questions: [
            createMockQuestion({ id: 'q-1', taskId: 't-1' }),
            createMockQuestion({ id: 'q-2', taskId: 't-2' }),
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
      expect(agent?.status).toBe('complete');
    });

    it('getAgent returns undefined for unknown task ID', () => {
      expect(cache.getAgent('unknown')).toBeUndefined();
    });

    it('getQuestion returns specific question by ID', () => {
      const question = cache.getQuestion('q-1');
      expect(question?.taskId).toBe('t-1');
    });

    it('getQuestion returns undefined for unknown ID', () => {
      expect(cache.getQuestion('unknown')).toBeUndefined();
    });
  });

  describe('getSessionState()', () => {
    it('returns inactive when workflow is idle', () => {
      cache.handleSnapshot(
        createMockState({
          workflow: { id: 'wf-1', status: 'idle' },
        })
      );

      const session = cache.getSessionState();
      expect(session.active).toBe(false);
    });

    it('returns active with workflow info when running', () => {
      cache.handleSnapshot(
        createMockState({
          workflow: { id: 'wf-1', status: 'running' },
        })
      );

      const session = cache.getSessionState();
      expect(session.active).toBe(true);
      expect(session.workflowId).toBe('wf-1');
      expect(session.workflowStatus).toBe('running');
    });

    it('returns active for paused workflow', () => {
      cache.handleSnapshot(
        createMockState({
          workflow: { id: 'wf-1', status: 'paused' },
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

      cache.handleEvent(createSSEEvent('workflow.started', { workflowId: 'wf-2', startedAt: 1234 }));

      const workflow = cache.getWorkflow();
      expect(workflow?.id).toBe('wf-2');
      expect(workflow?.status).toBe('running');
      expect(workflow?.startedAt).toBe(1234);
      expect(handler).toHaveBeenCalled();
    });

    it('handles workflow.completed event', () => {
      cache.handleEvent(createSSEEvent('workflow.started', { workflowId: 'wf-1' }));
      cache.handleEvent(createSSEEvent('workflow.completed', { workflowId: 'wf-1', completedAt: 5678 }));

      const workflow = cache.getWorkflow();
      expect(workflow?.status).toBe('completed');
      expect(workflow?.completedAt).toBe(5678);
    });

    it('handles workflow.failed event', () => {
      cache.handleEvent(createSSEEvent('workflow.failed', { workflowId: 'wf-1' }));

      expect(cache.getWorkflow()?.status).toBe('error');
    });

    it('handles workflow.paused event', () => {
      cache.handleEvent(createSSEEvent('workflow.paused', { workflowId: 'wf-1' }));

      expect(cache.getWorkflow()?.status).toBe('paused');
    });

    it('handles workflow.resumed event', () => {
      cache.handleEvent(createSSEEvent('workflow.paused', { workflowId: 'wf-1' }));
      cache.handleEvent(createSSEEvent('workflow.resumed', { workflowId: 'wf-1' }));

      expect(cache.getWorkflow()?.status).toBe('running');
    });

    it('handles workflow event with id instead of workflowId', () => {
      cache.handleEvent(createSSEEvent('workflow.started', { id: 'wf-alt' }));

      expect(cache.getWorkflow()?.id).toBe('wf-alt');
    });
  });

  describe('handleEvent() - agent events', () => {
    beforeEach(() => {
      cache.handleSnapshot(createMockState());
    });

    it('handles agent.spawned event', () => {
      const handler = vi.fn();
      cache.on('agents.changed', handler);

      cache.handleEvent(
        createSSEEvent('agent.spawned', { taskId: 'task-1', pid: 9999, startedAt: 1000 })
      );

      const agent = cache.getAgent('task-1');
      expect(agent?.status).toBe('running');
      expect(agent?.pid).toBe(9999);
      expect(agent?.startedAt).toBe(1000);
      expect(handler).toHaveBeenCalled();
    });

    it('handles agent.completed event', () => {
      cache.handleEvent(createSSEEvent('agent.spawned', { taskId: 'task-1' }));
      cache.handleEvent(
        createSSEEvent('agent.completed', { taskId: 'task-1', exitCode: 0, completedAt: 2000 })
      );

      const agent = cache.getAgent('task-1');
      expect(agent?.status).toBe('complete');
      expect(agent?.exitCode).toBe(0);
      expect(agent?.completedAt).toBe(2000);
    });

    it('handles agent.failed event', () => {
      cache.handleEvent(createSSEEvent('agent.spawned', { taskId: 'task-1' }));
      cache.handleEvent(
        createSSEEvent('agent.failed', { taskId: 'task-1', exitCode: 1, error: 'Something broke' })
      );

      const agent = cache.getAgent('task-1');
      expect(agent?.status).toBe('failed');
      expect(agent?.exitCode).toBe(1);
      expect(agent?.error).toBe('Something broke');
    });

    it('handles agent.killed event', () => {
      cache.handleEvent(createSSEEvent('agent.spawned', { taskId: 'task-1' }));
      cache.handleEvent(createSSEEvent('agent.killed', { taskId: 'task-1' }));

      expect(cache.getAgent('task-1')?.status).toBe('killed');
    });

    it('handles agent.output event without modifying agent state', () => {
      cache.handleEvent(createSSEEvent('agent.spawned', { taskId: 'task-1' }));

      const handler = vi.fn();
      cache.on('agents.changed', handler);

      cache.handleEvent(createSSEEvent('agent.output', { taskId: 'task-1', output: 'hello' }));

      // Agent state unchanged
      expect(cache.getAgent('task-1')?.status).toBe('running');
      // But change event still emitted to notify UI
      expect(handler).toHaveBeenCalled();
    });

    it('ignores agent events without taskId', () => {
      cache.handleEvent(createSSEEvent('agent.spawned', {}));

      expect(cache.getAgents()).toHaveLength(0);
    });
  });

  describe('handleEvent() - task events', () => {
    beforeEach(() => {
      cache.handleSnapshot(
        createMockState({
          tasks: [createMockTask({ id: 'task-1', status: 'pending' })],
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

    it('handles task.started event', () => {
      cache.handleEvent(createSSEEvent('task.started', { taskId: 'task-1', startedAt: 5000 }));

      const task = cache.getTask('task-1');
      expect(task?.status).toBe('running');
      expect(task?.startedAt).toBe(5000);
    });

    it('handles task.completed event', () => {
      cache.handleEvent(createSSEEvent('task.completed', { taskId: 'task-1', completedAt: 6000 }));

      const task = cache.getTask('task-1');
      expect(task?.status).toBe('complete');
      expect(task?.completedAt).toBe(6000);
    });

    it('handles task.failed event', () => {
      cache.handleEvent(
        createSSEEvent('task.failed', { taskId: 'task-1', error: 'Task failed' })
      );

      const task = cache.getTask('task-1');
      expect(task?.status).toBe('failed');
      expect(task?.error).toBe('Task failed');
    });

    it('handles task event with id instead of taskId', () => {
      cache.handleEvent(createSSEEvent('task.started', { id: 'task-1' }));

      expect(cache.getTask('task-1')?.status).toBe('running');
    });

    it('emits change event for unknown task ID', () => {
      const handler = vi.fn();
      cache.on('tasks.changed', handler);

      cache.handleEvent(createSSEEvent('task.started', { taskId: 'unknown-task' }));

      // Should still emit to signal UI should refresh
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('handleEvent() - question events', () => {
    beforeEach(() => {
      cache.handleSnapshot(createMockState());
    });

    it('handles questions.asked event with nested question', () => {
      const handler = vi.fn();
      cache.on('questions.changed', handler);

      const question = createMockQuestion({ id: 'q-new', text: 'What now?' });
      cache.handleEvent(createSSEEvent('questions.asked', { question }));

      expect(cache.getQuestion('q-new')?.text).toBe('What now?');
      expect(handler).toHaveBeenCalled();
    });

    it('handles questions.asked event with flat data', () => {
      const question = createMockQuestion({ id: 'q-flat', text: 'Flat question' });
      cache.handleEvent(createSSEEvent('questions.asked', question));

      expect(cache.getQuestion('q-flat')?.text).toBe('Flat question');
    });

    it('handles questions.answered event with questionId', () => {
      const question = createMockQuestion({ id: 'q-1' });
      cache.handleSnapshot(createMockState({ questions: [question] }));

      const handler = vi.fn();
      cache.on('questions.changed', handler);

      cache.handleEvent(createSSEEvent('questions.answered', { questionId: 'q-1' }));

      expect(cache.getQuestion('q-1')).toBeUndefined();
      expect(handler).toHaveBeenCalled();
    });

    it('handles questions.answered event with id', () => {
      const question = createMockQuestion({ id: 'q-2' });
      cache.handleSnapshot(createMockState({ questions: [question] }));

      cache.handleEvent(createSSEEvent('questions.answered', { id: 'q-2' }));

      expect(cache.getQuestion('q-2')).toBeUndefined();
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
          workflow: { id: 'wf-1', status: 'running' },
          tasks: [createMockTask()],
          agents: [createMockAgent()],
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
