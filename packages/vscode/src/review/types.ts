/**
 * Types for the review workflow module.
 */

import { WebviewMessage } from '../shared/webview/WebviewPanel';
import {
  WorkflowChangedFile,
  StepOutputSummary,
} from '../daemon/types';

/**
 * Status of a review.
 */
export type ReviewStatus = 'pending' | 'checking' | 'approved' | 'reverted';

/**
 * A file changed by the agent.
 * Re-exported from daemon types for backward compatibility.
 */
export interface ChangedFile {
  /** File path relative to worktree root */
  path: string;
  /** Number of lines added */
  linesAdded: number;
  /** Number of lines deleted */
  linesDeleted: number;
  /** Change type */
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  /** Original path for renamed files */
  oldPath?: string;
}

/**
 * Convert daemon file to review file format
 */
export function toChangedFile(file: WorkflowChangedFile): ChangedFile {
  return {
    path: file.path,
    linesAdded: file.linesAdded,
    linesDeleted: file.linesDeleted,
    changeType: file.changeType,
    oldPath: file.oldPath,
  };
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
  /** Workflow ID being reviewed */
  workflowId: string;
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
  /** Step outputs from the workflow */
  stepOutputs?: StepOutputSummary[] | undefined;
  /** When the workflow started */
  startedAt?: number | undefined;
  /** When the workflow completed */
  completedAt?: number | undefined;
  /** Duration the workflow ran */
  durationMs?: number | undefined;
  /** Files changed in the workflow */
  changedFiles: ChangedFile[];
  /** Total lines added */
  totalLinesAdded: number;
  /** Total lines deleted */
  totalLinesDeleted: number;
  /** Base branch for diff comparison */
  baseBranch?: string | undefined;
  /** Head branch (workflow branch) */
  headBranch?: string | undefined;
  /** Worktree path for file operations */
  worktreePath?: string | undefined;
  /** Number of commits in the workflow */
  commitCount?: number | undefined;
  /** Current review status */
  status: ReviewStatus;
  /** Pre-merge check results */
  checkResults: CheckResult[];
  /** Whether pre-merge checks are enabled */
  checksEnabled: boolean;
  /** Error message if any */
  error?: string | undefined;
  /** Whether data is loading */
  isLoading?: boolean | undefined;
}

/**
 * Messages from the review webview to the extension.
 */
export type ReviewMessageToExtension =
  | { type: 'ready' }
  | { type: 'viewDiff'; payload: { filePath: string } }
  | { type: 'viewAllChanges' }
  | { type: 'runChecks' }
  | { type: 'approve'; payload?: { feedback?: string } }
  | { type: 'reject'; payload?: { reason?: string } }
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
  return ['ready', 'viewDiff', 'viewAllChanges', 'runChecks', 'approve', 'reject', 'refresh', 'overrideChecks'].includes(msg.type);
}
