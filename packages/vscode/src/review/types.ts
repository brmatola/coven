/**
 * Types for the review workflow module.
 */

import { WebviewMessage } from '../shared/webview/WebviewPanel';

/**
 * A file changed in the workflow
 */
export interface WorkflowChangedFile {
  path: string;
  lines_added: number;
  lines_deleted: number;
  change_type: 'added' | 'modified' | 'deleted' | 'renamed';
  old_path?: string;
}

/**
 * Step output summary for review
 */
export interface StepOutputSummary {
  step_id: string;
  step_name: string;
  summary: string;
  exit_code?: number;
}

/**
 * Status of a review.
 */
export type ReviewStatus = 'pending' | 'checking' | 'approved' | 'reverted' | 'conflict';

/**
 * Information about a merge conflict.
 */
export interface MergeConflictInfo {
  /** List of files with conflicts */
  conflictFiles: string[];
  /** Path to the worktree where conflicts can be resolved */
  worktreePath: string;
  /** Source branch being merged */
  sourceBranch: string;
  /** Target branch being merged into */
  targetBranch: string;
  /** User-friendly message about the conflict */
  message: string;
}

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
    linesAdded: file.lines_added,
    linesDeleted: file.lines_deleted,
    changeType: file.change_type,
    oldPath: file.old_path,
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
  /** Merge conflict information if status is 'conflict' */
  mergeConflict?: MergeConflictInfo | undefined;
  /** Whether a merge retry is in progress */
  isRetrying?: boolean | undefined;
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
  | { type: 'overrideChecks'; payload: { reason: string } }
  | { type: 'openWorktree' }
  | { type: 'retryMerge' }
  | { type: 'openConflictFile'; payload: { filePath: string } };

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
  return [
    'ready',
    'viewDiff',
    'viewAllChanges',
    'runChecks',
    'approve',
    'reject',
    'refresh',
    'overrideChecks',
    'openWorktree',
    'retryMerge',
    'openConflictFile',
  ].includes(msg.type);
}
