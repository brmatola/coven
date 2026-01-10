/**
 * Types for daemon API requests and responses.
 * These mirror the Go daemon's API types.
 */

import { Task, Familiar, PendingQuestion, SessionConfig } from '../shared/types';

// ============================================================================
// Health API
// ============================================================================

/**
 * Response from GET /health
 */
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptime: number;
  timestamp: number;
}

// ============================================================================
// State API
// ============================================================================

/**
 * Workflow status values
 */
export type WorkflowStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';

/**
 * Agent status from daemon perspective
 */
export type AgentStatus = 'idle' | 'running' | 'waiting' | 'complete' | 'failed' | 'killed';

/**
 * Agent information from daemon
 */
export interface Agent {
  taskId: string;
  status: AgentStatus;
  pid?: number;
  startedAt?: number;
  completedAt?: number;
  exitCode?: number;
  error?: string;
}

/**
 * Current workflow state from daemon
 */
export interface WorkflowState {
  id: string;
  status: WorkflowStatus;
  startedAt?: number;
  completedAt?: number;
}

/**
 * Response from GET /state
 */
export interface DaemonState {
  workflow: WorkflowState;
  tasks: DaemonTask[];
  agents: Agent[];
  questions: Question[];
  timestamp: number;
}

/**
 * Task as represented by daemon
 */
export interface DaemonTask {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'ready' | 'running' | 'complete' | 'failed' | 'blocked';
  priority: number;
  dependencies: string[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  assignedAgent?: string;
  error?: string;
}

/**
 * Question pending user response
 */
export interface Question {
  id: string;
  taskId: string;
  agentId: string;
  text: string;
  options?: string[];
  askedAt: number;
}

// ============================================================================
// Session API
// ============================================================================

/**
 * Request for POST /session/start
 */
export interface StartSessionRequest {
  featureBranch?: string;
}

/**
 * Request for POST /session/stop
 */
export interface StopSessionRequest {
  force?: boolean;
}

// ============================================================================
// Task API
// ============================================================================

/**
 * Response from GET /tasks
 */
export type GetTasksResponse = DaemonTask[];

/**
 * Response from GET /tasks/:id
 */
export type GetTaskResponse = DaemonTask;

/**
 * Request for POST /tasks/:id/start
 */
export interface StartTaskRequest {
  taskId: string;
}

/**
 * Request for POST /tasks/:id/kill
 */
export interface KillTaskRequest {
  taskId: string;
  reason?: string;
}

// ============================================================================
// Question API
// ============================================================================

/**
 * Request for POST /questions/:id/answer
 */
export interface AnswerQuestionRequest {
  answer: string;
}

// ============================================================================
// Agent API
// ============================================================================

/**
 * Response from GET /agents
 */
export type GetAgentsResponse = Agent[];

/**
 * Response from GET /agents/:taskId
 */
export type GetAgentResponse = Agent;

/**
 * Response from GET /agents/:taskId/output
 */
export interface AgentOutputResponse {
  taskId: string;
  output: string[];
  totalLines: number;
}

// ============================================================================
// Workflow Review API
// ============================================================================

/**
 * A file changed in the workflow
 */
export interface WorkflowChangedFile {
  path: string;
  linesAdded: number;
  linesDeleted: number;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;
}

/**
 * Response from GET /workflows/:id/changes
 */
export interface WorkflowChangesResponse {
  workflowId: string;
  taskId: string;
  baseBranch: string;
  headBranch: string;
  worktreePath: string;
  files: WorkflowChangedFile[];
  totalLinesAdded: number;
  totalLinesDeleted: number;
  commitCount: number;
}

/**
 * Request for POST /workflows/:id/approve
 */
export interface ApproveWorkflowRequest {
  feedback?: string;
}

/**
 * Request for POST /workflows/:id/reject
 */
export interface RejectWorkflowRequest {
  reason?: string;
}

/**
 * Step output summary for review
 */
export interface StepOutputSummary {
  stepId: string;
  stepName: string;
  summary: string;
  exitCode?: number;
}

/**
 * Response from GET /workflows/:id/review
 */
export interface WorkflowReviewResponse {
  workflowId: string;
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  acceptanceCriteria?: string;
  changes: WorkflowChangesResponse;
  stepOutputs: StepOutputSummary[];
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error response from daemon API
 */
export interface DaemonError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Error codes returned by daemon
 */
export type DaemonErrorCode =
  | 'connection_refused'
  | 'connection_timeout'
  | 'socket_not_found'
  | 'request_failed'
  | 'parse_error'
  | 'task_not_found'
  | 'agent_not_found'
  | 'question_not_found'
  | 'workflow_not_found'
  | 'session_not_active'
  | 'session_already_active'
  | 'invalid_request'
  | 'internal_error';

/**
 * Custom error class for daemon communication errors
 */
export class DaemonClientError extends Error {
  constructor(
    public readonly code: DaemonErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DaemonClientError';
  }
}
