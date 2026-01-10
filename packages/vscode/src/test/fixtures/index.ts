/**
 * Test fixtures for daemon state and SSE events.
 *
 * State fixtures provide pre-built DaemonState objects for various scenarios:
 * - emptyState: No active work
 * - activeWorkflowState: Running workflow with agent
 * - pendingQuestionsState: Workflow waiting for user input
 * - mixedState: Various task/agent states
 * - completedState: After successful completion
 * - failedState: After failure
 *
 * Event fixtures provide pre-built SSE events and sequences:
 * - Individual events (workflowStartedEvent, agentOutputEvent, etc.)
 * - Factory functions (createEvent, agentSpawned, questionAsked, etc.)
 * - Event sequences (successfulTaskSequence, completeWorkflowSequence, etc.)
 *
 * @example
 * ```typescript
 * import { emptyState, runningTask, successfulTaskSequence } from './test/fixtures';
 *
 * // Use state fixtures
 * mock.setStateResponse(emptyState);
 *
 * // Use event sequences
 * const events = successfulTaskSequence('task-1', ['Line 1', 'Line 2']);
 * events.forEach(e => sseStream.emitEvent(e));
 * ```
 */

// State fixtures
export {
  // Helpers
  relativeTime,
  createTask,
  createAgent,
  createQuestion,
  createManyWorkflowsState,
  // Health
  healthyResponse,
  degradedResponse,
  errorResponse,
  // Workflows
  idleWorkflow,
  runningWorkflow,
  pausedWorkflow,
  completedWorkflow,
  errorWorkflow,
  // Tasks
  pendingTask,
  readyTask,
  runningTask,
  completedTask,
  failedTask,
  blockedTask,
  // Agents
  idleAgent,
  runningAgent,
  waitingAgent,
  completedAgent,
  failedAgent,
  killedAgent,
  // Questions
  textQuestion,
  multipleChoiceQuestion,
  yesNoQuestion,
  // Complete states
  emptyState,
  activeWorkflowState,
  pendingQuestionsState,
  mixedState,
  completedState,
  failedState,
  // Review
  workflowChanges,
  workflowReview,
} from './stateFixtures';

// Event fixtures
export {
  // Factory functions
  createEvent,
  createEventAt,
  // State events
  emptyStateSnapshot,
  activeStateSnapshot,
  stateSnapshot,
  // Workflow events
  workflowStartedEvent,
  workflowCompletedEvent,
  workflowFailedEvent,
  workflowPausedEvent,
  workflowResumedEvent,
  workflowEvent,
  // Agent events
  agentSpawnedEvent,
  agentOutputEvent,
  agentCompletedEvent,
  agentFailedEvent,
  agentKilledEvent,
  agentSpawned,
  agentOutput,
  agentOutputLines,
  agentCompleted,
  agentFailed,
  agentKilled,
  // Task events
  tasksUpdatedEvent,
  taskStartedEvent,
  taskCompletedEvent,
  taskFailedEvent,
  taskEvent,
  tasksUpdated,
  // Question events
  questionAskedEvent,
  questionAnsweredEvent,
  questionAsked,
  questionAnswered,
  // Heartbeat
  heartbeatEvent,
  heartbeat,
  // Sequences
  successfulTaskSequence,
  failedTaskSequence,
  taskWithQuestionSequence,
  completeWorkflowSequence,
  failedWorkflowSequence,
} from './eventFixtures';
