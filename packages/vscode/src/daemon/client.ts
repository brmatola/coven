/**
 * DaemonClient - High-level client for communicating with the Coven daemon.
 * 
 * This client wraps @coven/client-ts (which uses generated code from the API spec)
 * and provides a convenient interface for the extension.
 */

import { CovenClient, ApiError, HealthStatus, HealthService, StateService, TasksService, AgentsService, QuestionsService, WorkflowsService, WorkflowStatus } from '@coven/client-ts';
import type { CancelablePromise, StateResponse, TasksResponse, AgentsResponse, QuestionsResponse, AgentOutputResponse, Agent, Task, Question, ApproveMergeResponse, RejectMergeResponse } from '@coven/client-ts';
import type { AxiosError, AxiosResponse } from 'axios';
import { DaemonClientError } from './types';
import type { DaemonErrorCode } from './types';
import type { DaemonState } from './cache';

// Extension-specific types not in API spec
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptime: number;
  timestamp: number;
}

export interface StartSessionRequest {
  feature_branch?: string;
}

export interface WorkflowChangesResponse {
  workflow_id: string;
  task_id: string;
  base_branch: string;
  head_branch: string;
  worktree_path: string;
  files: Array<{
    path: string;
    lines_added: number;
    lines_deleted: number;
    change_type: 'added' | 'modified' | 'deleted' | 'renamed';
    old_path?: string;
  }>;
  total_lines_added: number;
  total_lines_deleted: number;
  commit_count: number;
}

export interface WorkflowReviewResponse {
  workflow_id: string;
  task_id: string;
  task_title: string;
  task_description: string;
  acceptance_criteria?: string;
  changes: WorkflowChangesResponse;
  step_outputs: Array<{
    step_id: string;
    step_name: string;
    summary: string;
    exit_code?: number;
  }>;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
}

/**
 * Client for communicating with the coven daemon over Unix socket.
 * Provides typed methods for all daemon API endpoints.
 * 
 * This client uses the generated client from @coven/client-ts internally,
 * ensuring it stays in sync with the API specification.
 */
export class DaemonClient {
  private readonly socketPath: string;
  private readonly client: CovenClient;

  /**
   * Create a new DaemonClient.
   * @param socketPath Path to the Unix socket (e.g., '.coven/covend.sock')
   */
  constructor(socketPath: string) {
    this.socketPath = socketPath;
    this.client = new CovenClient(socketPath);
  }

  // ============================================================================
  // Health API
  // ============================================================================

