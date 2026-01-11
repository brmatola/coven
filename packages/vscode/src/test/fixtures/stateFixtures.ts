import type {
  DaemonState,
  Agent,
  Question,
  WorkflowDetailResponse,
  StepResult,
} from '@coven/client-ts';
import {
  WorkflowState,
  Task,
  AgentStatus,
  TaskStatus,
  HealthStatus,
  QuestionType,
  WorkflowStatus,
  StepInfo,
  StepStatus,
} from '@coven/client-ts';

// Local type aliases for clarity in tests
type TestTask = Task;

// Health response structure for tests
interface HealthResponse {
  status: HealthStatus.status;
  version: string;
  uptime: number;
  timestamp: number;
}

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
  status: HealthStatus.status.OK,
  version: '1.0.0',
  uptime: HOUR,
  timestamp: NOW,
};

/**
 * Degraded daemon response.
 */
export const degradedResponse: HealthResponse = {
  status: HealthStatus.status.DEGRADED,
  version: '1.0.0',
  uptime: HOUR,
  timestamp: NOW,
};

/**
 * Error daemon response.
 */
export const errorResponse: HealthResponse = {
  status: HealthStatus.status.ERROR,
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
  status: WorkflowState.status.IDLE,
};

/**
 * Running workflow.
 */
export const runningWorkflow: WorkflowState = {
  id: 'wf-running',
  status: WorkflowState.status.RUNNING,
  started_at: new Date(relativeTime(-5 * MINUTE)).toISOString(),
};

/**
 * Paused workflow.
 */
export const pausedWorkflow: WorkflowState = {
  id: 'wf-paused',
  status: WorkflowState.status.PAUSED,
  started_at: new Date(relativeTime(-10 * MINUTE)).toISOString(),
};

/**
 * Completed workflow.
 */
export const completedWorkflow: WorkflowState = {
  id: 'wf-completed',
  status: WorkflowState.status.COMPLETED,
  started_at: new Date(relativeTime(-15 * MINUTE)).toISOString(),
  completed_at: new Date(relativeTime(-5 * MINUTE)).toISOString(),
};

/**
 * Error workflow.
 */
export const errorWorkflow: WorkflowState = {
  id: 'wf-error',
  status: WorkflowState.status.ERROR,
  started_at: new Date(relativeTime(-10 * MINUTE)).toISOString(),
  completed_at: new Date(relativeTime(-5 * MINUTE)).toISOString(),
};

// ============================================================================
// Task Fixtures
// ============================================================================

/**
 * Create a task with customizable properties.
 */
export function createTask(overrides: Partial<TestTask> & { id: string }): TestTask {
  return {
    title: `Task ${overrides.id}`,
    description: `Description for ${overrides.id}`,
    status: TaskStatus.OPEN,
    priority: 2,
    type: Task.type.TASK,
    depends_on: [],
    created_at: new Date(relativeTime(-HOUR)).toISOString(),
    updated_at: new Date(relativeTime(-HOUR)).toISOString(),
    ...overrides,
  };
}

/**
 * Open task waiting to be started.
 */
export const pendingTask: TestTask = createTask({
  id: 'task-pending',
  title: 'Pending Task',
  description: 'This task is waiting to be started',
  status: TaskStatus.OPEN,
  priority: 1,
});

/**
 * Open task that can be started (alias for pendingTask in new model).
 */
export const readyTask: TestTask = createTask({
  id: 'task-ready',
  title: 'Ready Task',
  description: 'This task is ready to start',
  status: TaskStatus.OPEN,
  priority: 2,
});

/**
 * In-progress task with an active agent.
 */
export const runningTask: TestTask = createTask({
  id: 'task-running',
  title: 'Running Task',
  description: 'This task is currently being worked on',
  status: TaskStatus.IN_PROGRESS,
  priority: 1,
});

/**
 * Completed (closed) task.
 */
export const completedTask: TestTask = createTask({
  id: 'task-completed',
  title: 'Completed Task',
  description: 'This task has been completed',
  status: TaskStatus.CLOSED,
  priority: 2,
});

/**
 * Failed task (closed with implicit error).
 */
export const failedTask: TestTask = createTask({
  id: 'task-failed',
  title: 'Failed Task',
  description: 'This task failed',
  status: TaskStatus.CLOSED,
  priority: 1,
});

/**
 * Blocked task with dependencies.
 */
export const blockedTask: TestTask = createTask({
  id: 'task-blocked',
  title: 'Blocked Task',
  description: 'This task is blocked by dependencies',
  status: TaskStatus.BLOCKED,
  priority: 3,
  depends_on: ['task-pending', 'task-running'],
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
    task_id: taskId,
    pid: 12345,
    status,
    worktree: `/tmp/worktrees/${taskId}`,
    branch: `coven/${taskId}`,
    started_at: new Date(relativeTime(-5 * MINUTE)).toISOString(),
    ...overrides,
  };
}

/**
 * Starting agent (initializing).
 */
export const idleAgent: Agent = createAgent('task-idle', AgentStatus.STARTING);

/**
 * Running agent actively working.
 */
export const runningAgent: Agent = createAgent('task-running', AgentStatus.RUNNING, {
  pid: 12345,
});

/**
 * Running agent waiting for user input (still RUNNING status in new model).
 */
export const waitingAgent: Agent = createAgent('task-waiting', AgentStatus.RUNNING, {
  pid: 12346,
});

/**
 * Completed agent.
 */
export const completedAgent: Agent = createAgent('task-completed', AgentStatus.COMPLETED, {
  pid: 12347,
  ended_at: new Date(relativeTime(-2 * MINUTE)).toISOString(),
  exit_code: 0,
});

