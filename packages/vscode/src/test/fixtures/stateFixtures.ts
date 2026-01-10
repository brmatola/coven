import type {
  DaemonState,
  WorkflowState,
  DaemonTask,
  Agent,
  Question,
  AgentStatus,
  HealthResponse,
  WorkflowChangesResponse,
  WorkflowReviewResponse,
} from '../../daemon/types';

// ============================================================================
// Timestamp Helpers
// ============================================================================

const NOW = Date.now();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * Get a timestamp relative to "now" for consistent test data.
 */
export function relativeTime(offsetMs: number): number {
  return NOW + offsetMs;
}

// ============================================================================
// Health Fixtures
// ============================================================================

/**
 * Healthy daemon response.
 */
export const healthyResponse: HealthResponse = {
  status: 'ok',
  version: '1.0.0',
  uptime: HOUR,
  timestamp: NOW,
};

/**
 * Degraded daemon response.
 */
export const degradedResponse: HealthResponse = {
  status: 'degraded',
  version: '1.0.0',
  uptime: HOUR,
  timestamp: NOW,
};

/**
 * Error daemon response.
 */
export const errorResponse: HealthResponse = {
  status: 'error',
  version: '1.0.0',
  uptime: HOUR,
  timestamp: NOW,
};

// ============================================================================
// Workflow Fixtures
// ============================================================================

/**
 * Idle workflow (no active work).
 */
export const idleWorkflow: WorkflowState = {
  id: 'wf-idle',
  status: 'idle',
};

/**
 * Running workflow.
 */
export const runningWorkflow: WorkflowState = {
  id: 'wf-running',
  status: 'running',
  startedAt: relativeTime(-5 * MINUTE),
};

/**
 * Paused workflow.
 */
export const pausedWorkflow: WorkflowState = {
  id: 'wf-paused',
  status: 'paused',
  startedAt: relativeTime(-10 * MINUTE),
};

/**
 * Completed workflow.
 */
export const completedWorkflow: WorkflowState = {
  id: 'wf-completed',
  status: 'completed',
  startedAt: relativeTime(-15 * MINUTE),
  completedAt: relativeTime(-5 * MINUTE),
};

/**
 * Error workflow.
 */
export const errorWorkflow: WorkflowState = {
  id: 'wf-error',
  status: 'error',
  startedAt: relativeTime(-10 * MINUTE),
  completedAt: relativeTime(-5 * MINUTE),
};

// ============================================================================
// Task Fixtures
// ============================================================================

/**
 * Create a task with customizable properties.
 */
export function createTask(overrides: Partial<DaemonTask> & { id: string }): DaemonTask {
  return {
    title: `Task ${overrides.id}`,
    description: `Description for ${overrides.id}`,
    status: 'pending',
    priority: 2,
    dependencies: [],
    createdAt: relativeTime(-HOUR),
    updatedAt: relativeTime(-HOUR),
    ...overrides,
  };
}

/**
 * Pending task waiting to be started.
 */
export const pendingTask: DaemonTask = createTask({
  id: 'task-pending',
  title: 'Pending Task',
  description: 'This task is waiting to be started',
  status: 'pending',
  priority: 1,
});

/**
 * Ready task that can be started.
 */
export const readyTask: DaemonTask = createTask({
  id: 'task-ready',
  title: 'Ready Task',
  description: 'This task is ready to start',
  status: 'ready',
  priority: 2,
});

/**
 * Running task with an active agent.
 */
export const runningTask: DaemonTask = createTask({
  id: 'task-running',
  title: 'Running Task',
  description: 'This task is currently being worked on',
  status: 'running',
  priority: 1,
  startedAt: relativeTime(-5 * MINUTE),
  assignedAgent: 'agent-1',
});

/**
 * Completed task.
 */
export const completedTask: DaemonTask = createTask({
  id: 'task-completed',
  title: 'Completed Task',
  description: 'This task has been completed',
  status: 'complete',
  priority: 2,
  startedAt: relativeTime(-15 * MINUTE),
  completedAt: relativeTime(-5 * MINUTE),
});

