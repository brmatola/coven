import type { SSEEvent, SSEEventType, DaemonState, Task } from '@coven/client-ts';
import { emptyState, runningWorkflow, runningTask, runningAgent } from './stateFixtures';

// ============================================================================
// Event Factory
// ============================================================================

/**
 * Create an SSE event with optional ID.
 */
export function createEvent<T>(type: SSEEventType, data: T, id?: string): SSEEvent {
  return {
    type,
    data,
    id,
    timestamp: Date.now(),
  };
}

/**
 * Create an SSE event with a specific timestamp.
 */
export function createEventAt<T>(
  type: SSEEventType,
  data: T,
  timestamp: number,
  id?: string
): SSEEvent {
  return {
    type,
    data,
    id,
    timestamp,
  };
}

// ============================================================================
// State Events
// ============================================================================

/**
 * State snapshot event with empty state.
 */
export const emptyStateSnapshot: SSEEvent = createEvent('state.snapshot', emptyState);

/**
 * State snapshot event with active workflow.
 */
export const activeStateSnapshot: SSEEvent = createEvent('state.snapshot', {
  ...emptyState,
  workflow: runningWorkflow,
  tasks: [runningTask],
  agents: { 'task-running': runningAgent },
});

/**
 * Create a state snapshot event with custom state.
 */
export function stateSnapshot(state: DaemonState): SSEEvent {
  return createEvent('state.snapshot', state);
}

// ============================================================================
// Workflow Events
// ============================================================================

export interface WorkflowEventData {
  id: string;
  error?: string;
}

/**
 * Workflow started event.
 */
export const workflowStartedEvent: SSEEvent = createEvent('workflow.started', {
  id: 'wf-1',
});

/**
 * Workflow completed event.
 */
export const workflowCompletedEvent: SSEEvent = createEvent('workflow.completed', {
  id: 'wf-1',
});

/**
 * Workflow failed event.
 */
export const workflowFailedEvent: SSEEvent = createEvent('workflow.failed', {
  id: 'wf-1',
  error: 'Workflow execution failed',
});

/**
 * Workflow paused event.
 */
export const workflowPausedEvent: SSEEvent = createEvent('workflow.paused', {
  id: 'wf-1',
});

/**
 * Workflow resumed event.
 */
export const workflowResumedEvent: SSEEvent = createEvent('workflow.resumed', {
  id: 'wf-1',
});

/**
 * Create workflow event with custom ID.
 */
export function workflowEvent(
  type: 'workflow.started' | 'workflow.completed' | 'workflow.failed' | 'workflow.paused' | 'workflow.resumed',
  workflowId: string,
  error?: string
): SSEEvent {
  return createEvent(type, { id: workflowId, error });
}

// ============================================================================
// Agent Events
// ============================================================================

export interface AgentEventData {
  task_id: string;
  pid?: number;
  exit_code?: number;
  error?: string;
  line?: string;
}

/**
 * Agent spawned event.
 */
export const agentSpawnedEvent: SSEEvent = createEvent('agent.spawned', {
  task_id: 'task-1',
  pid: 12345,
});

/**
 * Agent output event (single line).
 */
export const agentOutputEvent: SSEEvent = createEvent('agent.output', {
  task_id: 'task-1',
  line: 'Processing file src/index.ts...',
});

/**
 * Agent completed event.
 */
export const agentCompletedEvent: SSEEvent = createEvent('agent.completed', {
  task_id: 'task-1',
  exit_code: 0,
});

/**
 * Agent failed event.
 */
export const agentFailedEvent: SSEEvent = createEvent('agent.failed', {
  task_id: 'task-1',
  exit_code: 1,
  error: 'Agent process crashed',
});

/**
 * Agent killed event.
 */
export const agentKilledEvent: SSEEvent = createEvent('agent.killed', {
  task_id: 'task-1',
  exit_code: -9,
  error: 'Killed by user',
});

/**
 * Create agent spawned event.
 */
export function agentSpawned(taskId: string, pid?: number): SSEEvent {
  return createEvent('agent.spawned', { task_id: taskId, pid });
}

/**
 * Create agent output event.
 */
export function agentOutput(taskId: string, line: string): SSEEvent {
  return createEvent('agent.output', { task_id: taskId, line });
}

/**
 * Create multiple agent output events.
 */
export function agentOutputLines(taskId: string, lines: string[]): SSEEvent[] {
  return lines.map((line) => agentOutput(taskId, line));
}

/**
 * Create agent completed event.
 */
export function agentCompleted(taskId: string, exitCode: number = 0): SSEEvent {
  return createEvent('agent.completed', { task_id: taskId, exit_code: exitCode });
}

/**
 * Create agent failed event.
 */
export function agentFailed(taskId: string, error: string, exitCode: number = 1): SSEEvent {
  return createEvent('agent.failed', { task_id: taskId, error, exit_code: exitCode });
}

/**
 * Create agent killed event.
 */
export function agentKilled(taskId: string, reason?: string): SSEEvent {
  return createEvent('agent.killed', {
    task_id: taskId,
    exit_code: -9,
    error: reason ?? 'Killed by user',
  });
}

