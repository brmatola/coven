import { EventEmitter } from 'events';
import {
  DaemonState,
  DaemonTask,
  Agent,
  Question,
  WorkflowState,
  WorkflowStatus,
} from './types';
import { SSEEvent, SSEEventType } from './sse';

/**
 * Events emitted by StateCache
 */
export interface StateCacheEvents {
  'workflows.changed': (workflow: WorkflowState) => void;
  'tasks.changed': (tasks: DaemonTask[]) => void;
  'agents.changed': (agents: Agent[]) => void;
  'questions.changed': (questions: Question[]) => void;
  'state.reset': () => void;
}

/**
 * Session state for UI
 */
export interface SessionState {
  active: boolean;
  workflowId?: string;
  workflowStatus?: WorkflowStatus;
}

/**
 * Local state cache that provides synchronous access to daemon state.
 * Populated from initial state.snapshot event and kept updated via SSE events.
 */
export class StateCache extends EventEmitter {
  private workflow: WorkflowState | null = null;
  private tasksById: Map<string, DaemonTask> = new Map();
  private agentsByTaskId: Map<string, Agent> = new Map();
  private questionsById: Map<string, Question> = new Map();
  private lastTimestamp: number = 0;

  constructor() {
    super();
  }

  // ============================================================================
  // Synchronous Getters
  // ============================================================================

  /**
   * Get the current workflow state.
   */
  getWorkflow(): WorkflowState | null {
    return this.workflow;
  }

  /**
   * Get all cached tasks.
   */
  getTasks(): DaemonTask[] {
    return Array.from(this.tasksById.values());
  }

  /**
   * Get a specific task by ID.
   */
  getTask(id: string): DaemonTask | undefined {
    return this.tasksById.get(id);
  }

  /**
   * Get all cached agents.
   */
  getAgents(): Agent[] {
    return Array.from(this.agentsByTaskId.values());
  }

  /**
   * Get agent for a specific task.
   */
  getAgent(taskId: string): Agent | undefined {
    return this.agentsByTaskId.get(taskId);
  }

  /**
   * Get all pending questions.
   */
  getQuestions(): Question[] {
    return Array.from(this.questionsById.values());
  }

  /**
   * Get a specific question by ID.
   */
  getQuestion(id: string): Question | undefined {
    return this.questionsById.get(id);
  }

  /**
   * Get the current session state derived from workflow.
   */
  getSessionState(): SessionState {
    if (!this.workflow || this.workflow.status === 'idle') {
      return { active: false };
    }

    return {
      active: true,
      workflowId: this.workflow.id,
      workflowStatus: this.workflow.status,
    };
  }

  /**
   * Get the timestamp of the last state update.
   */
  getLastTimestamp(): number {
    return this.lastTimestamp;
  }

  /**
   * Check if the cache has been populated with initial state.
   */
  isInitialized(): boolean {
    return this.lastTimestamp > 0;
  }

  // ============================================================================
  // State Updates
  // ============================================================================

  /**
   * Handle a full state snapshot from the daemon.
   * Called when receiving state.snapshot event.
   */
  handleSnapshot(state: DaemonState): void {
    // Replace all cached state
    this.workflow = state.workflow ?? null;

    this.tasksById.clear();
    // Ensure tasks is an array (defensive against unexpected formats)
    const tasks = Array.isArray(state.tasks) ? state.tasks : [];
    for (const task of tasks) {
      if (task && task.id) {
        this.tasksById.set(task.id, task);
      }
    }

    // Daemon sends agents as object {taskId: Agent}, convert to array
    this.agentsByTaskId.clear();
    const agents = state.agents ?? {};
    if (Array.isArray(agents)) {
      for (const agent of agents) {
        this.agentsByTaskId.set(agent.taskId, agent);
      }
    } else {
      // Object format from daemon: {taskId: Agent}
      for (const [taskId, agent] of Object.entries(agents)) {
        const agentData = agent as Agent;
        this.agentsByTaskId.set(taskId, { ...agentData, taskId });
      }
    }

    this.questionsById.clear();
    // Ensure questions is an array (defensive against unexpected formats)
    const questions = Array.isArray(state.questions) ? state.questions : [];
    for (const question of questions) {
      if (question && question.id) {
        this.questionsById.set(question.id, question);
      }
    }

    this.lastTimestamp = state.timestamp ?? Date.now();

    // Emit change events for all collections
    this.emit('workflows.changed', this.workflow);
    this.emit('tasks.changed', this.getTasks());
    this.emit('agents.changed', this.getAgents());
    this.emit('questions.changed', this.getQuestions());
    this.emit('state.reset');
  }

  /**
   * Handle an incremental SSE event.
   * Updates the cache and emits appropriate change events.
   */
  handleEvent(event: SSEEvent): void {
    const eventType = event.type;
    let data = event.data as Record<string, unknown>;

    // Daemon wraps event data in {"type": "...", "data": {...}}
    // Unwrap if present
    if (data && typeof data === 'object' && 'data' in data) {
      data = data.data as Record<string, unknown>;
    }

    switch (eventType) {
      case 'state.snapshot':
        this.handleSnapshot(data as unknown as DaemonState);
        break;

      case 'workflow.started':
      case 'workflow.completed':
      case 'workflow.failed':
      case 'workflow.paused':
      case 'workflow.resumed':
        this.handleWorkflowEvent(eventType, data);
        break;

      case 'agent.spawned':
      case 'agent.output':
      case 'agent.completed':
      case 'agent.failed':
      case 'agent.killed':
        this.handleAgentEvent(eventType, data);
        break;

      case 'tasks.updated':
      case 'task.started':
      case 'task.completed':
      case 'task.failed':
        this.handleTaskEvent(eventType, data);
        break;

      case 'questions.asked':
      case 'questions.answered':
        this.handleQuestionEvent(eventType, data);
        break;

      case 'heartbeat':
        // Heartbeat events don't update state
        break;
    }

    this.lastTimestamp = event.timestamp;
  }