/**
 * Failed task.
 */
export const failedTask: DaemonTask = createTask({
  id: 'task-failed',
  title: 'Failed Task',
  description: 'This task failed',
  status: 'failed',
  priority: 1,
  startedAt: relativeTime(-10 * MINUTE),
  completedAt: relativeTime(-5 * MINUTE),
  error: 'Agent crashed unexpectedly',
});

/**
 * Blocked task with dependencies.
 */
export const blockedTask: DaemonTask = createTask({
  id: 'task-blocked',
  title: 'Blocked Task',
  description: 'This task is blocked by dependencies',
  status: 'blocked',
  priority: 3,
  dependencies: ['task-pending', 'task-running'],
});

// ============================================================================
// Agent Fixtures
// ============================================================================

/**
 * Create an agent with customizable properties.
 */
export function createAgent(
  taskId: string,
  status: AgentStatus,
  overrides?: Partial<Agent>
): Agent {
  return {
    taskId,
    status,
    startedAt: relativeTime(-5 * MINUTE),
    ...overrides,
  };
}

/**
 * Idle agent (not running).
 */
export const idleAgent: Agent = createAgent('task-idle', 'idle');

/**
 * Running agent actively working.
 */
export const runningAgent: Agent = createAgent('task-running', 'running', {
  pid: 12345,
});

/**
 * Waiting agent (waiting for user input).
 */
export const waitingAgent: Agent = createAgent('task-waiting', 'waiting', {
  pid: 12346,
});

/**
 * Completed agent.
 */
export const completedAgent: Agent = createAgent('task-completed', 'complete', {
  pid: 12347,
  completedAt: relativeTime(-2 * MINUTE),
  exitCode: 0,
});

/**
 * Failed agent.
 */
export const failedAgent: Agent = createAgent('task-failed', 'failed', {
  pid: 12348,
  completedAt: relativeTime(-2 * MINUTE),
  exitCode: 1,
  error: 'Process exited with non-zero code',
});

/**
 * Killed agent.
 */
export const killedAgent: Agent = createAgent('task-killed', 'killed', {
  pid: 12349,
  completedAt: relativeTime(-1 * MINUTE),
  exitCode: -9,
  error: 'Process was killed by user',
});

// ============================================================================
// Question Fixtures
// ============================================================================

/**
 * Create a question with customizable properties.
 */
export function createQuestion(overrides: Partial<Question> & { id: string }): Question {
  return {
    taskId: 'task-running',
    agentId: 'agent-1',
    text: `Question ${overrides.id}?`,
    askedAt: relativeTime(-MINUTE),
    ...overrides,
  };
}

/**
 * Simple text question.
 */
export const textQuestion: Question = createQuestion({
  id: 'q-text',
  text: 'What should I name this file?',
  taskId: 'task-running',
});

/**
 * Multiple choice question.
 */
export const multipleChoiceQuestion: Question = createQuestion({
  id: 'q-choice',
  text: 'Which approach should I use?',
  taskId: 'task-running',
  options: ['Option A', 'Option B', 'Option C'],
});

/**
 * Yes/no question.
 */
export const yesNoQuestion: Question = createQuestion({
  id: 'q-yesno',
  text: 'Should I proceed with this change?',
  taskId: 'task-running',
  options: ['Yes', 'No'],
});

// ============================================================================
// Complete State Fixtures
// ============================================================================

/**
 * Empty state with no active work.
 */
export const emptyState: DaemonState = {
  workflow: idleWorkflow,
  tasks: [],
  agents: [],
  questions: [],
  timestamp: NOW,
};

/**
 * State with one active workflow and running agent.
 */
export const activeWorkflowState: DaemonState = {
  workflow: runningWorkflow,
  tasks: [readyTask, runningTask, pendingTask],
  agents: [runningAgent],
  questions: [],
  timestamp: NOW,
};

/**
 * State with pending questions requiring user input.
 */
export const pendingQuestionsState: DaemonState = {
  workflow: runningWorkflow,
  tasks: [runningTask],
  agents: [waitingAgent],
  questions: [textQuestion, multipleChoiceQuestion],
  timestamp: NOW,
};

