import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  WorkflowDetailState,
  WorkflowStep,
  WorkflowAction,
  StepStatus,
} from '../types';

interface MessageToWebview {
  type: 'state';
  payload: WorkflowDetailState;
}

export interface VsCodeApi {
  postMessage: (message: unknown) => void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let cachedVsCodeApi: VsCodeApi | null = null;
function getVsCodeApi(): VsCodeApi {
  if (!cachedVsCodeApi) {
    cachedVsCodeApi = acquireVsCodeApi();
  }
  return cachedVsCodeApi;
}

export function _resetVsCodeApi(): void {
  cachedVsCodeApi = null;
}

export interface AppProps {
  vsCodeApi?: VsCodeApi;
}

export function App({ vsCodeApi }: AppProps): React.ReactElement {
  const vscode = useMemo(() => vsCodeApi ?? getVsCodeApi(), [vsCodeApi]);
  const [state, setState] = useState<WorkflowDetailState | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<MessageToWebview>): void => {
      const message = event.data;
      if (message.type === 'state') {
        setState(message.payload);
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'ready' });

    return () => window.removeEventListener('message', handleMessage);
  }, [vscode]);

  const handleAction = useCallback(
    (action: WorkflowAction) => {
      vscode.postMessage({ type: action });
    },
    [vscode]
  );

  const handleSelectStep = useCallback(
    (stepId: string | null) => {
      setSelectedStepId(stepId);
      vscode.postMessage({ type: 'selectStep', payload: { stepId } });
    },
    [vscode]
  );

  const handleViewOutput = useCallback(
    (stepId: string) => {
      vscode.postMessage({ type: 'viewOutput', payload: { stepId } });
    },
    [vscode]
  );

  if (!state) {
    return <div className="loading">Loading workflow details...</div>;
  }

  if (state.isLoading) {
    return (
      <div className="loading">
        <div className="spinner" />
        <span>Loading workflow...</span>
      </div>
    );
  }

  if (state.error && !state.workflow) {
    return (
      <div className="workflow-container">
        <div className="error-banner">
          <span className="error-icon">!</span>
          <span>{state.error}</span>
        </div>
      </div>
    );
  }

  const workflow = state.workflow;
  if (!workflow) {
    return <div className="loading">Workflow not found</div>;
  }

  return (
    <div className="workflow-container">
      {state.error && (
        <div className="error-banner">
          <span className="error-icon">!</span>
          <span>{state.error}</span>
        </div>
      )}

      <header className="workflow-header">
        <div className="workflow-meta">
          <WorkflowStatusBadge status={workflow.status} />
          <span className="grimoire-name">{workflow.grimoireName}</span>
        </div>
        <div className="workflow-id">{workflow.id}</div>
        {workflow.startedAt && (
          <div className="workflow-time">
            Started: {formatTime(workflow.startedAt)}
          </div>
        )}
      </header>

      <section className="actions-bar">
        {state.availableActions.map((action) => (
          <ActionButton
            key={action}
            action={action}
            onClick={() => handleAction(action)}
          />
        ))}
        {state.availableActions.length === 0 && (
          <span className="no-actions">No actions available</span>
        )}
      </section>

      <section className="steps-section">
        <h2>Steps</h2>
        {workflow.steps.length === 0 ? (
          <div className="no-steps">No steps to display</div>
        ) : (
          <div className="steps-list">
            {workflow.steps.map((step) => (
              <StepItem
                key={step.id}
                step={step}
                isSelected={selectedStepId === step.id}
                onSelect={() => handleSelectStep(step.id)}
                onViewOutput={() => handleViewOutput(step.id)}
              />
            ))}
          </div>
        )}
      </section>

      {state.output.stepId && (
        <section className="output-section">
          <div className="output-header">
            <h3>Output: {state.output.stepId}</h3>
            {state.output.isStreaming && (
              <span className="streaming-indicator">Streaming...</span>
            )}
          </div>
          <div className="output-content">
            {state.output.isLoading ? (
              <div className="loading">Loading output...</div>
            ) : state.output.lines.length === 0 ? (
              <div className="no-output">No output available</div>
            ) : (
              <pre className="output-lines">
                {state.output.lines.join('\n')}
              </pre>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

interface WorkflowStatusBadgeProps {
  status: string;
}

function WorkflowStatusBadge({ status }: WorkflowStatusBadgeProps): React.ReactElement {
  const labels: Record<string, string> = {
    idle: 'Idle',
    running: 'Running',
    paused: 'Paused',
    completed: 'Completed',
    failed: 'Failed',
    pending_merge: 'Pending Merge',
    blocked: 'Blocked',
  };

  return (
    <span className={`status-badge status-${status}`}>
      {labels[status] ?? status}
    </span>
  );
}

interface ActionButtonProps {
  action: WorkflowAction;
  onClick: () => void;
}

function ActionButton({ action, onClick }: ActionButtonProps): React.ReactElement {
  const labels: Record<WorkflowAction, string> = {
    pause: 'Pause',
    resume: 'Resume',
    cancel: 'Cancel',
    retry: 'Retry',
  };

  const className = action === 'cancel' ? 'danger' : 'primary';

  return (
    <button className={className} onClick={onClick}>
      {labels[action]}
    </button>
  );
}

interface StepItemProps {
  step: WorkflowStep;
  isSelected: boolean;
  onSelect: () => void;
  onViewOutput: () => void;
}

function StepItem({ step, isSelected, onSelect, onViewOutput }: StepItemProps): React.ReactElement {
  const statusIcons: Record<StepStatus, string> = {
    pending: '\u25CB', // Circle
    running: '\u25CF', // Filled circle
    completed: '\u2713', // Checkmark
    failed: '\u2717', // X mark
    skipped: '\u2212', // Minus
  };

  return (
    <div
      className={`step-item step-status-${step.status} ${isSelected ? 'selected' : ''}`}
      style={{ paddingLeft: `${step.depth * 20 + 12}px` }}
      onClick={onSelect}
    >
      <span className="step-icon">{statusIcons[step.status]}</span>
      <span className="step-name">{step.name}</span>
      {step.isLoop && step.loopProgress && (
        <span className="loop-progress">
          {step.loopProgress.current}/{step.loopProgress.total}
        </span>
      )}
      {step.error && <span className="step-error" title={step.error}>Error</span>}
      {(step.status === 'completed' || step.status === 'failed') && (
        <button
          className="view-output-btn"
          onClick={(e) => {
            e.stopPropagation();
            onViewOutput();
          }}
        >
          View Output
        </button>
      )}
    </div>
  );
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