  /**
   * Clear all cached state.
   */
  clear(): void {
    this.workflow = null;
    this.tasksById.clear();
    this.agentsByTaskId.clear();
    this.questionsById.clear();
    this.lastTimestamp = 0;

    this.emit('state.reset');
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  private handleWorkflowEvent(
    eventType: SSEEventType,
    data: Record<string, unknown>
  ): void {
    const workflowId = data.workflowId as string | undefined;
    const id = workflowId ?? (data.id as string | undefined) ?? '';

    // Determine status from event type
    let status: WorkflowStatus;
    switch (eventType) {
      case 'workflow.started':
        status = 'running';
        break;
      case 'workflow.completed':
        status = 'completed';
        break;
      case 'workflow.failed':
        status = 'error';
        break;
      case 'workflow.paused':
        status = 'paused';
        break;
      case 'workflow.resumed':
        status = 'running';
        break;
      default:
        status = 'idle';
    }

    // Update or create workflow state
    const existingWorkflow = this.workflow;
    this.workflow = {
      id: id || existingWorkflow?.id || '',
      status,
      startedAt: (data.startedAt as number) ?? existingWorkflow?.startedAt,
      completedAt: (data.completedAt as number) ?? existingWorkflow?.completedAt,
    };

    this.emit('workflows.changed', this.workflow);
  }

  private handleAgentEvent(
    eventType: SSEEventType,
    data: Record<string, unknown>
  ): void {
    const taskId = data.taskId as string;
    if (!taskId) return;

    // For output events, we don't update agent state
    if (eventType === 'agent.output') {
      // Output events just signal new output is available
      // UI should fetch via getAgentOutput API
      this.emit('agents.changed', this.getAgents());
      return;
    }

    // Update or create agent
    const existingAgent = this.agentsByTaskId.get(taskId);
    let agent: Agent;

    switch (eventType) {
      case 'agent.spawned':
        agent = {
          taskId,
          status: 'running',
          pid: data.pid as number | undefined,
          startedAt: data.startedAt as number | undefined ?? Date.now(),
        };
        break;

      case 'agent.completed':
        agent = {
          ...existingAgent,
          taskId,
          status: 'complete',
          completedAt: data.completedAt as number | undefined ?? Date.now(),
          exitCode: data.exitCode as number | undefined ?? 0,
        };
        break;

      case 'agent.failed':
        agent = {
          ...existingAgent,
          taskId,
          status: 'failed',
          completedAt: data.completedAt as number | undefined ?? Date.now(),
          exitCode: data.exitCode as number | undefined,
          error: data.error as string | undefined,
        };
        break;

      case 'agent.killed':
        agent = {
          ...existingAgent,
          taskId,
          status: 'killed',
          completedAt: data.completedAt as number | undefined ?? Date.now(),
        };
        break;

      default:
        return;
    }

    this.agentsByTaskId.set(taskId, agent);
    this.emit('agents.changed', this.getAgents());
  }

  private handleTaskEvent(
    eventType: SSEEventType,
    data: Record<string, unknown>
  ): void {
    // For tasks.updated, we get a full task list
    if (eventType === 'tasks.updated') {
      const tasks = data.tasks as DaemonTask[] | undefined;
      if (tasks) {
        this.tasksById.clear();
        for (const task of tasks) {
          this.tasksById.set(task.id, task);
        }
      }
      this.emit('tasks.changed', this.getTasks());
      return;
    }

    // For individual task events, update the specific task
    const taskId = data.taskId as string | undefined ?? data.id as string | undefined;
    if (!taskId) return;

    const existingTask = this.tasksById.get(taskId);
    if (!existingTask) {
      // If we don't have the task, we need to fetch it
      // For now, just emit change to signal UI should refresh
      this.emit('tasks.changed', this.getTasks());
      return;
    }

    let updatedTask: DaemonTask;
    switch (eventType) {
      case 'task.started':
        updatedTask = {
          ...existingTask,
          status: 'running',
          startedAt: data.startedAt as number | undefined ?? Date.now(),
        };
        break;

      case 'task.completed':
        updatedTask = {
          ...existingTask,
          status: 'complete',
          completedAt: data.completedAt as number | undefined ?? Date.now(),
        };
        break;

      case 'task.failed':
        updatedTask = {
          ...existingTask,
          status: 'failed',
          completedAt: data.completedAt as number | undefined ?? Date.now(),
          error: data.error as string | undefined,
        };
        break;

      default:
        return;
    }

    this.tasksById.set(taskId, updatedTask);
    this.emit('tasks.changed', this.getTasks());
  }

  private handleQuestionEvent(
    eventType: SSEEventType,
    data: Record<string, unknown>
  ): void {
    if (eventType === 'questions.asked') {
      const question = data.question as Question | undefined ?? data as unknown as Question;
      if (question && question.id) {
        this.questionsById.set(question.id, question);
        this.emit('questions.changed', this.getQuestions());
      }
    } else if (eventType === 'questions.answered') {
      const questionId = data.questionId as string | undefined ?? data.id as string | undefined;
      if (questionId) {
        this.questionsById.delete(questionId);
        this.emit('questions.changed', this.getQuestions());
      }
    }
  }
}