/**
 * State with a mix of task states.
 */
export const mixedState: DaemonState = {
  workflow: runningWorkflow,
  tasks: [readyTask, runningTask, blockedTask, completedTask, failedTask],
  agents: [runningAgent, completedAgent, failedAgent],
  questions: [textQuestion],
  timestamp: NOW,
};

/**
 * State after workflow completion.
 */
export const completedState: DaemonState = {
  workflow: completedWorkflow,
  tasks: [completedTask],
  agents: [completedAgent],
  questions: [],
  timestamp: NOW,
};

/**
 * State after workflow failure.
 */
export const failedState: DaemonState = {
  workflow: errorWorkflow,
  tasks: [failedTask],
  agents: [failedAgent],
  questions: [],
  timestamp: NOW,
};

/**
 * State with many workflows for performance testing.
 * Creates 50 tasks in various states.
 */
export function createManyWorkflowsState(count: number = 50): DaemonState {
  const tasks: DaemonTask[] = [];
  const agents: Agent[] = [];
  const questions: Question[] = [];

  for (let i = 0; i < count; i++) {
    const status =
      i % 5 === 0
        ? 'running'
        : i % 5 === 1
          ? 'ready'
          : i % 5 === 2
            ? 'complete'
            : i % 5 === 3
              ? 'failed'
              : 'pending';

    tasks.push(
      createTask({
        id: `task-${i}`,
        title: `Task ${i}`,
        status: status as DaemonTask['status'],
        priority: (i % 4) as 0 | 1 | 2 | 3,
      })
    );

    if (status === 'running') {
      agents.push(createAgent(`task-${i}`, 'running', { pid: 10000 + i }));
    }

    if (i % 10 === 0 && status === 'running') {
      questions.push(
        createQuestion({
          id: `q-${i}`,
          taskId: `task-${i}`,
          text: `Question for task ${i}?`,
        })
      );
    }
  }

  return {
    workflow: runningWorkflow,
    tasks,
    agents,
    questions,
    timestamp: NOW,
  };
}

// ============================================================================
// Workflow Review Fixtures
// ============================================================================

/**
 * Workflow changes with modified files.
 */
export const workflowChanges: WorkflowChangesResponse = {
  workflowId: 'wf-completed',
  taskId: 'task-completed',
  baseBranch: 'main',
  headBranch: 'coven/task-completed',
  worktreePath: '/repo/.coven/worktrees/task-completed',
  files: [
    { path: 'src/feature.ts', linesAdded: 45, linesDeleted: 12, changeType: 'modified' },
    { path: 'src/utils.ts', linesAdded: 20, linesDeleted: 0, changeType: 'added' },
    { path: 'src/old.ts', linesAdded: 0, linesDeleted: 35, changeType: 'deleted' },
    { path: 'src/renamed.ts', linesAdded: 5, linesDeleted: 5, changeType: 'renamed', oldPath: 'src/original.ts' },
  ],
  totalLinesAdded: 70,
  totalLinesDeleted: 52,
  commitCount: 3,
};

/**
 * Full workflow review data.
 */
export const workflowReview: WorkflowReviewResponse = {
  workflowId: 'wf-completed',
  taskId: 'task-completed',
  taskTitle: 'Implement feature X',
  taskDescription: 'Add new feature X to the codebase with tests',
  acceptanceCriteria: '- Feature X works\n- Tests pass\n- Documentation updated',
  changes: workflowChanges,
  stepOutputs: [
    { stepId: 'step-1', stepName: 'analyze', summary: 'Analyzed codebase structure', exitCode: 0 },
    { stepId: 'step-2', stepName: 'implement', summary: 'Implemented feature X', exitCode: 0 },
    { stepId: 'step-3', stepName: 'test', summary: 'All 15 tests passing', exitCode: 0 },
  ],
  startedAt: relativeTime(-15 * MINUTE),
  completedAt: relativeTime(-5 * MINUTE),
  durationMs: 10 * MINUTE,
};
