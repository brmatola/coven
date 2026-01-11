/**
 * Extension-specific error types for daemon communication.
 *
 * All API types should be imported directly from '@coven/client-ts'.
 */

/**
 * Error codes for daemon communication errors
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
  | 'internal_error'
  | 'not_implemented';

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
