import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  ReviewState,
  ReviewMessageToWebview,
  ChangedFile,
  CheckResult,
  CheckStatus,
  MergeConflictInfo,
  StepOutputSummary,
} from '../types';

// VS Code API type
export interface VsCodeApi {
  postMessage: (message: unknown) => void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// Lazy getter for VS Code API - allows testing without global
let cachedVsCodeApi: VsCodeApi | null = null;
function getVsCodeApi(): VsCodeApi {
  if (!cachedVsCodeApi) {
    cachedVsCodeApi = acquireVsCodeApi();
  }
  return cachedVsCodeApi;
}

// For testing: allow resetting the cached API
export function _resetVsCodeApi(): void {
  cachedVsCodeApi = null;
}

export interface AppProps {
  vsCodeApi?: VsCodeApi;
}

export function App({ vsCodeApi }: AppProps): React.ReactElement {
  const vscode = useMemo(() => vsCodeApi ?? getVsCodeApi(), [vsCodeApi]);
  const [state, setState] = useState<ReviewState | null>(null);
  const [feedback, setFeedback] = useState('');
  const [revertReason, setRevertReason] = useState('');
  const [showRevertDialog, setShowRevertDialog] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [showOverrideDialog, setShowOverrideDialog] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<ReviewMessageToWebview>): void => {
      const message = event.data;
      if (message.type === 'state') {
        setState(message.payload);
      }
    };

    window.addEventListener('message', handleMessage);

    // Signal ready to receive state
    vscode.postMessage({ type: 'refresh' });

