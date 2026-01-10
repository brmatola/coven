import * as vscode from 'vscode';
import { WebviewPanel } from '../shared/webview/WebviewPanel';
import { MessageRouter } from '../shared/messageRouter';
import { getLogger } from '../shared/logger';
import { DaemonClient } from '../daemon/client';
import { SSEClient, SSEEvent } from '../daemon/sse';
import {
  WorkflowDetailState,
  WorkflowDetailMessageToExtension,
  WorkflowDetail,
  WorkflowStep,
  WorkflowAction,
  StepStatus,
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
      .on('viewOutput', (msg: { payload?: { stepId?: string } }) => this.handleViewOutput(msg.payload?.stepId));

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
    });

    try {
      const state = await this.client.getState();

      // For now, create a basic workflow from daemon state
      // In a full implementation, we'd have a /workflows/:id endpoint
      this.currentWorkflow = {
        id: this.workflowId,
        grimoireName: 'Default Grimoire',
        status: state.workflow.status as WorkflowDetail['status'],
        startedAt: state.workflow.startedAt,
        completedAt: state.workflow.completedAt,
        steps: this.buildStepsFromTasks(state.tasks),
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
}
