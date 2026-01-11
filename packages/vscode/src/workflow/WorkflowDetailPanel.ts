import * as vscode from 'vscode';
import { WebviewPanel } from '../shared/webview/WebviewPanel';
import { MessageRouter } from '../shared/messageRouter';
import { getLogger } from '../shared/logger';
import { DaemonClient } from '../daemon/client';
import { SSEClient } from '@coven/client-ts';
import type { SSEEvent } from '@coven/client-ts';
import {
  WorkflowDetailState,
  WorkflowDetailMessageToExtension,
  WorkflowDetail,
  WorkflowStep,
  WorkflowAction,
  StepStatus,
  OutputState,
} from './types';

/**
 * SSE event data for workflow step updates
 */
interface WorkflowStepEventData {
  workflowId: string;
  stepId: string;
  status: StepStatus;
  error?: string;
}

/**
 * SSE event data for workflow status changes
 */
interface WorkflowStatusEventData {
  workflowId: string;
  status: string;
  error?: string;
}

/**
 * SSE event data for agent output
 */
interface AgentOutputEventData {
  agentId: string;
  taskId: string;
  chunk: string;
}

/**
 * SSE event data for agent spawned
 */
interface AgentSpawnedEventData {
  agentId: string;
  taskId: string;
}

/**
 * SSE event data for agent completed/failed
 */
interface AgentCompletedEventData {
  agentId: string;
  taskId: string;
  exitCode?: number;
  error?: string;
}

/**
 * Panel for viewing workflow execution details.
 * Shows step progress, status, and action buttons.
 */
export class WorkflowDetailPanel extends WebviewPanel<
  WorkflowDetailState,
  WorkflowDetailMessageToExtension