  /**
   * Check daemon health status.
   */
  async getHealth(): Promise<HealthResponse> {
    try {
      const healthResult: CancelablePromise<HealthStatus> = HealthService.getHealth();
      const health = await healthResult;
      let status: 'ok' | 'degraded' | 'error' = 'error';
      const healthStatusValue = health.status;
      if (healthStatusValue === HealthStatus.status.OK) {
        status = 'ok';
      } else if (healthStatusValue === HealthStatus.status.DEGRADED) {
        status = 'degraded';
      }
      return {
        status,
        version: health.version,
        uptime: health.uptime,
        timestamp: Date.now(),
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  // ============================================================================
  // State API
  // ============================================================================

  /**
   * Get current daemon state including workflow, tasks, agents, and questions.
   * Transforms the daemon's raw state format to the expected DaemonState interface.
   */
  async getState(): Promise<DaemonState> {
    try {
      const stateResult: CancelablePromise<StateResponse> = StateService.getState();
      const state = await stateResult;
      
      // Transform state response to DaemonState format
      const rawState = state.state;
      
      // Convert agents from object format to array if needed
      let agents: Agent[] = [];
      if (rawState?.agents) {
        if (Array.isArray(rawState.agents)) {
          agents = rawState.agents as unknown as Agent[];
        } else {
          // Object format: { taskId: Agent }
          agents = Object.entries(rawState.agents as Record<string, unknown>).map(([taskId, agent]) => ({
            ...(agent as Agent),
            taskId,
          }));
        }
      }

      // Ensure tasks is always an array
      const tasks = Array.isArray(rawState?.tasks) ? (rawState.tasks as unknown as Task[]) : [];

      return {
        workflow: {
          id: (rawState?.workflow && typeof rawState.workflow === 'object' && 'id' in rawState.workflow ? String(rawState.workflow.id) : '') || '',
          status: (rawState?.workflow && typeof rawState.workflow === 'object' && 'status' in rawState.workflow ? (rawState.workflow.status as WorkflowStatus) : undefined) || ('idle' as WorkflowStatus),
        },
        tasks,
        agents,
        questions: [], // Questions come from separate endpoint
        timestamp: state.timestamp ? new Date(state.timestamp).getTime() : Date.now(),
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  // ============================================================================
  // Session API
  // ============================================================================

  /**
   * Start a new session.
   * Note: Session endpoints may not be in the generated client yet
   */
  startSession(_options?: StartSessionRequest): Promise<void> {
    // TODO: Add session endpoints to API spec and use generated client
    return Promise.reject(new DaemonClientError('request_failed', 'Session API not yet in generated client'));
  }

  /**
   * Stop the current session.
   */
  stopSession(_force?: boolean): Promise<void> {
    // TODO: Add session endpoints to API spec and use generated client
    return Promise.reject(new DaemonClientError('request_failed', 'Session API not yet in generated client'));
  }

  // ============================================================================
  // Task API
  // ============================================================================

  /**
   * Get all tasks.
   */
  async getTasks(): Promise<Task[]> {
    try {
      const responseResult: CancelablePromise<TasksResponse> = TasksService.getTasks();
      const response = await responseResult;
      // Map generated Task type to Task
      return (response.tasks as unknown as Task[]) || [];
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Get a specific task by ID.
   */
  async getTask(id: string): Promise<Task> {
    // TODO: Add getTaskById to API spec if needed
    const tasks = await this.getTasks();
    const task = tasks.find(t => t.id === id);
    if (!task) {
      throw new DaemonClientError('task_not_found', `Task not found: ${id}`);
    }
    return task;
  }

  /**
   * Start a task (spawn an agent to work on it).
   */
  async startTask(id: string): Promise<void> {
    try {
      const result: CancelablePromise<unknown> = TasksService.startTask({ id });
      await result;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Kill an agent working on a task.
   */
  async killTask(id: string, _reason?: string): Promise<void> {
    try {
      const result: CancelablePromise<unknown> = TasksService.stopTask({ id });
      await result;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  // ============================================================================
  // Agent API
  // ============================================================================

  /**
   * Get all active agents.
   */
  async getAgents(): Promise<Agent[]> {
    try {
      const responseResult: CancelablePromise<AgentsResponse> = AgentsService.getAgents();
      const response = await responseResult;
      return (response.agents as unknown as Agent[]) || [];
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Get agent for a specific task.
   */
  async getAgent(taskId: string): Promise<Agent> {
    try {
      const agentResult: CancelablePromise<Agent> = AgentsService.getAgentById({ id: taskId });
      return await agentResult;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Get output from an agent.
   */
  async getAgentOutput(taskId: string, since?: number): Promise<AgentOutputResponse> {
    try {
      const responseResult: CancelablePromise<AgentOutputResponse> = AgentsService.getAgentOutput(
        since !== undefined ? { id: taskId, since } : { id: taskId }
      );
      return await responseResult;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  // ============================================================================
  // Question API
  // ============================================================================

  /**
   * Get all pending questions.
   */
  async getQuestions(): Promise<Question[]> {
    try {
      const responseResult: CancelablePromise<QuestionsResponse> = QuestionsService.getQuestions({});
      const response = await responseResult;
      return response.questions || [];
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Answer a pending question.
   */
  async answerQuestion(questionId: string, answer: string): Promise<void> {
    try {
      const result: CancelablePromise<unknown> = QuestionsService.createQuestionAnswer({
        id: questionId,
        requestBody: { answer },
      });
      await result;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  // ============================================================================
  // Workflow Review API
  // ============================================================================

  /**
   * Get workflow changes for review.
   */
  getWorkflowChanges(_workflowId: string): Promise<WorkflowChangesResponse> {
    // TODO: Map from generated client when available
    return Promise.reject(new DaemonClientError('request_failed', 'Workflow changes API not yet in generated client'));
  }

  /**
   * Get full workflow review data including changes and step outputs.
   */
  getWorkflowReview(_workflowId: string): Promise<WorkflowReviewResponse> {
    // TODO: Map from generated client when available
    return Promise.reject(new DaemonClientError('not_implemented', 'Workflow review API not yet in generated client'));
  }

  /**
   * Approve a workflow and merge changes.
   */
  async approveWorkflow(workflowId: string, feedback?: string): Promise<void> {
    try {
      const result: CancelablePromise<ApproveMergeResponse> = WorkflowsService.createWorkflowApproveMerge({
        id: workflowId,
        requestBody: feedback ? { feedback } : {},
      });
      await result;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Reject a workflow and discard changes.
   */
  async rejectWorkflow(workflowId: string, reason?: string): Promise<void> {
    try {
      const result: CancelablePromise<RejectMergeResponse> = WorkflowsService.updateWorkflowRejectMerge({
        id: workflowId,
        requestBody: reason ? { reason } : {},
      });
      await result;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Get file diff between workflow branches.
   * Returns the diff content as a string.
   */
  getWorkflowFileDiff(_workflowId: string, _filePath: string): Promise<string> {
    // TODO: Add to API spec if needed
    return Promise.reject(new DaemonClientError('request_failed', 'Workflow file diff API not yet in generated client'));
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Map errors from the generated client to DaemonClientError
   */
  private mapError(error: unknown): DaemonClientError {
    if (error instanceof DaemonClientError) {
      return error;
    }

    // Handle ApiError from generated client
    if (error instanceof ApiError) {
      let errorCode: DaemonErrorCode = 'request_failed';
      if (error.status === 404) {
        errorCode = 'request_failed'; // Could be more specific based on path
      } else if (error.status === 500) {
        errorCode = 'internal_error';
      }

      return new DaemonClientError(
        errorCode,
        error.message || `Request failed with status ${error.status}`
      );
    }

    // Handle Axios errors
    if (error && typeof error === 'object' && 'isAxiosError' in error) {
      const axiosError = error as AxiosError;
      if (axiosError.code === 'ECONNREFUSED') {
        return new DaemonClientError('connection_refused', 'Daemon connection refused');
      }
      if (axiosError.code === 'ENOENT') {
        return new DaemonClientError('socket_not_found', `Socket not found: ${this.socketPath}`);
      }
      if (axiosError.code === 'ETIMEDOUT' || (axiosError.message && axiosError.message.includes('timeout'))) {
        return new DaemonClientError('connection_timeout', 'Connection timed out');
      }
      return new DaemonClientError(
        'request_failed',
        axiosError.message || 'Request failed'
      );
    }

    // Handle generic Error objects
    if (error && typeof error === 'object' && error instanceof Error) {
      if (error.message.includes('ECONNREFUSED')) {
        return new DaemonClientError('connection_refused', 'Daemon connection refused');
      }
      if (error.message.includes('ENOENT') || error.message.includes('socket')) {
        return new DaemonClientError('socket_not_found', `Socket not found: ${this.socketPath}`);
      }
      if (error.message.includes('timeout')) {
        return new DaemonClientError('connection_timeout', 'Connection timed out');
      }
      return new DaemonClientError('request_failed', error.message);
    }

    return new DaemonClientError('request_failed', String(error));
  }

  // ============================================================================
  // Generic HTTP Methods (for endpoints not yet in generated client)
  // ============================================================================

  /**
   * Make a POST request to the daemon.
   * Use this for endpoints not yet in the generated client.
   */
  async post<T>(path: string, body?: unknown): Promise<T> {
    try {
      // Use axios instance directly for generic requests
      const axiosInstance = this.client.getAxiosInstance();
      const response: AxiosResponse<T> = await axiosInstance.post<T>(path, body);
      return response.data;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Make a GET request to the daemon.
   * Use this for endpoints not yet in the generated client.
   */
  async get<T>(path: string): Promise<T> {
    try {
      // Use axios instance directly for generic requests
      const axiosInstance = this.client.getAxiosInstance();
      const response: AxiosResponse<T> = await axiosInstance.get<T>(path);
      return response.data;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Make a DELETE request to the daemon.
   * Use this for endpoints not yet in the generated client.
   */
  async delete<T>(path: string): Promise<T> {
    try {
      // Use axios instance directly for generic requests
      const axiosInstance = this.client.getAxiosInstance();
      const response: AxiosResponse<T> = await axiosInstance.delete<T>(path);
      return response.data;
    } catch (error) {
      throw this.mapError(error);
    }
  }
}
