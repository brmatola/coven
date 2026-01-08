/**
 * Types for the review workflow module.
 */

import { WebviewMessage } from '../shared/webview/WebviewPanel';

/**
 * Status of a review.
 */
export type ReviewStatus = 'pending' | 'checking' | 'approved' | 'reverted';

/**
 * A file changed by the agent.
 */
export interface ChangedFile {
  /** File path relative to worktree root */
  path: string;
  /** Number of lines added */
  linesAdded: number;
  /** Number of lines deleted */
  linesDeleted: number;
  /** Change type */
  changeType: 'added' | 'modified' | 'deleted';
}

/**
 * Status of a pre-merge check.
 */
export type CheckStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

/**
 * Result of a pre-merge check.
 */
export interface CheckResult {
  /** Check command that was run */
  command: string;
  /** Check status */
  status: CheckStatus;
  /** Exit code if completed */
  exitCode?: number | undefined;
  /** Standard output */
  stdout?: string | undefined;
  /** Standard error */
  stderr?: string | undefined;
  /** Duration in milliseconds */
  durationMs?: number | undefined;
}

/**
 * State for the review panel webview.
 */
export interface ReviewState {
  /** Task ID being reviewed */
  taskId: string;
  /** Task title */
  title: string;
  /** Task description */
  description: string;
  /** Acceptance criteria if any */
  acceptanceCriteria?: string | undefined;
  /** Agent's summary of work done */
  agentSummary?: string | undefined;
  /** When the agent completed the task */
  completedAt?: number | undefined;
  /** Duration the agent worked on the task */
  durationMs?: number | undefined;
  /** Files changed by the agent */
  changedFiles: ChangedFile[];
  /** Total lines added */
  totalLinesAdded: number;
  /** Total lines deleted */
  totalLinesDeleted: number;
  /** Current review status */
  status: ReviewStatus;
  /** Pre-merge check results */
  checkResults: CheckResult[];
  /** Whether pre-merge checks are enabled */
  checksEnabled: boolean;
  /** Error message if any */
  error?: string | undefined;
}

/**
 * Messages from the review webview to the extension.
 */
export type ReviewMessageToExtension =
  | { type: 'viewDiff'; payload: { filePath: string } }
  | { type: 'viewAllChanges' }
  | { type: 'runChecks' }
  | { type: 'approve'; payload?: { feedback?: string } }
  | { type: 'revert'; payload?: { reason?: string } }
  | { type: 'refresh' }
  | { type: 'overrideChecks'; payload: { reason: string } };

/**
 * Messages from the extension to the review webview.
 */
export type ReviewMessageToWebview =
  | { type: 'state'; payload: ReviewState }
  | { type: 'checkProgress'; payload: { command: string; status: CheckStatus } }
  | { type: 'error'; payload: { message: string } };

/**
 * Guard to check if a message is a ReviewMessageToExtension.
 */
export function isReviewMessage(msg: WebviewMessage): msg is ReviewMessageToExtension {
  return ['viewDiff', 'viewAllChanges', 'runChecks', 'approve', 'revert', 'refresh', 'overrideChecks'].includes(msg.type);
}
