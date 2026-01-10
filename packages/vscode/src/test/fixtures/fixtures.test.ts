import { describe, it, expect } from 'vitest';
import {
  // State fixtures
  healthyResponse,
  degradedResponse,
  errorResponse,
  idleWorkflow,
  runningWorkflow,
  pausedWorkflow,
  completedWorkflow,
  errorWorkflow,
  pendingTask,
  readyTask,
  runningTask,
  completedTask,
  failedTask,
  blockedTask,
  idleAgent,
  runningAgent,
  waitingAgent,
  completedAgent,
  failedAgent,
  killedAgent,
  textQuestion,
  multipleChoiceQuestion,
  yesNoQuestion,
  emptyState,
  activeWorkflowState,
  pendingQuestionsState,
  mixedState,
  completedState,
  failedState,
  workflowChanges,
  workflowReview,
  createTask,
  createAgent,
  createQuestion,
  createManyWorkflowsState,
  // Event fixtures
  workflowStartedEvent,
  workflowCompletedEvent,
  workflowFailedEvent,
  agentSpawnedEvent,
  agentOutputEvent,
  agentCompletedEvent,
  agentFailedEvent,
  questionAskedEvent,
  questionAnsweredEvent,
  heartbeatEvent,
  successfulTaskSequence,
  failedTaskSequence,
  taskWithQuestionSequence,
  completeWorkflowSequence,
  failedWorkflowSequence,
  createEvent,
  agentSpawned,
  agentOutput,
  agentOutputLines,
} from './index';

