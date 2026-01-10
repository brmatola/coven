import { vi } from 'vitest';
import type {
  DaemonState,
  HealthResponse,
  DaemonTask,
  Agent,
  AgentOutputResponse,
  Question,
  WorkflowChangesResponse,
  WorkflowReviewResponse,
  StartSessionRequest,
  DaemonErrorCode,
} from '../../daemon/types';
import { DaemonClientError } from '../../daemon/types';

/**
 * Configuration for mock responses
 */
export interface MockResponseConfig<T> {
  response?: T;
  error?: DaemonClientError;
  delay?: number;
}

/**
 * Record of an API call made to the mock client
 */
export interface CallRecord {
  endpoint: string;
  method: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  timestamp: number;
}

/**
 * Mock DaemonClient for unit testing.
 * Simulates daemon API responses without actual socket communication.
 *
 * @example
 * ```typescript
 * const mock = new MockDaemonClient();
 *
 * // Configure a successful response
 * mock.setHealthResponse({ status: 'ok', version: '1.0.0', uptime: 1000, timestamp: Date.now() });
 *
 * // Configure an error
 * mock.setError('/tasks/nonexistent', new DaemonClientError('task_not_found', 'Task not found'));
 *
 * // Use in tests
 * const health = await mock.getHealth();
 * expect(health.status).toBe('ok');
 *
 * // Verify calls
 * mock.assertCalled('/health');
 * expect(mock.getCallHistory()).toHaveLength(1);
 * ```
 */
export class MockDaemonClient {
  private responses = new Map<string, MockResponseConfig<unknown>>();
  private callHistory: CallRecord[] = [];

  // Mock function wrappers for spy functionality
  getHealth = vi.fn(() => this.handleCall<HealthResponse>('GET', '/health'));
  getState = vi.fn(() => this.handleCall<DaemonState>('GET', '/state'));
  startSession = vi.fn((options?: StartSessionRequest) =>
    this.handleCall<void>('POST', '/session/start', options)
  );
  stopSession = vi.fn((force?: boolean) =>
    this.handleCall<void>('POST', '/session/stop', force ? { force: true } : {})
  );
  getTasks = vi.fn(() => this.handleCall<DaemonTask[]>('GET', '/tasks'));
  getTask = vi.fn((id: string) =>
    this.handleCall<DaemonTask>('GET', `/tasks/${encodeURIComponent(id)}`)
  );
  startTask = vi.fn((id: string) =>
    this.handleCall<void>('POST', `/tasks/${encodeURIComponent(id)}/start`)
  );
  killTask = vi.fn((id: string, reason?: string) =>
    this.handleCall<void>('POST', `/tasks/${encodeURIComponent(id)}/kill`, reason ? { reason } : undefined)
  );
  getAgents = vi.fn(() => this.handleCall<Agent[]>('GET', '/agents'));
  getAgent = vi.fn((taskId: string) =>
    this.handleCall<Agent>('GET', `/agents/${encodeURIComponent(taskId)}`)
  );
  getAgentOutput = vi.fn((taskId: string, lines?: number) => {
    const query = lines !== undefined ? `?lines=${lines}` : '';
    return this.handleCall<AgentOutputResponse>(
      'GET',
      `/agents/${encodeURIComponent(taskId)}/output${query}`
    );
  });
  getQuestions = vi.fn(() => this.handleCall<Question[]>('GET', '/questions'));
  answerQuestion = vi.fn((questionId: string, answer: string) =>
    this.handleCall<void>('POST', `/questions/${encodeURIComponent(questionId)}/answer`, { answer })
  );
  getWorkflowChanges = vi.fn((workflowId: string) =>
    this.handleCall<WorkflowChangesResponse>(
      'GET',
      `/workflows/${encodeURIComponent(workflowId)}/changes`
    )
  );
  getWorkflowReview = vi.fn((workflowId: string) =>
    this.handleCall<WorkflowReviewResponse>(
      'GET',
      `/workflows/${encodeURIComponent(workflowId)}/review`
    )
  );
  approveWorkflow = vi.fn((workflowId: string, feedback?: string) =>
    this.handleCall<void>(
      'POST',
      `/workflows/${encodeURIComponent(workflowId)}/approve`,
      feedback ? { feedback } : {}
    )
  );
  rejectWorkflow = vi.fn((workflowId: string, reason?: string) =>
    this.handleCall<void>(
      'POST',
      `/workflows/${encodeURIComponent(workflowId)}/reject`,
      reason ? { reason } : {}
    )
  );
  getWorkflowFileDiff = vi.fn((workflowId: string, filePath: string) =>
    this.handleCall<{ diff: string }>(
      'GET',
      `/workflows/${encodeURIComponent(workflowId)}/diff/${encodeURIComponent(filePath)}`
    ).then((r) => r.diff)
  );

