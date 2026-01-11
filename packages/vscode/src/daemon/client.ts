import * as http from 'http';
import {
  DaemonState,
  HealthResponse,
  DaemonTask,
  Agent,
  AgentOutputResponse,
  Question,
  StartSessionRequest,
  StopSessionRequest,
  AnswerQuestionRequest,
  ApproveWorkflowRequest,
  RejectWorkflowRequest,
  WorkflowChangesResponse,
  WorkflowReviewResponse,
  DaemonClientError,
  DaemonErrorCode,
} from './types';

/**
 * HTTP request options for Unix socket
 */
interface RequestOptions {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: unknown;
  timeout?: number;
}

/**
 * Default timeout for requests in milliseconds
 */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Client for communicating with the coven daemon over Unix socket.
 * Provides typed methods for all daemon API endpoints.
 */
export class DaemonClient {
  private readonly socketPath: string;

  /**
   * Create a new DaemonClient.
   * @param socketPath Path to the Unix socket (e.g., '.coven/covend.sock')
   */
  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  // ============================================================================
  // Core HTTP Methods
  // ============================================================================

  /**
   * Make a GET request to the daemon.
   */
  async get<T>(path: string): Promise<T> {
    return this.request<T>({ method: 'GET', path });
  }

  /**
   * Make a POST request to the daemon.
   */
  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: 'POST', path, body });
  }

  /**
   * Make a DELETE request to the daemon.
   */
  async delete<T>(path: string): Promise<T> {
    return this.request<T>({ method: 'DELETE', path });
  }

  // ============================================================================
  // Health API
  // ============================================================================

  /**
   * Check daemon health status.
   */
  async getHealth(): Promise<HealthResponse> {
    return this.get<HealthResponse>('/health');
  }

  // ============================================================================
  // State API
  // ============================================================================

  /**
   * Get current daemon state including workflow, tasks, agents, and questions.
   * Transforms the daemon's raw state format to the expected DaemonState interface.
   */
  async getState(): Promise<DaemonState> {
    // Raw response type from daemon (different structure than DaemonState)
    interface RawState {
      agents?: Record<string, Agent> | Agent[];
      tasks?: DaemonTask[];
      last_task_sync?: string;
    }
    interface RawResponse {
      state?: RawState;
      timestamp?: string;
    }

    const raw = await this.get<RawResponse>('/state');

    // Transform raw daemon response to expected DaemonState format
    // Handle case where 'state' is nested or at top level
    const rawState: RawState | undefined = raw?.state ?? (raw as unknown as RawState);

    // Convert agents from object format to array if needed
    let agents: Agent[] = [];
    if (rawState?.agents) {
      if (Array.isArray(rawState.agents)) {
        agents = rawState.agents;
      } else {
        // Object format: { taskId: Agent }
        agents = Object.entries(rawState.agents).map(([taskId, agent]) => ({
          ...agent,
          taskId,
        }));
      }
    }

    // Ensure tasks is always an array
    const tasks = Array.isArray(rawState?.tasks) ? rawState.tasks : [];

    return {
      workflow: {
        id: '',
        status: 'idle',
      },
      tasks,
      agents,
      questions: [],
      timestamp: raw?.timestamp ? new Date(raw.timestamp).getTime() : Date.now(),
    };
  }

  // ============================================================================
  // Session API
  // ============================================================================

  /**
   * Start a new session.
   */
  async startSession(options?: StartSessionRequest): Promise<void> {
    await this.post<void>('/session/start', options);
  }

  /**
   * Stop the current session.
   */
  async stopSession(force?: boolean): Promise<void> {
    const request: StopSessionRequest = force ? { force: true } : {};
    await this.post<void>('/session/stop', request);
  }

  // ============================================================================
  // Task API
  // ============================================================================

  /**
   * Get all tasks.
   */
  async getTasks(): Promise<DaemonTask[]> {
    return this.get<DaemonTask[]>('/tasks');
  }

  /**
   * Get a specific task by ID.
   */
  async getTask(id: string): Promise<DaemonTask> {
    return this.get<DaemonTask>(`/tasks/${encodeURIComponent(id)}`);
  }

  /**
   * Start a task (spawn an agent to work on it).
   */
  async startTask(id: string): Promise<void> {
    await this.post<void>(`/tasks/${encodeURIComponent(id)}/start`);
  }

  /**
   * Kill an agent working on a task.
   */
  async killTask(id: string, reason?: string): Promise<void> {
    await this.post<void>(`/tasks/${encodeURIComponent(id)}/kill`, reason ? { reason } : undefined);
  }

  // ============================================================================
  // Agent API
  // ============================================================================

  /**
   * Get all active agents.
   */
  async getAgents(): Promise<Agent[]> {
    return this.get<Agent[]>('/agents');
  }

  /**
   * Get agent for a specific task.
   */
  async getAgent(taskId: string): Promise<Agent> {
    return this.get<Agent>(`/agents/${encodeURIComponent(taskId)}`);
  }

  /**
   * Get output from an agent.
   */
  async getAgentOutput(taskId: string, lines?: number): Promise<AgentOutputResponse> {
    const query = lines !== undefined ? `?lines=${lines}` : '';
    return this.get<AgentOutputResponse>(`/agents/${encodeURIComponent(taskId)}/output${query}`);
  }

  // ============================================================================
  // Question API
  // ============================================================================

  /**
   * Get all pending questions.
   */
  async getQuestions(): Promise<Question[]> {
    return this.get<Question[]>('/questions');
  }

  /**
   * Answer a pending question.
   */
  async answerQuestion(questionId: string, answer: string): Promise<void> {
    const request: AnswerQuestionRequest = { answer };
    await this.post<void>(`/questions/${encodeURIComponent(questionId)}/answer`, request);
  }

  // ============================================================================
  // Workflow Review API
  // ============================================================================

  /**
   * Get workflow changes for review.
   */
  async getWorkflowChanges(workflowId: string): Promise<WorkflowChangesResponse> {
    return this.get<WorkflowChangesResponse>(
      `/workflows/${encodeURIComponent(workflowId)}/changes`
    );
  }

  /**
   * Get full workflow review data including changes and step outputs.
   */
  async getWorkflowReview(workflowId: string): Promise<WorkflowReviewResponse> {
    return this.get<WorkflowReviewResponse>(
      `/workflows/${encodeURIComponent(workflowId)}/review`
    );
  }

  /**
   * Approve a workflow and merge changes.
   */
  async approveWorkflow(workflowId: string, feedback?: string): Promise<void> {
    const request: ApproveWorkflowRequest = feedback ? { feedback } : {};
    await this.post<void>(
      `/workflows/${encodeURIComponent(workflowId)}/approve`,
      request
    );
  }

  /**
   * Reject a workflow and discard changes.
   */
  async rejectWorkflow(workflowId: string, reason?: string): Promise<void> {
    const request: RejectWorkflowRequest = reason ? { reason } : {};
    await this.post<void>(
      `/workflows/${encodeURIComponent(workflowId)}/reject`,
      request
    );
  }

  /**
   * Get file diff between workflow branches.
   * Returns the diff content as a string.
   */
  async getWorkflowFileDiff(workflowId: string, filePath: string): Promise<string> {
    const response = await this.get<{ diff: string }>(
      `/workflows/${encodeURIComponent(workflowId)}/diff/${encodeURIComponent(filePath)}`
    );
    return response.diff;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Make an HTTP request to the daemon over Unix socket.
   */
  private async request<T>(options: RequestOptions): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
      const bodyString = options.body !== undefined ? JSON.stringify(options.body) : undefined;

      const requestOptions: http.RequestOptions = {
        socketPath: this.socketPath,
        path: options.path,
        method: options.method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(bodyString !== undefined && { 'Content-Length': Buffer.byteLength(bodyString) }),
        },
        timeout,
      };

      const req = http.request(requestOptions, (res) => {
        let data = '';

        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });

        res.on('end', () => {
          if (res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300) {
            // Success
            if (data.length === 0) {
              // Empty response (void return)
              resolve(undefined as T);
              return;
            }

            try {
              const parsed = JSON.parse(data) as T;
              resolve(parsed);
            } catch {
              reject(
                new DaemonClientError(
                  'parse_error',
                  `Failed to parse response: ${data.substring(0, 100)}`
                )
              );
            }
          } else {
            // Error response
            let errorCode: DaemonErrorCode = 'request_failed';
            let errorMessage = `Request failed with status ${res.statusCode}`;

            if (res.statusCode === 404) {
              // Determine specific not found error
              if (options.path.startsWith('/tasks/')) {
                errorCode = 'task_not_found';
                errorMessage = 'Task not found';
              } else if (options.path.startsWith('/agents/')) {
                errorCode = 'agent_not_found';
                errorMessage = 'Agent not found';
              } else if (options.path.startsWith('/questions/')) {
                errorCode = 'question_not_found';
                errorMessage = 'Question not found';
              } else if (options.path.startsWith('/workflows/')) {
                errorCode = 'workflow_not_found';
                errorMessage = 'Workflow not found';
              }
            }

            // Try to parse error response
            if (data.length > 0) {
              try {
                const errorBody = JSON.parse(data) as { code?: string; message?: string };
                if (errorBody.message) {
                  errorMessage = errorBody.message;
                }
                if (errorBody.code) {
                  errorCode = errorBody.code as DaemonErrorCode;
                }
              } catch {
                // Ignore parse errors for error responses
              }
            }

            reject(new DaemonClientError(errorCode, errorMessage));
          }
        });
      });

      req.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ECONNREFUSED') {
          reject(new DaemonClientError('connection_refused', 'Daemon connection refused'));
        } else if (error.code === 'ENOENT') {
          reject(new DaemonClientError('socket_not_found', `Socket not found: ${this.socketPath}`));
        } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
          reject(new DaemonClientError('connection_timeout', 'Connection timed out'));
        } else {
          reject(
            new DaemonClientError('request_failed', `Request failed: ${error.message}`, {
              code: error.code,
            })
          );
        }
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new DaemonClientError('connection_timeout', 'Request timed out'));
      });

      if (bodyString !== undefined) {
        req.write(bodyString);
      }

      req.end();
    });
  }
}