describe('State Fixtures', () => {
  describe('Health Fixtures', () => {
    it('healthyResponse has correct shape', () => {
      expect(healthyResponse).toMatchObject({
        status: 'ok',
        version: expect.any(String),
        uptime: expect.any(Number),
        timestamp: expect.any(Number),
      });
    });

    it('degradedResponse has degraded status', () => {
      expect(degradedResponse.status).toBe('degraded');
    });

    it('errorResponse has error status', () => {
      expect(errorResponse.status).toBe('error');
    });
  });

  describe('Workflow Fixtures', () => {
    it('idleWorkflow has idle status', () => {
      expect(idleWorkflow.status).toBe('idle');
      expect(idleWorkflow.startedAt).toBeUndefined();
    });

    it('runningWorkflow has running status and startedAt', () => {
      expect(runningWorkflow.status).toBe('running');
      expect(runningWorkflow.startedAt).toBeDefined();
    });

    it('pausedWorkflow has paused status', () => {
      expect(pausedWorkflow.status).toBe('paused');
    });

    it('completedWorkflow has completed status and completedAt', () => {
      expect(completedWorkflow.status).toBe('completed');
      expect(completedWorkflow.completedAt).toBeDefined();
    });

    it('errorWorkflow has error status', () => {
      expect(errorWorkflow.status).toBe('error');
    });
  });

  describe('Task Fixtures', () => {
    it('all task fixtures have required properties', () => {
      const tasks = [pendingTask, readyTask, runningTask, completedTask, failedTask, blockedTask];

      tasks.forEach((task) => {
        expect(task).toMatchObject({
          id: expect.any(String),
          title: expect.any(String),
          description: expect.any(String),
          status: expect.any(String),
          priority: expect.any(Number),
          dependencies: expect.any(Array),
          createdAt: expect.any(Number),
          updatedAt: expect.any(Number),
        });
      });
    });

    it('runningTask has assignedAgent', () => {
      expect(runningTask.assignedAgent).toBeDefined();
    });

    it('failedTask has error message', () => {
      expect(failedTask.error).toBeDefined();
    });

    it('blockedTask has dependencies', () => {
      expect(blockedTask.dependencies.length).toBeGreaterThan(0);
    });

    it('createTask generates task with overrides', () => {
      const task = createTask({
        id: 'custom-task',
        title: 'Custom Title',
        priority: 0,
      });

      expect(task.id).toBe('custom-task');
      expect(task.title).toBe('Custom Title');
      expect(task.priority).toBe(0);
      expect(task.status).toBe('pending'); // Default
    });
  });

  describe('Agent Fixtures', () => {
    it('runningAgent has pid', () => {
      expect(runningAgent.pid).toBeDefined();
      expect(runningAgent.status).toBe('running');
    });

    it('completedAgent has exitCode 0', () => {
      expect(completedAgent.exitCode).toBe(0);
      expect(completedAgent.status).toBe('complete');
    });

    it('failedAgent has non-zero exitCode and error', () => {
      expect(failedAgent.exitCode).not.toBe(0);
      expect(failedAgent.error).toBeDefined();
    });

    it('killedAgent has killed status', () => {
      expect(killedAgent.status).toBe('killed');
    });

    it('createAgent generates agent with custom status', () => {
      const agent = createAgent('task-custom', 'waiting', { pid: 99999 });

      expect(agent.taskId).toBe('task-custom');
      expect(agent.status).toBe('waiting');
      expect(agent.pid).toBe(99999);
    });
  });

  describe('Question Fixtures', () => {
    it('textQuestion has no options', () => {
      expect(textQuestion.options).toBeUndefined();
      expect(textQuestion.text).toBeDefined();
    });

    it('multipleChoiceQuestion has options', () => {
      expect(multipleChoiceQuestion.options).toBeDefined();
      expect(multipleChoiceQuestion.options!.length).toBeGreaterThan(2);
    });

    it('yesNoQuestion has Yes/No options', () => {
      expect(yesNoQuestion.options).toEqual(['Yes', 'No']);
    });

    it('createQuestion generates question with overrides', () => {
      const question = createQuestion({
        id: 'q-custom',
        text: 'Custom question?',
        options: ['A', 'B'],
      });

      expect(question.id).toBe('q-custom');
      expect(question.text).toBe('Custom question?');
      expect(question.options).toEqual(['A', 'B']);
    });
  });

  describe('Complete State Fixtures', () => {
    it('emptyState has no tasks, agents, or questions', () => {
      expect(emptyState.tasks).toHaveLength(0);
      expect(emptyState.agents).toHaveLength(0);
      expect(emptyState.questions).toHaveLength(0);
      expect(emptyState.workflow.status).toBe('idle');
    });

    it('activeWorkflowState has running workflow and agent', () => {
      expect(activeWorkflowState.workflow.status).toBe('running');
      expect(activeWorkflowState.agents.length).toBeGreaterThan(0);
      expect(activeWorkflowState.tasks.length).toBeGreaterThan(0);
    });

    it('pendingQuestionsState has questions', () => {
      expect(pendingQuestionsState.questions.length).toBeGreaterThan(0);
      expect(pendingQuestionsState.agents.some((a) => a.status === 'waiting')).toBe(true);
    });

    it('mixedState has various task states', () => {
      const statuses = new Set(mixedState.tasks.map((t) => t.status));
      expect(statuses.size).toBeGreaterThan(2);
    });

    it('completedState has completed workflow', () => {
      expect(completedState.workflow.status).toBe('completed');
    });

    it('failedState has error workflow', () => {
      expect(failedState.workflow.status).toBe('error');
    });

    it('createManyWorkflowsState generates large state', () => {
      const state = createManyWorkflowsState(100);

      expect(state.tasks).toHaveLength(100);
      expect(state.agents.length).toBeGreaterThan(0);
      expect(state.questions.length).toBeGreaterThan(0);
    });
  });

  describe('Workflow Review Fixtures', () => {
    it('workflowChanges has file changes', () => {
      expect(workflowChanges.files.length).toBeGreaterThan(0);
      expect(workflowChanges.totalLinesAdded).toBeGreaterThan(0);
    });

    it('workflowReview includes changes and step outputs', () => {
      expect(workflowReview.changes).toBeDefined();
      expect(workflowReview.stepOutputs.length).toBeGreaterThan(0);
    });
  });
});