// ============================================================================
// Task Events
// ============================================================================

export interface TaskEventData {
  task_id: string;
  task?: Task;
  error?: string;
}

/**
 * Tasks updated event (bulk update).
 */
export const tasksUpdatedEvent: SSEEvent = createEvent('tasks.updated', {
  tasks: [runningTask],
});

/**
 * Task started event.
 */
export const taskStartedEvent: SSEEvent = createEvent('task.started', {
  task_id: 'task-1',
  task: runningTask,
});

/**
 * Task completed event.
 */
export const taskCompletedEvent: SSEEvent = createEvent('task.completed', {
  task_id: 'task-1',
});

/**
 * Task failed event.
 */
export const taskFailedEvent: SSEEvent = createEvent('task.failed', {
  task_id: 'task-1',
  error: 'Task execution failed',
});

/**
 * Create task event.
 */
export function taskEvent(
  type: 'task.started' | 'task.completed' | 'task.failed',
  taskId: string,
  extras?: { task?: Task; error?: string }
): SSEEvent {
  return createEvent(type, { task_id: taskId, ...extras });
}

/**
 * Create tasks updated event.
 */
export function tasksUpdated(tasks: Task[]): SSEEvent {
  return createEvent('tasks.updated', { tasks });
}

// ============================================================================
// Question Events
// ============================================================================

export interface QuestionEventData {
  id: string;
  task_id: string;
  agent_id?: string;
  text?: string;
  options?: string[];
  answer?: string;
}

/**
 * Question asked event.
 */
export const questionAskedEvent: SSEEvent = createEvent('questions.asked', {
  id: 'q-1',
  task_id: 'task-1',
  agent_id: 'agent-1',
  text: 'What should I do next?',
});

/**
 * Question answered event.
 */
export const questionAnsweredEvent: SSEEvent = createEvent('questions.answered', {
  id: 'q-1',
  task_id: 'task-1',
  answer: 'Proceed with option A',
});

/**
 * Create question asked event.
 */
export function questionAsked(
  questionId: string,
  taskId: string,
  text: string,
  options?: string[]
): SSEEvent {
  return createEvent('questions.asked', {
    id: questionId,
    task_id: taskId,
    text,
    options,
  });
}

/**
 * Create question answered event.
 */
export function questionAnswered(questionId: string, taskId: string, answer: string): SSEEvent {
  return createEvent('questions.answered', {
    id: questionId,
    task_id: taskId,
    answer,
  });
}

// ============================================================================
// Heartbeat Events
// ============================================================================

/**
 * Heartbeat event.
 */
export const heartbeatEvent: SSEEvent = createEvent('heartbeat', {});

/**
 * Create heartbeat event.
 */
export function heartbeat(): SSEEvent {
  return createEvent('heartbeat', {});
}

// ============================================================================
// Event Sequences
// ============================================================================

/**
 * Sequence of events for a successful task execution.
 */
export function successfulTaskSequence(taskId: string, outputLines: string[] = []): SSEEvent[] {
  const events: SSEEvent[] = [
    agentSpawned(taskId, 12345),
    ...outputLines.map((line) => agentOutput(taskId, line)),
    agentCompleted(taskId, 0),
    taskEvent('task.completed', taskId),
  ];
  return events;
}

/**
 * Sequence of events for a failed task execution.
 */
export function failedTaskSequence(taskId: string, error: string, outputLines: string[] = []): SSEEvent[] {
  const events: SSEEvent[] = [
    agentSpawned(taskId, 12345),
    ...outputLines.map((line) => agentOutput(taskId, line)),
    agentFailed(taskId, error),
    taskEvent('task.failed', taskId, { error }),
  ];
  return events;
}

/**
 * Sequence of events for a task with a question.
 */
export function taskWithQuestionSequence(
  taskId: string,
  questionId: string,
  questionText: string,
  answer: string
): SSEEvent[] {
  return [
    agentSpawned(taskId, 12345),
    agentOutput(taskId, 'Analyzing code...'),
    questionAsked(questionId, taskId, questionText),
    questionAnswered(questionId, taskId, answer),
    agentOutput(taskId, `Proceeding with: ${answer}`),
    agentCompleted(taskId, 0),
    taskEvent('task.completed', taskId),
  ];
}

/**
 * Sequence of events for a complete workflow.
 */
export function completeWorkflowSequence(
  workflowId: string,
  tasks: { id: string; outputLines?: string[] }[]
): SSEEvent[] {
  const events: SSEEvent[] = [workflowEvent('workflow.started', workflowId)];

  for (const task of tasks) {
    events.push(...successfulTaskSequence(task.id, task.outputLines));
  }

  events.push(workflowEvent('workflow.completed', workflowId));
  return events;
}

/**
 * Sequence of events for a failed workflow.
 */
export function failedWorkflowSequence(
  workflowId: string,
  failedTaskId: string,
  error: string
): SSEEvent[] {
  return [
    workflowEvent('workflow.started', workflowId),
    ...failedTaskSequence(failedTaskId, error),
    workflowEvent('workflow.failed', workflowId, error),
  ];
}
