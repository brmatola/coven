// Shared types between extension and task detail webview

import { Task, TaskStatus, TaskPriority } from '../shared/types';

/**
 * State sent to the task detail webview.
 */
export interface TaskDetailState {
  task: Task | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  canStart: boolean;
  canDelete: boolean;
  blockingTasks: BlockingTaskInfo[];
}

/**
 * Information about a task that's blocking this one.
 */
export interface BlockingTaskInfo {
  id: string;
  title: string;
  status: TaskStatus;
}

/**
 * Task update payload for edits.
 */
export interface TaskUpdate {
  title?: string;
  description?: string;
  acceptanceCriteria?: string;
}

// Messages from webview to extension
export type TaskDetailMessageToExtension =
  | { type: 'ready' }
  | { type: 'save'; payload: TaskUpdate }
  | { type: 'startTask' }
  | { type: 'deleteTask' };

// Messages from extension to webview
export type TaskDetailMessageToWebview = { type: 'state'; payload: TaskDetailState };

// Re-export for convenience
export type { Task, TaskStatus, TaskPriority };