    return () => window.removeEventListener('message', handleMessage);
  }, [vscode]);

  const handleViewDiff = useCallback(
    (filePath: string) => {
      vscode.postMessage({ type: 'viewDiff', payload: { filePath } });
    },
    [vscode]
  );

  const handleViewAllChanges = useCallback(() => {
    vscode.postMessage({ type: 'viewAllChanges' });
  }, [vscode]);

  const handleRunChecks = useCallback(() => {
    vscode.postMessage({ type: 'runChecks' });
  }, [vscode]);

  const handleApprove = useCallback(() => {
    vscode.postMessage({ type: 'approve', payload: { feedback: feedback || undefined } });
  }, [vscode, feedback]);

  const handleRevert = useCallback(() => {
    setShowRevertDialog(true);
  }, []);

  const confirmRevert = useCallback(() => {
    vscode.postMessage({ type: 'revert', payload: { reason: revertReason || undefined } });
    setShowRevertDialog(false);
  }, [vscode, revertReason]);

  const handleOverride = useCallback(() => {
    setShowOverrideDialog(true);
  }, []);

  const confirmOverride = useCallback(() => {
    if (overrideReason.trim()) {
      vscode.postMessage({ type: 'overrideChecks', payload: { reason: overrideReason } });
      setShowOverrideDialog(false);
    }
  }, [vscode, overrideReason]);

  const handleOpenWorktree = useCallback(() => {
    vscode.postMessage({ type: 'openWorktree' });
  }, [vscode]);

  const handleRetryMerge = useCallback(() => {
    vscode.postMessage({ type: 'retryMerge' });
  }, [vscode]);

  const handleOpenConflictFile = useCallback(
    (filePath: string) => {
      vscode.postMessage({ type: 'openConflictFile', payload: { filePath } });
    },
    [vscode]
  );

  if (!state) {
    return <div className="loading">Loading review...</div>;
  }

  const hasFailedChecks = state.checkResults.some((r) => r.status === 'failed');
  const allChecksPassed =
    state.checkResults.length > 0 && state.checkResults.every((r) => r.status === 'passed');

  return (
    <div className="review-panel">
      <header className="review-header">
        <h1>{state.title}</h1>
        <div className="review-meta">
          {state.completedAt && (
            <span className="meta-item">
              Completed: {formatDate(state.completedAt)}
            </span>
          )}
          {state.durationMs && (
            <span className="meta-item">Duration: {formatDuration(state.durationMs)}</span>
          )}
        </div>
      </header>

      <section className="review-section">
        <h2>Description</h2>
        <p className="description">{state.description || 'No description'}</p>
      </section>

      {state.acceptanceCriteria && (
        <section className="review-section">
          <h2>Acceptance Criteria</h2>
          <div className="acceptance-criteria">
            {state.acceptanceCriteria.split('\n').map((line, i) => (
              <div key={i} className="criteria-item">
                {line.startsWith('- ') ? (
                  <>
                    <span className="criteria-checkbox">☐</span>
                    {line.substring(2)}
                  </>
                ) : (
                  line
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {state.stepOutputs && state.stepOutputs.length > 0 && (
        <StepOutputsSection stepOutputs={state.stepOutputs} />
      )}

      <section className="review-section">
        <div className="section-header">
          <h2>Changed Files</h2>
          <button className="button-secondary" onClick={handleViewAllChanges}>
            View All Changes
          </button>
        </div>
        <div className="changes-summary">
          <span className="additions">+{state.totalLinesAdded}</span>
          <span className="deletions">-{state.totalLinesDeleted}</span>
          <span className="file-count">{state.changedFiles.length} files</span>
        </div>
        <div className="file-list">
          {state.changedFiles.length === 0 ? (
            <div className="no-changes">No changes detected</div>
          ) : (
            state.changedFiles.map((file) => (
              <FileItem key={file.path} file={file} onViewDiff={handleViewDiff} />
            ))
          )}
        </div>
      </section>

      {state.checksEnabled && (
        <section className="review-section">
          <div className="section-header">
            <h2>Pre-Merge Checks</h2>
            <button
              className="button-secondary"
              onClick={handleRunChecks}
              disabled={state.status === 'checking'}
            >
              {state.status === 'checking' ? 'Running...' : 'Run Checks'}
            </button>
          </div>
          {state.checkResults.length > 0 ? (
            <div className="check-results">
              {state.checkResults.map((result, i) => (
                <CheckResultItem key={i} result={result} />
              ))}
            </div>
          ) : (
            <div className="no-checks">No checks have been run yet</div>
          )}
        </section>
      )}

      {state.status === 'conflict' && state.mergeConflict && (
        <MergeConflictSection
          conflictInfo={state.mergeConflict}
          isRetrying={state.isRetrying}
          onOpenWorktree={handleOpenWorktree}
          onRetryMerge={handleRetryMerge}
          onOpenFile={handleOpenConflictFile}
        />
      )}

      <section className="review-section">
        <h2>Feedback (Optional)</h2>
        <textarea
          className="feedback-input"
          placeholder="Add feedback or notes about this review..."
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
      </section>

      <footer className="review-actions">
        {state.status === 'conflict' ? (
          <>
            <button className="button-primary" onClick={handleOpenWorktree}>
              Open Worktree
            </button>
            <button
              className="button-secondary"
              onClick={handleRetryMerge}
              disabled={state.isRetrying}
            >
              {state.isRetrying ? 'Retrying...' : 'Retry Merge'}
            </button>
            <button className="button-danger" onClick={handleRevert}>
              Reject Changes
            </button>
          </>
        ) : (
          <>
            <button
              className="button-primary approve-button"
              onClick={handleApprove}
              disabled={state.status === 'checking' || (state.checksEnabled && hasFailedChecks)}
            >
              {allChecksPassed ? 'Approve & Merge' : 'Approve & Merge'}
            </button>

            {state.checksEnabled && hasFailedChecks && (
              <button className="button-warning" onClick={handleOverride}>
                Override Checks
              </button>
            )}

            <button className="button-danger" onClick={handleRevert}>
              Revert Changes
            </button>
          </>
        )}
      </footer>

      {showRevertDialog && (
        <div className="dialog-overlay">
          <div className="dialog">
            <h3>Revert Changes</h3>
            <p>Are you sure you want to revert? All changes will be discarded.</p>
            <textarea
              className="dialog-input"
              placeholder="Reason for reverting (optional)"
              value={revertReason}
              onChange={(e) => setRevertReason(e.target.value)}
            />
            <div className="dialog-actions">
              <button className="button-secondary" onClick={() => setShowRevertDialog(false)}>
                Cancel
              </button>
              <button className="button-danger" onClick={confirmRevert}>
                Revert
              </button>
            </div>
          </div>
        </div>
      )}

      {showOverrideDialog && (
        <div className="dialog-overlay">
          <div className="dialog">
            <h3>Override Failed Checks</h3>
            <p>Pre-merge checks failed. Overriding may introduce issues.</p>
            <textarea
              className="dialog-input"
              placeholder="Reason for override (required)"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              required
            />
            <div className="dialog-actions">
              <button className="button-secondary" onClick={() => setShowOverrideDialog(false)}>
                Cancel
              </button>
              <button
                className="button-warning"
                onClick={confirmOverride}
                disabled={!overrideReason.trim()}
              >
                Override & Approve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface FileItemProps {
  file: ChangedFile;
  onViewDiff: (path: string) => void;
}

function FileItem({ file, onViewDiff }: FileItemProps): React.ReactElement {
  const getIcon = (): string => {
    switch (file.changeType) {
      case 'added':
        return '+';
      case 'deleted':
        return '-';
      default:
        return '~';
    }
  };

  const getClassName = (): string => {
    return `file-item ${file.changeType}`;
  };

  return (
    <div className={getClassName()}>
      <span className="file-icon">{getIcon()}</span>
      <span className="file-path">{file.path}</span>
      <span className="file-stats">
        <span className="additions">+{file.linesAdded}</span>
        <span className="deletions">-{file.linesDeleted}</span>
      </span>
      <button className="view-diff-button" onClick={() => onViewDiff(file.path)}>
        View Diff
      </button>
    </div>
  );
}

interface CheckResultItemProps {
  result: CheckResult;
}

function CheckResultItem({ result }: CheckResultItemProps): React.ReactElement {
  const [expanded, setExpanded] = useState(result.status === 'failed');

  const getStatusIcon = (status: CheckStatus): string => {
    switch (status) {
      case 'passed':
        return '✓';
      case 'failed':
        return '✗';
      case 'running':
        return '⟳';
      default:
        return '○';
    }
  };

  const getStatusClass = (status: CheckStatus): string => {
    return `check-status ${status}`;
  };

  return (
    <div className="check-result">
      <div className="check-header" onClick={() => setExpanded(!expanded)}>
        <span className={getStatusClass(result.status)}>{getStatusIcon(result.status)}</span>
        <span className="check-command">{result.command}</span>
        {result.durationMs && (
          <span className="check-duration">{(result.durationMs / 1000).toFixed(1)}s</span>
        )}
        <span className="expand-icon">{expanded ? '▼' : '▶'}</span>
      </div>
      {expanded && (result.stdout || result.stderr) && (
        <div className="check-output">
          {result.stdout && <pre className="stdout">{result.stdout}</pre>}
          {result.stderr && <pre className="stderr">{result.stderr}</pre>}
        </div>
      )}
    </div>
  );
}

interface StepOutputsSectionProps {
  stepOutputs: StepOutputSummary[];
}

const TRUNCATE_LENGTH = 200;

function StepOutputsSection({ stepOutputs }: StepOutputsSectionProps): React.ReactElement {
  return (
    <section className="review-section">
      <h2>Step Outputs</h2>
      <div className="step-outputs-list">
        {stepOutputs.map((step) => (
          <StepOutputItem key={step.step_id} step={step} />
        ))}
      </div>
    </section>
  );
}

interface StepOutputItemProps {
  step: StepOutputSummary;
}

function StepOutputItem({ step }: StepOutputItemProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const isFailed = step.exit_code !== undefined && step.exit_code !== 0;
  const isLong = step.summary.length > TRUNCATE_LENGTH;

  const getStatusIcon = (): string => {
    if (step.exit_code === undefined) {
      return '•'; // In progress or unknown
    }
    return step.exit_code === 0 ? '✓' : '✗';
  };

  const getStatusClass = (): string => {
    if (step.exit_code === undefined) {
      return 'step-status pending';
    }
    return step.exit_code === 0 ? 'step-status passed' : 'step-status failed';
  };

  const displayText = expanded || !isLong ? step.summary : step.summary.substring(0, TRUNCATE_LENGTH) + '...';

  return (
    <div className={`step-output-item ${isFailed ? 'failed' : ''}`}>
      <div className="step-output-header">
        <span className={getStatusClass()}>{getStatusIcon()}</span>
        <span className="step-name">{step.step_name}</span>
      </div>
      <div className="step-output-content">
        <p className="step-summary">{displayText}</p>
        {isLong && (
          <button className="button-link" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
}

interface MergeConflictSectionProps {
  conflictInfo: MergeConflictInfo;
  isRetrying?: boolean;
  onOpenWorktree: () => void;
  onRetryMerge: () => void;
  onOpenFile: (filePath: string) => void;
}

function MergeConflictSection({
  conflictInfo,
  isRetrying,
  onOpenWorktree,
  onRetryMerge,
  onOpenFile,
}: MergeConflictSectionProps): React.ReactElement {
  return (
    <section className="review-section conflict-section">
      <div className="conflict-header">
        <span className="conflict-icon">⚠️</span>
        <h2>Merge Conflicts</h2>
      </div>
      <p className="conflict-message">
        {conflictInfo.message ||
          `Merge conflicts detected between ${conflictInfo.sourceBranch} and ${conflictInfo.targetBranch}.`}
      </p>
      <p className="conflict-instructions">
        Please resolve the conflicts in the worktree and click &quot;Retry Merge&quot; when done.
      </p>

      {conflictInfo.conflictFiles.length > 0 && (
        <div className="conflict-files">
          <h3>Conflicting Files ({conflictInfo.conflictFiles.length})</h3>
          <ul className="conflict-file-list">
            {conflictInfo.conflictFiles.map((file) => (
              <li key={file} className="conflict-file-item">
                <span className="conflict-file-icon">⚠️</span>
                <span className="conflict-file-path">{file}</span>
                <button
                  className="button-secondary button-small"
                  onClick={() => onOpenFile(file)}
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="conflict-actions">
        <button className="button-primary" onClick={onOpenWorktree}>
          Open Worktree
        </button>
        <button
          className="button-secondary"
          onClick={onRetryMerge}
          disabled={isRetrying}
        >
          {isRetrying ? 'Retrying...' : 'Retry Merge'}
        </button>
      </div>
    </section>
  );
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
