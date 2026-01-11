import { EventEmitter } from 'events';
import type {
  Agent,
  Task,
  Question,
  SSEEvent,
  SSEEventType,
} from '@coven/client-ts';
import { WorkflowStatus, AgentStatus } from '@coven/client-ts';

// Extension-specific aggregated state view
export interface WorkflowState {
  id: string;
  status: WorkflowStatus;
  started_at?: string;
  completed_at?: string;
}

export interface DaemonState {
  workflow: WorkflowState | null;
  tasks: Task[];
  agents: Record<string, Agent>;
  questions: Question[];
  timestamp: number;
}

/**
 * Events emitted by StateCache
 */
export interface StateCacheEvents {
  'workflows.changed': (workflow: WorkflowState) => void;
  'tasks.changed': (tasks: Task[]) => void;
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
  private tasksById: Map<string, Task> = new Map();
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
  getTasks(): Task[] {
    return Array.from(this.tasksById.values());
  }

  /**
   * Get a specific task by ID.
   */
  getTask(id: string): Task | undefined {
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
    if (!this.workflow || this.workflow.status === WorkflowStatus.IDLE) {
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

    // Daemon sends agents as object {task_id: Agent}
    this.agentsByTaskId.clear();
    const agents = state.agents ?? {};
    for (const [taskId, agent] of Object.entries(agents)) {
      this.agentsByTaskId.set(taskId, agent);
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
   *
   * Event types match the API spec:
   * - state.snapshot, heartbeat
   * - agent.started, agent.output, agent.completed, agent.failed, agent.killed, agent.question
   * - tasks.updated
   * - workflow.started, workflow.step.started, workflow.step.completed,
   *   workflow.blocked, workflow.merge_pending, workflow.completed, workflow.cancelled
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
      case 'workflow.step.started':
      case 'workflow.step.completed':
      case 'workflow.blocked':
      case 'workflow.merge_pending':
      case 'workflow.completed':
      case 'workflow.cancelled':
        this.handleWorkflowEvent(eventType, data);
        break;

      case 'agent.started':
      case 'agent.output':
      case 'agent.completed':
      case 'agent.failed':
      case 'agent.killed':
        this.handleAgentEvent(eventType, data);
        break;

      case 'agent.question':
        this.handleQuestionEvent(data);
        break;

      case 'tasks.updated':
        this.handleTasksUpdated(data);
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
    const workflowId = data.workflow_id as string | undefined;
    const id = workflowId ?? (data.id as string | undefined) ?? '';

    // Determine status from event type
    let status: WorkflowStatus;
    switch (eventType) {
      case 'workflow.started':
      case 'workflow.step.started':
        status = WorkflowStatus.RUNNING;
        break;
      case 'workflow.step.completed':
        // Step completed but workflow still running
        status = this.workflow?.status ?? WorkflowStatus.RUNNING;
        break;
      case 'workflow.completed':
        status = WorkflowStatus.COMPLETED;
        break;
      case 'workflow.blocked':
        status = WorkflowStatus.BLOCKED;
        break;
      case 'workflow.merge_pending':
        status = WorkflowStatus.PENDING_MERGE;
        break;
      case 'workflow.cancelled':
        status = WorkflowStatus.CANCELLED;
        break;
      default:
        status = WorkflowStatus.IDLE;
    }

    // Update or create workflow state
    const existingWorkflow = this.workflow;
    this.workflow = {
      id: id || existingWorkflow?.id || '',
      status,
      started_at: (data.started_at as string) ?? existingWorkflow?.started_at,
      completed_at: (data.completed_at as string) ?? existingWorkflow?.completed_at,
    };

    this.emit('workflows.changed', this.workflow);
  }

  private handleAgentEvent(
    eventType: SSEEventType,
    data: Record<string, unknown>
  ): void {
    const taskId = data.task_id as string;
    if (!taskId) return;

    // For output events, we don't update agent state
    if (eventType === 'agent.output') {
      // Output events just signal new output is available
      // UI should fetch via getAgentOutput API
      this.emit('agents.changed', this.getAgents());
      return;
    }

    // Get or create agent from data
    const agentData = data as unknown as Partial<Agent>;
    const existingAgent = this.agentsByTaskId.get(taskId);

    // Map event type to agent status
    let status: AgentStatus;
    switch (eventType) {
      case 'agent.started':
        status = AgentStatus.RUNNING;
        break;
      case 'agent.completed':
        status = AgentStatus.COMPLETED;
        break;
      case 'agent.failed':
        status = AgentStatus.FAILED;
        break;
      case 'agent.killed':
        status = AgentStatus.KILLED;
        break;
      default:
        return;
    }

    // Merge with existing or create new agent
    const agent: Agent = {
      task_id: taskId,
      pid: agentData.pid ?? existingAgent?.pid ?? 0,
      status,
      worktree: agentData.worktree ?? existingAgent?.worktree ?? '',
      branch: agentData.branch ?? existingAgent?.branch ?? '',
      started_at: agentData.started_at ?? existingAgent?.started_at ?? new Date().toISOString(),
      ended_at: agentData.ended_at ?? existingAgent?.ended_at,
      exit_code: agentData.exit_code ?? existingAgent?.exit_code,
      error: agentData.error ?? existingAgent?.error,
    };

    this.agentsByTaskId.set(taskId, agent);
    this.emit('agents.changed', this.getAgents());
  }

  private handleTasksUpdated(data: Record<string, unknown>): void {
    // tasks.updated event provides a full task list
    const tasks = (data.tasks ?? data) as Task[] | undefined;
    if (Array.isArray(tasks)) {
      this.tasksById.clear();
      for (const task of tasks) {
        if (task && task.id) {
          this.tasksById.set(task.id, task);
        }
      }
    }
    this.emit('tasks.changed', this.getTasks());
  }

  private handleQuestionEvent(data: Record<string, unknown>): void {
    // agent.question event contains the question data
    const question = data as unknown as Question;
    if (question && question.id) {
      this.questionsById.set(question.id, question);
      this.emit('questions.changed', this.getQuestions());
    }
  }
}