  // ============================================================================
  // Response Configuration
  // ============================================================================

  /**
   * Set response for any endpoint.
   * @param endpoint The endpoint path (e.g., '/health', '/tasks/task-1')
   * @param response The response to return
   */
  setResponse<T>(endpoint: string, response: T): void {
    this.responses.set(endpoint, { response });
  }

  /**
   * Set error for any endpoint.
   * @param endpoint The endpoint path
   * @param error The error to throw
   */
  setError(endpoint: string, error: DaemonClientError): void {
    this.responses.set(endpoint, { error });
  }

  /**
   * Set response with delay for testing async behavior.
   * @param endpoint The endpoint path
   * @param response The response to return
   * @param delay Delay in milliseconds
   */
  setDelayedResponse<T>(endpoint: string, response: T, delay: number): void {
    this.responses.set(endpoint, { response, delay });
  }

  // ============================================================================
  // Convenience Methods for Common Responses
  // ============================================================================

  /**
   * Set health response.
   */
  setHealthResponse(health: HealthResponse): void {
    this.setResponse('/health', health);
  }

  /**
   * Set state response.
   */
  setStateResponse(state: DaemonState): void {
    this.setResponse('/state', state);
  }

  /**
   * Set tasks list response.
   */
  setTasksResponse(tasks: DaemonTask[]): void {
    this.setResponse('/tasks', tasks);
  }

  /**
   * Set single task response.
   */
  setTaskResponse(id: string, task: DaemonTask): void {
    this.setResponse(`/tasks/${encodeURIComponent(id)}`, task);
  }

  /**
   * Set agents list response.
   */
  setAgentsResponse(agents: Agent[]): void {
    this.setResponse('/agents', agents);
  }

  /**
   * Set single agent response.
   */
  setAgentResponse(taskId: string, agent: Agent): void {
    this.setResponse(`/agents/${encodeURIComponent(taskId)}`, agent);
  }

  /**
   * Set agent output response.
   */
  setAgentOutputResponse(taskId: string, output: AgentOutputResponse): void {
    this.setResponse(`/agents/${encodeURIComponent(taskId)}/output`, output);
  }

  /**
   * Set questions list response.
   */
  setQuestionsResponse(questions: Question[]): void {
    this.setResponse('/questions', questions);
  }

  /**
   * Set workflow changes response.
   */
  setWorkflowChangesResponse(workflowId: string, changes: WorkflowChangesResponse): void {
    this.setResponse(`/workflows/${encodeURIComponent(workflowId)}/changes`, changes);
  }

  /**
   * Set workflow review response.
   */
  setWorkflowReviewResponse(workflowId: string, review: WorkflowReviewResponse): void {
    this.setResponse(`/workflows/${encodeURIComponent(workflowId)}/review`, review);
  }

  // ============================================================================
  // Error Helpers
  // ============================================================================

  /**
   * Configure connection refused error for all endpoints.
   */
  setConnectionRefused(): void {
    const error = new DaemonClientError('connection_refused', 'Daemon connection refused');
    // Set as default response
    this.responses.set('*', { error });
  }

  /**
   * Configure socket not found error for all endpoints.
   */
  setSocketNotFound(): void {
    const error = new DaemonClientError('socket_not_found', 'Socket not found');
    this.responses.set('*', { error });
  }

  /**
   * Configure task not found error.
   */
  setTaskNotFound(id: string): void {
    this.setError(
      `/tasks/${encodeURIComponent(id)}`,
      new DaemonClientError('task_not_found', 'Task not found')
    );
  }

