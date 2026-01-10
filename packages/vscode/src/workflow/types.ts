import { WebviewMessage } from '../shared/webview/WebviewPanel';

/**
 * Workflow step status
 */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * A single step in a workflow
 */
export interface WorkflowStep {
  id: string;
  name: string;
  status: StepStatus;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  /** Nesting level for loop steps (0 = top level) */
  depth: number;
  /** Whether this step is a loop container */
  isLoop?: boolean;
  /** Progress for loop steps (current/total) */
  loopProgress?: {
    current: number;
    total: number;
  };
}

/**
 * Overall workflow status
 */
export type WorkflowStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

/**
 * Workflow detail information
 */
export interface WorkflowDetail {
  id: string;
  grimoireName: string;
  status: WorkflowStatus;
  startedAt?: number;
  completedAt?: number;
  steps: WorkflowStep[];
  error?: string;
  taskId?: string;
}

/**
 * State for the WorkflowDetailPanel webview
 */
export interface WorkflowDetailState {
  workflow: WorkflowDetail | null;
  isLoading: boolean;
  error: string | null;
  /** Actions available for current workflow state */
  availableActions: WorkflowAction[];
}

/**
 * Available workflow actions
 */
export type WorkflowAction = 'pause' | 'resume' | 'cancel' | 'retry';

/**
 * Messages from the webview to the extension
 */
export interface WorkflowDetailMessageToExtension extends WebviewMessage {
  type: 'ready' | 'pause' | 'resume' | 'cancel' | 'retry' | 'viewOutput';
  payload?: {
    stepId?: string;
  };
}
