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
  /** Composite task ID for SSE event matching (e.g., task-123-step-0) */
  stepTaskId?: string;
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
 * Output state for a step/agent
 */
export interface OutputState {
  /** ID of the step/agent showing output */
  stepId: string | null;
  /** Output lines accumulated so far */
  lines: string[];
  /** Whether output is loading */
  isLoading: boolean;
  /** Whether this is live streaming output */
  isStreaming: boolean;
  /** Whether auto-scroll is enabled */
  autoScroll: boolean;
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
  /** Output state for the currently selected step */
  output: OutputState;
}

/**
 * Available workflow actions
 */
export type WorkflowAction = 'pause' | 'resume' | 'cancel' | 'retry';

/**
 * Messages from the webview to the extension
 */
export interface WorkflowDetailMessageToExtension extends WebviewMessage {
  type:
    | 'ready'
    | 'pause'
    | 'resume'
    | 'cancel'
    | 'retry'
    | 'viewOutput'
    | 'selectStep'
    | 'toggleAutoScroll'
    | 'clearOutput';
  payload?: {
    stepId?: string;
    autoScroll?: boolean;
  };
}