/**
 * Failed agent.
 */
export const failedAgent: Agent = createAgent('task-failed', AgentStatus.FAILED, {
  pid: 12348,
  ended_at: new Date(relativeTime(-2 * MINUTE)).toISOString(),
  exit_code: 1,
  error: 'Process exited with non-zero code',
});

/**
 * Killed agent.
 */
export const killedAgent: Agent = createAgent('task-killed', AgentStatus.KILLED, {
  pid: 12349,
  ended_at: new Date(relativeTime(-1 * MINUTE)).toISOString(),
  exit_code: -9,
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
    id: overrides.id,
    task_id: 'task-running',
    agent_id: 'agent-1',
    text: `Question ${overrides.id}?`,
    type: QuestionType.TEXT,
    asked_at: new Date(relativeTime(-MINUTE)).toISOString(),
    ...overrides,
  };
}

/**
 * Simple text question.
 */
export const textQuestion: Question = createQuestion({
  id: 'q-text',
  text: 'What should I name this file?',
  task_id: 'task-running',
  type: QuestionType.TEXT,
});

/**
 * Multiple choice question.
 */
export const multipleChoiceQuestion: Question = createQuestion({
  id: 'q-choice',
  text: 'Which approach should I use?',
  task_id: 'task-running',
  type: QuestionType.CHOICE,
  options: ['Option A', 'Option B', 'Option C'],
});

/**
 * Yes/no question.
 */
export const yesNoQuestion: Question = createQuestion({
  id: 'q-yesno',
  text: 'Should I proceed with this change?',
  task_id: 'task-running',
  type: QuestionType.YES_NO,
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
  agents: {},
};

/**
 * State with one active workflow and running agent.
 */
export const activeWorkflowState: DaemonState = {
  workflow: runningWorkflow,
  tasks: [readyTask, runningTask, pendingTask],
  agents: { 'task-running': runningAgent },
};

/**
 * State with pending questions requiring user input.
 */
export const pendingQuestionsState: DaemonState = {
  workflow: runningWorkflow,
  tasks: [runningTask],
  agents: { 'task-waiting': waitingAgent },
};

/**
 * State with a mix of task states.
 */
export const mixedState: DaemonState = {
  workflow: runningWorkflow,
  tasks: [readyTask, runningTask, blockedTask, completedTask, failedTask],
  agents: {
    'task-running': runningAgent,
    'task-completed': completedAgent,
    'task-failed': failedAgent,
  },
};

/**
 * State after workflow completion.
 */
export const completedState: DaemonState = {
  workflow: completedWorkflow,
  tasks: [completedTask],
  agents: { 'task-completed': completedAgent },
};

/**
 * State after workflow failure.
 */
export const failedState: DaemonState = {
  workflow: errorWorkflow,
  tasks: [failedTask],
  agents: { 'task-failed': failedAgent },
};

/**
 * State with many workflows for performance testing.
 * Creates 50 tasks in various states.
 */
export function createManyWorkflowsState(count: number = 50): DaemonState {
  const tasks: TestTask[] = [];
  const agents: Record<string, Agent> = {};

  for (let i = 0; i < count; i++) {
    const status =
      i % 5 === 0
        ? TaskStatus.IN_PROGRESS
        : i % 5 === 1
          ? TaskStatus.OPEN
          : i % 5 === 2
            ? TaskStatus.CLOSED
            : i % 5 === 3
              ? TaskStatus.BLOCKED
              : TaskStatus.OPEN;

    tasks.push(
      createTask({
        id: `task-${i}`,
        title: `Task ${i}`,
        status,
        priority: i % 4,
      })
    );

    if (status === TaskStatus.IN_PROGRESS) {
      agents[`task-${i}`] = createAgent(`task-${i}`, AgentStatus.RUNNING, { pid: 10000 + i });
    }
  }

  return {
    workflow: runningWorkflow,
    tasks,
    agents,
  };
}

// ============================================================================
// Workflow Review Fixtures
// ============================================================================

/**
 * Step results for completed workflow.
 */
export const completedStepResults: Record<string, StepResult> = {
  'step-1': { success: true, output: 'Analyzed codebase structure', duration: '5s' },
  'step-2': { success: true, output: 'Implemented feature X', duration: '30s' },
  'step-3': { success: true, output: 'All 15 tests passing', duration: '10s' },
};

/**
 * Step info for workflow.
 */
export const workflowSteps: StepInfo[] = [
  { id: 'step-1', name: 'analyze', type: StepInfo.type.AGENT, status: StepStatus.COMPLETED, depth: 0 },
  { id: 'step-2', name: 'implement', type: StepInfo.type.AGENT, status: StepStatus.COMPLETED, depth: 0 },
  { id: 'step-3', name: 'test', type: StepInfo.type.SCRIPT, status: StepStatus.COMPLETED, depth: 0 },
];

/**
 * Full workflow detail response.
 */
export const workflowDetail: WorkflowDetailResponse = {
  workflow_id: 'wf-completed',
  task_id: 'task-completed',
  grimoire_name: 'default',
  status: WorkflowStatus.COMPLETED,
  current_step: 3,
  worktree_path: '/repo/.coven/worktrees/task-completed',
  started_at: new Date(relativeTime(-15 * MINUTE)).toISOString(),
  updated_at: new Date(relativeTime(-5 * MINUTE)).toISOString(),
  steps: workflowSteps,
  completed_steps: completedStepResults,
  step_outputs: {
    'step-1': 'Analyzed codebase structure',
    'step-2': 'Implemented feature X',
    'step-3': 'All 15 tests passing',
  },
  merge_review: { summary: 'Changes look good' },
  available_actions: ['approve', 'reject'],
};