  /**
   * Configure agent not found error.
   */
  setAgentNotFound(taskId: string): void {
    this.setError(
      `/agents/${encodeURIComponent(taskId)}`,
      new DaemonClientError('agent_not_found', 'Agent not found')
    );
  }

  /**
   * Configure question not found error.
   */
  setQuestionNotFound(questionId: string): void {
    this.setError(
      `/questions/${encodeURIComponent(questionId)}/answer`,
      new DaemonClientError('question_not_found', 'Question not found')
    );
  }

  // ============================================================================
  // Call History & Assertions
  // ============================================================================

  /**
   * Get all calls made to the mock client.
   */
  getCallHistory(): CallRecord[] {
    return [...this.callHistory];
  }

  /**
   * Get calls to a specific endpoint.
   */
  getCallsTo(endpoint: string): CallRecord[] {
    return this.callHistory.filter((call) => call.endpoint === endpoint);
  }

  /**
   * Assert an endpoint was called.
   * @param endpoint The endpoint to check
   * @param times Expected number of times (optional)
   * @throws Error if assertion fails
   */
  assertCalled(endpoint: string, times?: number): void {
    const calls = this.getCallsTo(endpoint);
    if (times !== undefined) {
      if (calls.length !== times) {
        throw new Error(
          `Expected ${endpoint} to be called ${times} times, but was called ${calls.length} times`
        );
      }
    } else if (calls.length === 0) {
      throw new Error(`Expected ${endpoint} to be called, but it was not called`);
    }
  }

  /**
   * Assert an endpoint was not called.
   */
  assertNotCalled(endpoint: string): void {
    const calls = this.getCallsTo(endpoint);
    if (calls.length > 0) {
      throw new Error(`Expected ${endpoint} not to be called, but it was called ${calls.length} times`);
    }
  }

  /**
   * Clear call history.
   */
  clearHistory(): void {
    this.callHistory = [];
  }

  /**
   * Reset all mock state (responses and history).
   */
  reset(): void {
    this.responses.clear();
    this.callHistory = [];
    vi.clearAllMocks();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async handleCall<T>(method: 'GET' | 'POST' | 'DELETE', endpoint: string, body?: unknown): Promise<T> {
    // Record the call
    this.callHistory.push({
      endpoint,
      method,
      body,
      timestamp: Date.now(),
    });

    // Look for specific endpoint config first, then wildcard, then return undefined
    const config = this.responses.get(endpoint) ?? this.responses.get('*');

    if (config?.error) {
      if (config.delay) {
        await this.delay(config.delay);
      }
      throw config.error;
    }

    if (config?.delay) {
      await this.delay(config.delay);
    }

    return (config?.response as T) ?? (undefined as T);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a new MockDaemonClient with common defaults pre-configured.
 * Useful for tests that don't need to customize every response.
 */
export function createMockDaemonClient(): MockDaemonClient {
  const mock = new MockDaemonClient();

  // Set default healthy responses
  mock.setHealthResponse({
    status: 'ok',
    version: '1.0.0',
    uptime: 1000,
    timestamp: Date.now(),
  });

  mock.setStateResponse({
    workflow: { id: 'default', status: 'idle' },
    tasks: [],
    agents: [],
    questions: [],
    timestamp: Date.now(),
  });

  mock.setTasksResponse([]);
  mock.setAgentsResponse([]);
  mock.setQuestionsResponse([]);

  return mock;
}

/**
 * Type helper to get DaemonClient interface for mock.
 * Useful when typing function parameters that accept either real or mock client.
 */
export type DaemonClientInterface = Pick<
  MockDaemonClient,
  | 'getHealth'
  | 'getState'
  | 'startSession'
  | 'stopSession'
  | 'getTasks'
  | 'getTask'
  | 'startTask'
  | 'killTask'
  | 'getAgents'
  | 'getAgent'
  | 'getAgentOutput'
  | 'getQuestions'
  | 'answerQuestion'
  | 'getWorkflowChanges'
  | 'getWorkflowReview'
  | 'approveWorkflow'
  | 'rejectWorkflow'
  | 'getWorkflowFileDiff'
>;