describe('Event Fixtures', () => {
  describe('Workflow Events', () => {
    it('workflowStartedEvent has correct type', () => {
      expect(workflowStartedEvent.type).toBe('workflow.started');
      expect(workflowStartedEvent.data).toMatchObject({ id: expect.any(String) });
    });

    it('workflowCompletedEvent has correct type', () => {
      expect(workflowCompletedEvent.type).toBe('workflow.completed');
    });

    it('workflowFailedEvent has error', () => {
      expect(workflowFailedEvent.type).toBe('workflow.failed');
      expect(workflowFailedEvent.data).toMatchObject({ error: expect.any(String) });
    });
  });

  describe('Agent Events', () => {
    it('agentSpawnedEvent has taskId and pid', () => {
      expect(agentSpawnedEvent.type).toBe('agent.spawned');
      expect(agentSpawnedEvent.data).toMatchObject({
        taskId: expect.any(String),
        pid: expect.any(Number),
      });
    });

    it('agentOutputEvent has line', () => {
      expect(agentOutputEvent.type).toBe('agent.output');
      expect(agentOutputEvent.data).toMatchObject({ line: expect.any(String) });
    });

    it('agentCompletedEvent has exitCode', () => {
      expect(agentCompletedEvent.type).toBe('agent.completed');
      expect(agentCompletedEvent.data).toMatchObject({ exitCode: 0 });
    });

    it('agentFailedEvent has error', () => {
      expect(agentFailedEvent.type).toBe('agent.failed');
      expect(agentFailedEvent.data).toMatchObject({ error: expect.any(String) });
    });
  });

  describe('Question Events', () => {
    it('questionAskedEvent has question text', () => {
      expect(questionAskedEvent.type).toBe('questions.asked');
      expect(questionAskedEvent.data).toMatchObject({ text: expect.any(String) });
    });

    it('questionAnsweredEvent has answer', () => {
      expect(questionAnsweredEvent.type).toBe('questions.answered');
      expect(questionAnsweredEvent.data).toMatchObject({ answer: expect.any(String) });
    });
  });

  describe('Other Events', () => {
    it('heartbeatEvent has heartbeat type', () => {
      expect(heartbeatEvent.type).toBe('heartbeat');
    });
  });

  describe('Event Factory Functions', () => {
    it('createEvent creates event with type and data', () => {
      const event = createEvent('workflow.started', { id: 'test' });

      expect(event.type).toBe('workflow.started');
      expect(event.data).toEqual({ id: 'test' });
      expect(event.timestamp).toBeDefined();
    });

    it('agentSpawned creates spawn event', () => {
      const event = agentSpawned('task-test', 12345);

      expect(event.type).toBe('agent.spawned');
      expect(event.data).toMatchObject({ taskId: 'task-test', pid: 12345 });
    });

    it('agentOutput creates output event', () => {
      const event = agentOutput('task-test', 'Output line');

      expect(event.type).toBe('agent.output');
      expect(event.data).toMatchObject({ taskId: 'task-test', line: 'Output line' });
    });

    it('agentOutputLines creates multiple output events', () => {
      const events = agentOutputLines('task-test', ['Line 1', 'Line 2']);

      expect(events).toHaveLength(2);
      expect(events[0].data).toMatchObject({ line: 'Line 1' });
      expect(events[1].data).toMatchObject({ line: 'Line 2' });
    });
  });

  describe('Event Sequences', () => {
    it('successfulTaskSequence creates complete sequence', () => {
      const events = successfulTaskSequence('task-1', ['Output 1', 'Output 2']);

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('agent.spawned');
      expect(events[events.length - 1].type).toBe('task.completed');
    });

    it('failedTaskSequence includes error', () => {
      const events = failedTaskSequence('task-1', 'Error message');

      const failedEvent = events.find((e) => e.type === 'agent.failed');
      expect(failedEvent).toBeDefined();
      expect(failedEvent!.data).toMatchObject({ error: 'Error message' });
    });

    it('taskWithQuestionSequence includes question flow', () => {
      const events = taskWithQuestionSequence('task-1', 'q-1', 'Question?', 'Answer');

      const askedEvent = events.find((e) => e.type === 'questions.asked');
      const answeredEvent = events.find((e) => e.type === 'questions.answered');

      expect(askedEvent).toBeDefined();
      expect(answeredEvent).toBeDefined();
    });

    it('completeWorkflowSequence includes all tasks', () => {
      const events = completeWorkflowSequence('wf-1', [
        { id: 'task-1', outputLines: ['Line 1'] },
        { id: 'task-2', outputLines: ['Line 2'] },
      ]);

      expect(events[0].type).toBe('workflow.started');
      expect(events[events.length - 1].type).toBe('workflow.completed');

      const spawnEvents = events.filter((e) => e.type === 'agent.spawned');
      expect(spawnEvents).toHaveLength(2);
    });

    it('failedWorkflowSequence ends with failure', () => {
      const events = failedWorkflowSequence('wf-1', 'task-1', 'Error');

      expect(events[0].type).toBe('workflow.started');
      expect(events[events.length - 1].type).toBe('workflow.failed');
    });
  });
});