> {
  private static panels = new Map<string, WorkflowDetailPanel>();

  private readonly router: MessageRouter<WorkflowDetailMessageToExtension>;
  private readonly client: DaemonClient;
  private readonly sseClient: SSEClient;
  private readonly workflowId: string;
  private eventHandler: ((event: SSEEvent) => void) | null = null;
  private currentWorkflow: WorkflowDetail | null = null;
  private outputState: OutputState = {
    stepId: null,
    lines: [],
    isLoading: false,
    isStreaming: false,
    autoScroll: true,
  };
  /** Map from taskId to agentId for tracking active agents */
  private taskAgentMap: Map<string, string> = new Map();

  /**
   * Create or reveal a workflow detail panel for the given workflow.
   */
  public static createOrShow(
    extensionUri: vscode.Uri,
    client: DaemonClient,
    sseClient: SSEClient,
    workflowId: string
  ): WorkflowDetailPanel | null {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    // Check if panel already exists for this workflow
    const existing = WorkflowDetailPanel.panels.get(workflowId);
    if (existing) {
      existing.reveal(column);
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      'covenWorkflowDetail',
      `Workflow: ${workflowId.substring(0, 15)}...`,
      column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webviews')],
        retainContextWhenHidden: true,
      }
    );

    const detailPanel = new WorkflowDetailPanel(
      panel,
      extensionUri,
      client,
      sseClient,
      workflowId
    );
    WorkflowDetailPanel.panels.set(workflowId, detailPanel);
    return detailPanel;
  }

  /**
   * Get an existing panel for a workflow if one exists.
   */
  public static get(workflowId: string): WorkflowDetailPanel | undefined {
    return WorkflowDetailPanel.panels.get(workflowId);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    client: DaemonClient,
    sseClient: SSEClient,
    workflowId: string
  ) {
    super(panel, extensionUri);
    this.client = client;
    this.sseClient = sseClient;
    this.workflowId = workflowId;

    this.router = new MessageRouter<WorkflowDetailMessageToExtension>()
      .on('ready', () => this.handleReady())
      .on('pause', () => this.handlePause())
      .on('resume', () => this.handleResume())
      .on('cancel', () => this.handleCancel())
      .on('retry', () => this.handleRetry())
      .on('viewOutput', (msg: { payload?: { stepId?: string } }) => this.handleViewOutput(msg.payload?.stepId))
      .on('selectStep', (msg: { payload?: { stepId?: string } }) => this.handleSelectStep(msg.payload?.stepId))
      .on('toggleAutoScroll', (msg: { payload?: { autoScroll?: boolean } }) =>
        this.handleToggleAutoScroll(msg.payload?.autoScroll)
      )
      .on('clearOutput', () => this.handleClearOutput());

    // Subscribe to SSE events
    this.subscribeToEvents();
  }

  protected getWebviewName(): string {
    return 'workflow';
  }

  protected async onMessage(message: WorkflowDetailMessageToExtension): Promise<void> {
    const handled = await this.router.route(message);
    if (!handled) {
      getLogger().warn('Unhandled message type in WorkflowDetailPanel', { type: message.type });
    }
  }

  public override dispose(): void {
    WorkflowDetailPanel.panels.delete(this.workflowId);
    this.unsubscribeFromEvents();
    super.dispose();
  }

  // ============================================================================
  // SSE Event Handling
  // ============================================================================

  private subscribeToEvents(): void {
    this.eventHandler = (event: SSEEvent): void => {
      switch (event.type) {
        case 'workflow.started':
        case 'workflow.completed':
        case 'workflow.failed':
        case 'workflow.paused':
        case 'workflow.resumed':
          this.handleWorkflowStatusEvent(event.data as WorkflowStatusEventData);
          break;
        case 'task.started':
        case 'task.completed':
        case 'task.failed':
          this.handleStepStatusEvent(event.data as WorkflowStepEventData);
          break;
        case 'agent.spawned':
          this.handleAgentSpawned(event.data as AgentSpawnedEventData);
          break;
        case 'agent.output':
          this.handleAgentOutput(event.data as AgentOutputEventData);
          break;
        case 'agent.completed':
        case 'agent.failed':
          this.handleAgentCompleted(event.data as AgentCompletedEventData);
          break;
      }
    };

    this.sseClient.on('event', this.eventHandler);
  }

  private unsubscribeFromEvents(): void {
    if (this.eventHandler) {
      this.sseClient.off('event', this.eventHandler);
      this.eventHandler = null;
    }
  }

  private handleWorkflowStatusEvent(data: WorkflowStatusEventData): void {
    if (data.workflowId !== this.workflowId) {
      return;
    }

    if (this.currentWorkflow) {
      this.currentWorkflow.status = data.status as WorkflowDetail['status'];
      if (data.error) {
        this.currentWorkflow.error = data.error;
      }
      if (data.status === 'completed' || data.status === 'failed') {
        this.currentWorkflow.completedAt = Date.now();
      }
      this.sendState();
    } else {
      // Refetch if we don't have the workflow loaded
      void this.fetchWorkflow();
    }
  }

  private handleStepStatusEvent(data: WorkflowStepEventData): void {
    if (data.workflowId !== this.workflowId || !this.currentWorkflow) {
      return;
    }

    const step = this.currentWorkflow.steps.find((s) => s.id === data.stepId);
    if (step) {
      step.status = data.status;
      if (data.error) {
        step.error = data.error;
      }
      if (data.status === 'running') {
        step.startedAt = Date.now();
      } else if (data.status === 'completed' || data.status === 'failed') {
        step.completedAt = Date.now();
      }
      this.sendState();
    }
  }

  private handleAgentSpawned(data: AgentSpawnedEventData): void {
    // Track the agent-task mapping
    this.taskAgentMap.set(data.taskId, data.agentId);

    // If this is the selected step, start streaming
    if (this.outputState.stepId === data.taskId) {
      this.outputState = {
        ...this.outputState,
        lines: [],
        isStreaming: true,
        isLoading: false,
      };
      this.sendState();
    }
  }

  private handleAgentOutput(data: AgentOutputEventData): void {
    // Only process if this is for the selected step
    if (this.outputState.stepId !== data.taskId) {
      return;
    }

    // Append chunk to output lines
    // Split by newlines to maintain line structure
    const existingText = this.outputState.lines.join('\n');
    const newText = existingText + data.chunk;
    const newLines = newText.split('\n');

    this.outputState = {
      ...this.outputState,
      lines: newLines,
      isStreaming: true,
    };

    this.sendState();
  }

  private handleAgentCompleted(data: AgentCompletedEventData): void {
    // Clean up agent mapping
    if (this.taskAgentMap.get(data.taskId) === data.agentId) {
      this.taskAgentMap.delete(data.taskId);
    }

    // If this is the selected step, stop streaming
    if (this.outputState.stepId === data.taskId) {
      this.outputState = {
        ...this.outputState,
        isStreaming: false,
      };
      this.sendState();
    }
  }

  // ============================================================================
  // Message Handlers
  // ============================================================================

  private async handleReady(): Promise<void> {
    await this.fetchWorkflow();
  }

  private async fetchWorkflow(): Promise<void> {
    this.updateState({
      workflow: null,
      isLoading: true,
      error: null,
      availableActions: [],
      output: this.outputState,
    });

    try {
      // Fetch workflow details from the daemon API
      interface WorkflowResponse {
        workflow_id: string;
        task_id: string;
        grimoire_name: string;
        status: string;
        current_step: number;
        worktree_path: string;
        started_at?: string;
        updated_at?: string;
        error?: string;
        available_actions?: string[];
        steps?: Array<{
          id: string;
          name: string;
          type: string;
          status: string;
          depth: number;
          is_loop?: boolean;
          max_iterations?: number;
          error?: string;
        }>;
        completed_steps?: Record<string, unknown>;
      }

      const response = await this.client.get<WorkflowResponse>(
        `/workflows/${encodeURIComponent(this.workflowId)}`
      );

      // Use steps from API response (includes grimoire step definitions with status)
      const stepsArray = response.steps ?? [];
      const steps: WorkflowStep[] = stepsArray.map((s: unknown) => {
        const step = s as {
          id: string;
          name: string;
          status: string;
          depth: number;
          is_loop: boolean;
          max_iterations?: number;
          error?: string;
        };
        return {
          id: step.id,
          name: step.name,
          status: step.status as WorkflowStep['status'],
          depth: step.depth,
          isLoop: step.is_loop,
          loopProgress: step.max_iterations ? { current: 0, total: step.max_iterations } : undefined,
          error: step.error,
        };
      });

      const workflow = response as {
        workflow_id: string;
        task_id: string;
        grimoire_name: string;
        status: string;
        started_at?: string;
        error?: string;
      };

      this.currentWorkflow = {
        id: workflow.workflow_id,
        taskId: workflow.task_id,
        grimoireName: workflow.grimoire_name,
        status: workflow.status as WorkflowDetail['status'],
        startedAt: workflow.started_at ? new Date(workflow.started_at).getTime() : undefined,
        error: workflow.error,
        steps,
      };

      this.updatePanelTitle();
      this.sendState();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      getLogger().error('Failed to fetch workflow', { workflowId: this.workflowId, error: message });
      this.updateState({
        workflow: null,
        isLoading: false,
        error: `Failed to load workflow: ${message}`,
        availableActions: [],
        output: this.outputState,
      });
    }
  }

  private buildStepsFromTasks(
    tasks: Array<{ id: string; title: string; status: string }>
  ): WorkflowStep[] {
    return tasks.map((task) => ({
      id: task.id,
      name: task.title,
      status: this.mapTaskStatusToStepStatus(task.status),
      depth: 0,
    }));
  }

  private mapTaskStatusToStepStatus(taskStatus: string): StepStatus {
    switch (taskStatus) {
      case 'ready':
      case 'blocked':
        return 'pending';
      case 'working':
        return 'running';
      case 'review':
      case 'done':
        return 'completed';
      default:
        return 'pending';
    }
  }

  private sendState(): void {
    const state: WorkflowDetailState = {
      workflow: this.currentWorkflow,
      isLoading: false,
      error: null,
      availableActions: this.getAvailableActions(),
      output: this.outputState,
    };

    this.updateState(state);
  }

  private getAvailableActions(): WorkflowAction[] {
    if (!this.currentWorkflow) {
      return [];
    }

    const actions: WorkflowAction[] = [];

    switch (this.currentWorkflow.status) {
      case 'running':
        actions.push('pause', 'cancel');
        break;
      case 'paused':
        actions.push('resume', 'cancel');
        break;
      case 'failed':
        actions.push('retry');
        break;
      case 'idle':
      case 'completed':
        // No actions for idle or completed workflows
        break;
    }

    return actions;
  }

  private updatePanelTitle(): void {
    if (this.currentWorkflow) {
      const name = this.currentWorkflow.grimoireName;
      this.panel.title = `Workflow: ${name.substring(0, 20)}${name.length > 20 ? '...' : ''}`;
    }
  }

  private async handlePause(): Promise<void> {
    if (!this.currentWorkflow || this.currentWorkflow.status !== 'running') {
      await vscode.window.showWarningMessage('Workflow cannot be paused');
      return;
    }

    try {
      // In a full implementation, we'd call: await this.client.pauseWorkflow(this.workflowId);
      void vscode.window.showInformationMessage('Workflow pause requested');
    } catch (error) {
      await vscode.window.showErrorMessage(
        `Failed to pause workflow: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async handleResume(): Promise<void> {
    if (!this.currentWorkflow || this.currentWorkflow.status !== 'paused') {
      await vscode.window.showWarningMessage('Workflow cannot be resumed');
      return;
    }

    try {
      // In a full implementation, we'd call: await this.client.resumeWorkflow(this.workflowId);
      void vscode.window.showInformationMessage('Workflow resume requested');
    } catch (error) {
      await vscode.window.showErrorMessage(
        `Failed to resume workflow: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async handleCancel(): Promise<void> {
    if (
      !this.currentWorkflow ||
      (this.currentWorkflow.status !== 'running' && this.currentWorkflow.status !== 'paused')
    ) {
      await vscode.window.showWarningMessage('Workflow cannot be cancelled');
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      'Cancel this workflow? Running tasks will be stopped.',
      { modal: true },
      'Cancel Workflow'
    );

    if (confirm !== 'Cancel Workflow') {
      return;
    }

    try {
      // In a full implementation, we'd call: await this.client.cancelWorkflow(this.workflowId);
      void vscode.window.showInformationMessage('Workflow cancellation requested');
    } catch (error) {
      await vscode.window.showErrorMessage(
        `Failed to cancel workflow: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async handleRetry(): Promise<void> {
    if (!this.currentWorkflow || this.currentWorkflow.status !== 'failed') {
      await vscode.window.showWarningMessage('Workflow cannot be retried');
      return;
    }

    try {
      // In a full implementation, we'd call: await this.client.retryWorkflow(this.workflowId);
      void vscode.window.showInformationMessage('Workflow retry requested');
    } catch (error) {
      await vscode.window.showErrorMessage(
        `Failed to retry workflow: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async handleViewOutput(stepId?: string): Promise<void> {
    if (!stepId) {
      return;
    }

    // Execute the view output command for the step's task
    await vscode.commands.executeCommand('coven.viewFamiliarOutput', stepId);
  }

  /**
   * Handle step selection for output display.
   * Fetches historical output for completed agents or starts streaming for active ones.
   */
  private async handleSelectStep(stepId?: string): Promise<void> {
    if (!stepId) {
      // Clear selection
      this.outputState = {
        stepId: null,
        lines: [],
        isLoading: false,
        isStreaming: false,
        autoScroll: this.outputState.autoScroll,
      };
      this.sendState();
      return;
    }

    // Check if step exists in workflow
    const step = this.currentWorkflow?.steps.find((s) => s.id === stepId);
    if (!step) {
      return;
    }

    // Update output state to show loading
    this.outputState = {
      stepId,
      lines: [],
      isLoading: true,
      isStreaming: false,
      autoScroll: this.outputState.autoScroll,
    };
    this.sendState();

    // Check if there's an active agent for this step
    const isActiveAgent = this.taskAgentMap.has(stepId);

    if (isActiveAgent) {
      // Agent is running - will receive output via SSE
      this.outputState = {
        ...this.outputState,
        isLoading: false,
        isStreaming: true,
      };
      this.sendState();
    } else {
      // Fetch historical output
      await this.fetchStepOutput(stepId);
    }
  }

  /**
   * Fetch historical output for a step from the daemon.
   */
  private async fetchStepOutput(stepId: string): Promise<void> {
    try {
      const response = await this.client.getAgentOutput(stepId);
      this.outputState = {
        ...this.outputState,
        lines: response.lines.map(l => l.line),
        isLoading: false,
        isStreaming: false,
      };
      this.sendState();
    } catch (error) {
      // No output available or agent doesn't exist
      getLogger().debug('No output available for step', { stepId, error });
      this.outputState = {
        ...this.outputState,
        lines: [],
        isLoading: false,
        isStreaming: false,
      };
      this.sendState();
    }
  }

  /**
   * Handle auto-scroll toggle from webview.
   */
  private handleToggleAutoScroll(autoScroll?: boolean): void {
    this.outputState = {
      ...this.outputState,
      autoScroll: autoScroll ?? !this.outputState.autoScroll,
    };
    this.sendState();
  }

  /**
   * Handle clear output request from webview.
   */
  private handleClearOutput(): void {
    this.outputState = {
      ...this.outputState,
      lines: [],
    };
    this.sendState();
  }
}
