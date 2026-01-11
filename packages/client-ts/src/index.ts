/**
 * @coven/client-ts
 * 
 * TypeScript client for the Coven daemon API.
 * 
 * This package provides:
 * - Generated client code from the OpenAPI specification
 * - Unix socket adapter for daemon communication
 * - High-level client wrapper (CovenClient)
 */

export { CovenClient } from './client';
export { createUnixSocketAdapter, createUnixSocketAxiosInstance } from './unix-socket-adapter';
export { SSEClient, SSEError } from './sse';
export type {
  SSEEventType,
  SSEEvent,
  SSEConnectionState,
  SSEEventDataMap,
  SSEClientEventMap,
  WorkflowEventData,
  AgentOutputEventData,
  AgentFailedEventData,
} from './sse';

// Re-export everything from generated - includes services, types, classes
// Import and re-export explicitly to ensure everything is exported
// Re-export from generated - need to use relative paths from dist structure
// The generated code gets compiled to dist/generated
export {
  ApiError,
  CancelablePromise,
  CancelError,
  OpenAPI,
  AgentsService,
  EventsService,
  HealthService,
  QuestionsService,
  StateService,
  TasksService,
  VersionService,
  WorkflowsService,
} from '../generated/index';

// Re-export all model types from generated
export type {
  OpenAPIConfig,
  Agent,
  AgentId,
  AgentOutputLine,
  AgentOutputResponse,
  AgentsResponse,
  AnswerQuestionRequest,
  ApproveMergeRequest,
  DaemonState,
  ErrorResponse,
  MergeReview,
  Question,
  QuestionId,
  QuestionsResponse,
  RejectMergeRequest,
  StateResponse,
  StepResult,
  TaskId,
  TasksResponse,
  VersionInfo,
  WorkflowContext,
  WorkflowDetailResponse,
  WorkflowId,
  WorkflowListItem,
  WorkflowListResponse,
  WorkflowRetryRequest,
} from '../generated/index';

// Re-export enums and classes (can't use `export type` for these)
export {
  AgentStatus,
  AgentKillResponse,
  AgentRespondResponse,
  AnswerQuestionResponse,
  ApproveMergeResponse,
  HealthStatus,
  QuestionType,
  RejectMergeResponse,
  StepInfo,
  StepStatus,
  Task,
  TaskStartResponse,
  TaskStatus,
  TaskStopResponse,
  WorkflowCancelResponse,
  WorkflowRetryResponse,
  WorkflowState,
  WorkflowStatus,
} from '../generated/index';
