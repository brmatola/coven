import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  TaskDetailState,
  TaskDetailMessageToWebview,
  Task,
  TaskUpdate,
  BlockingTaskInfo,
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
  const [state, setState] = useState<TaskDetailState | null>(null);

  // Local editing state
  const [editedTitle, setEditedTitle] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [editedAC, setEditedAC] = useState('');

  // Track which fields have local edits (use refs to avoid closure issues)
  const dirtyFieldsRef = useRef<Set<'title' | 'description' | 'acceptanceCriteria'>>(new Set());
  const pendingSaveRef = useRef<boolean>(false);

  // Debounce timer ref
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<TaskDetailMessageToWebview>): void => {
      const message = event.data;
      if (message.type === 'state') {
        setState(message.payload);

        const task = message.payload.task;
        if (task) {
          // Only update fields that don't have local edits
          // This prevents sync from overwriting user's typing
          if (!dirtyFieldsRef.current.has('title') && !pendingSaveRef.current) {
            setEditedTitle(task.title);
          }
          if (!dirtyFieldsRef.current.has('description') && !pendingSaveRef.current) {
            setEditedDescription(task.description);
          }
          if (!dirtyFieldsRef.current.has('acceptanceCriteria') && !pendingSaveRef.current) {
            setEditedAC(task.acceptanceCriteria ?? '');
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // Signal ready to receive state
    vscode.postMessage({ type: 'ready' });

    return () => window.removeEventListener('message', handleMessage);
  }, [vscode]);

  // Auto-save with debounce
  const debouncedSave = useCallback(
    (update: TaskUpdate) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      pendingSaveRef.current = true;

      saveTimeoutRef.current = setTimeout(() => {
        vscode.postMessage({ type: 'save', payload: update });
        // Clear dirty flags after save is sent
        // Keep pendingSaveRef true until we get confirmation (state update with isSaving: false)
        dirtyFieldsRef.current.clear();
      }, 1000); // 1 second debounce
    },
    [vscode]
  );

  // Clear pending save flag when save completes
  useEffect(() => {
    if (state && !state.isSaving && pendingSaveRef.current) {
      pendingSaveRef.current = false;
    }
  }, [state?.isSaving]);

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newTitle = e.target.value;
      setEditedTitle(newTitle);
      dirtyFieldsRef.current.add('title');
      debouncedSave({ title: newTitle });
    },
    [debouncedSave]
  );

  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newDesc = e.target.value;
      setEditedDescription(newDesc);
      dirtyFieldsRef.current.add('description');
      debouncedSave({ description: newDesc });
    },
    [debouncedSave]
  );

  const handleACChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newAC = e.target.value;
      setEditedAC(newAC);
      dirtyFieldsRef.current.add('acceptanceCriteria');
      debouncedSave({ acceptanceCriteria: newAC });
    },
    [debouncedSave]
  );

  const handleStartTask = useCallback(() => {
    vscode.postMessage({ type: 'startTask' });
  }, [vscode]);

  const handleDeleteTask = useCallback(() => {
    vscode.postMessage({ type: 'deleteTask' });
  }, [vscode]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  if (!state) {
    return <div className="loading">Loading task details...</div>;
  }

  if (state.error && !state.task) {
    return (
      <div className="task-detail-container">
        <div className="error-banner">
          <span className="error-icon">!</span>
          <span>{state.error}</span>
        </div>
      </div>
    );
  }

  const task = state.task;
  if (!task) {
    return <div className="loading">Task not found</div>;
  }

  return (
    <div className="task-detail-container">
      {state.error && (
        <div className="error-banner">
          <span className="error-icon">!</span>
          <span>{state.error}</span>
        </div>
      )}

      <header className="task-header">
        <div className="task-meta">
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
          <span className="task-id">{task.id}</span>
          {state.isSaving && (
            <span className="saving-indicator">
              <span className="spinner" />
              Saving...
            </span>
          )}
        </div>

        <div className="title-container">
          <input
            type="text"
            className="title-input"
            value={editedTitle}
            onChange={handleTitleChange}
            placeholder="Task title"
            disabled={state.isSaving}
          />
        </div>
      </header>

      {state.blockingTasks.length > 0 && (
        <BlockingTasksSection tasks={state.blockingTasks} />
      )}

      <section>
        <h2>Description</h2>
        <textarea
          className="editable-textarea"
          value={editedDescription}
          onChange={handleDescriptionChange}
          placeholder="Add a description..."
          disabled={state.isSaving}
        />
      </section>

      <section>
        <h2>Acceptance Criteria</h2>
        <textarea
          className="editable-textarea"
          value={editedAC}
          onChange={handleACChange}
          placeholder="Define the criteria for task completion..."
          disabled={state.isSaving}
        />
      </section>

      <section>
        <h2>Metadata</h2>
        <MetadataGrid task={task} />
      </section>

      <div className="actions">
        {state.canStart && (
          <button className="primary" onClick={handleStartTask} disabled={state.isSaving}>
            <span>Start Task</span>
          </button>
        )}
        {state.canDelete && (
          <button className="danger" onClick={handleDeleteTask} disabled={state.isSaving}>
            <span>Delete Task</span>
          </button>
        )}
      </div>
    </div>
  );
}

interface StatusBadgeProps {
  status: Task['status'];
}

function StatusBadge({ status }: StatusBadgeProps): React.ReactElement {
  const labels: Record<Task['status'], string> = {
    ready: 'Ready',
    working: 'Working',
    review: 'Review',
    done: 'Done',
    blocked: 'Blocked',
  };

  return <span className={`status-badge status-${status}`}>{labels[status]}</span>;
}

interface PriorityBadgeProps {
  priority: Task['priority'];
}

function PriorityBadge({ priority }: PriorityBadgeProps): React.ReactElement {
  const labels: Record<Task['priority'], string> = {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  };

  return <span className={`priority-badge priority-${priority}`}>{labels[priority]}</span>;
}

interface BlockingTasksSectionProps {
  tasks: BlockingTaskInfo[];
}

function BlockingTasksSection({ tasks }: BlockingTasksSectionProps): React.ReactElement {
  return (
    <div className="blocking-tasks">
      <h3>Blocked by {tasks.length} task{tasks.length > 1 ? 's' : ''}</h3>
      {tasks.map((task) => (
        <div key={task.id} className="blocking-task-item">
          <span className="task-title">{task.title}</span>
          <span className="task-status">{task.status}</span>
        </div>
      ))}
    </div>
  );
}

interface MetadataGridProps {
  task: Task;
}

function MetadataGrid({ task }: MetadataGridProps): React.ReactElement {
  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="metadata-grid">
      <div className="metadata-item">
        <label>Source</label>
        <span className="value">{task.sourceId}</span>
      </div>
      <div className="metadata-item">
        <label>Created</label>
        <span className="value">{formatDate(task.createdAt)}</span>
      </div>
      <div className="metadata-item">
        <label>Updated</label>
        <span className="value">{formatDate(task.updatedAt)}</span>
      </div>
      {task.externalId && (
        <div className="metadata-item">
          <label>External ID</label>
          <span className="value">{task.externalId}</span>
        </div>
      )}
    </div>
  );
}
