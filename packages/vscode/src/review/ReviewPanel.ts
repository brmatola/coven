/**
 * ReviewPanel provides the webview UI for reviewing workflow changes.
 * Shows changed files, step outputs, and approval/rejection actions.
 */

import * as vscode from 'vscode';
import { WebviewPanel } from '../shared/webview/WebviewPanel';
import { MessageRouter } from '../shared/messageRouter';
import { getLogger } from '../shared/logger';
import { DaemonClient } from '../daemon/client';
import { SSEClient, SSEEvent } from '../daemon/sse';
import {
  ReviewState,
  ReviewMessageToExtension,
  toChangedFile,
} from './types';

/**
 * SSE event data for workflow review updates
 */
interface WorkflowReviewEventData {
  workflowId: string;
  status?: string;
  error?: string;
}

/**
 * Panel for reviewing completed workflow work.
 */
export class ReviewPanel extends WebviewPanel<ReviewState, ReviewMessageToExtension> {
  private static panels = new Map<string, ReviewPanel>();

  private readonly router: MessageRouter<ReviewMessageToExtension>;
  private readonly client: DaemonClient;
  private readonly sseClient: SSEClient;
  private readonly workflowId: string;
  private readonly logger = getLogger();
  private eventHandler: ((event: SSEEvent) => void) | null = null;
  private currentState: Partial<ReviewState> = {};

  /**
   * Create or reveal a review panel for the given workflow.
   */
  public static createOrShow(
    extensionUri: vscode.Uri,
    client: DaemonClient,
    sseClient: SSEClient,
    workflowId: string
  ): ReviewPanel | null {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    // Check if panel already exists for this workflow
    const existing = ReviewPanel.panels.get(workflowId);
    if (existing) {
      existing.reveal(column);
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      'covenReview',
      'Review: Loading...',
      column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webviews')],
        retainContextWhenHidden: true,
      }
    );

    const reviewPanel = new ReviewPanel(
      panel,
      extensionUri,
      client,
      sseClient,
      workflowId
    );

    ReviewPanel.panels.set(workflowId, reviewPanel);
    return reviewPanel;
  }

  /**
   * Get an existing panel for a workflow if one exists.
   */
  public static get(workflowId: string): ReviewPanel | undefined {
    return ReviewPanel.panels.get(workflowId);
  }

  /**
   * Close all review panels.
   */
  public static closeAll(): void {
    for (const panel of ReviewPanel.panels.values()) {
      panel.dispose();
    }
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

    this.router = new MessageRouter<ReviewMessageToExtension>()
      .on('ready', () => this.handleReady())
      .on('viewDiff', (msg) => this.handleViewDiff(msg.payload.filePath))
      .on('viewAllChanges', () => this.handleViewAllChanges())
      .on('runChecks', () => this.handleRunChecks())
      .on('approve', (msg) => this.handleApprove(msg.payload?.feedback))
      .on('reject', (msg) => this.handleReject(msg.payload?.reason))
      .on('refresh', () => this.fetchWorkflowReview())
      .on('overrideChecks', (msg) => this.handleOverrideChecks(msg.payload.reason));

    // Subscribe to SSE events
    this.subscribeToEvents();
  }

  protected getWebviewName(): string {
    return 'review';
  }

  protected async onMessage(message: ReviewMessageToExtension): Promise<void> {
    const handled = await this.router.route(message);
    if (!handled) {
      this.logger.warn('Unhandled message type in ReviewPanel', { type: message.type });
    }
  }

  public override dispose(): void {
    ReviewPanel.panels.delete(this.workflowId);
    this.unsubscribeFromEvents();
    super.dispose();
  }

  // ============================================================================
  // SSE Event Handling
  // ============================================================================

  private subscribeToEvents(): void {
    this.eventHandler = (event: SSEEvent) => {
      switch (event.type) {
        case 'workflow.completed':
        case 'workflow.failed':
          this.handleWorkflowEvent(event.data as WorkflowReviewEventData);
          break;
        case 'review.check.completed':
          void this.fetchWorkflowReview();
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

  private handleWorkflowEvent(data: WorkflowReviewEventData): void {
    if (data.workflowId !== this.workflowId) {
      return;
    }

    // Refresh state when workflow status changes
    void this.fetchWorkflowReview();
  }

  // ============================================================================
  // Message Handlers
  // ============================================================================

  private async handleReady(): Promise<void> {
    await this.fetchWorkflowReview();
  }

  private async fetchWorkflowReview(): Promise<void> {
    this.updateState({
      workflowId: this.workflowId,
      taskId: '',
      title: 'Loading...',
      description: '',
      changedFiles: [],
      totalLinesAdded: 0,
      totalLinesDeleted: 0,
      status: 'pending',
      checkResults: [],
      checksEnabled: false,
      isLoading: true,
    });

    try {
      const review = await this.client.getWorkflowReview(this.workflowId);

      this.currentState = {
        workflowId: review.workflowId,
        taskId: review.taskId,
        title: review.taskTitle,
        description: review.taskDescription,
        acceptanceCriteria: review.acceptanceCriteria,
        stepOutputs: review.stepOutputs,
        startedAt: review.startedAt,
        completedAt: review.completedAt,
        durationMs: review.durationMs,
        changedFiles: review.changes.files.map(toChangedFile),
        totalLinesAdded: review.changes.totalLinesAdded,
        totalLinesDeleted: review.changes.totalLinesDeleted,
        baseBranch: review.changes.baseBranch,
        headBranch: review.changes.headBranch,
        worktreePath: review.changes.worktreePath,
        commitCount: review.changes.commitCount,
      };

      // Update panel title
      this.panel.title = `Review: ${review.taskTitle.substring(0, 25)}${review.taskTitle.length > 25 ? '...' : ''}`;

      // Build agent summary from step outputs
      const agentSummary = this.buildAgentSummary(review.stepOutputs);

      this.sendState({
        ...this.currentState,
        agentSummary,
        status: 'pending',
        checkResults: [],
        checksEnabled: true, // TODO: Get from daemon config
        isLoading: false,
      } as ReviewState);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to fetch workflow review', {
        workflowId: this.workflowId,
        error: message,
      });
      this.updateState({
        workflowId: this.workflowId,
        taskId: '',
        title: 'Error',
        description: '',
        changedFiles: [],
        totalLinesAdded: 0,
        totalLinesDeleted: 0,
        status: 'pending',
        checkResults: [],
        checksEnabled: false,
        error: `Failed to load review: ${message}`,
        isLoading: false,
      });
    }
  }

  private buildAgentSummary(
    stepOutputs: Array<{ stepId: string; stepName: string; summary: string; exitCode?: number }>
  ): string | undefined {
    if (!stepOutputs || stepOutputs.length === 0) {
      return undefined;
    }

    return stepOutputs
      .map((step) => {
        const status = step.exitCode === 0 ? '✓' : step.exitCode !== undefined ? '✗' : '•';
        return `${status} ${step.stepName}: ${step.summary}`;
      })
      .join('\n');
  }

  private sendState(state: ReviewState): void {
    this.updateState(state);
  }

  private async handleViewDiff(filePath: string): Promise<void> {
    const worktreePath = this.currentState.worktreePath;
    const baseBranch = this.currentState.baseBranch ?? 'main';

    if (!worktreePath) {
      await vscode.window.showErrorMessage('Worktree path not available');
      return;
    }

    try {
      // Create URIs for the diff
      // Left: file at base branch, Right: file in worktree
      const leftUri = vscode.Uri.parse(
        `git://${worktreePath}/${filePath}?ref=${baseBranch}`
      );
      const rightUri = vscode.Uri.file(`${worktreePath}/${filePath}`);

      // Open diff editor
      await vscode.commands.executeCommand(
        'vscode.diff',
        leftUri,
        rightUri,
        `${filePath} (${baseBranch} ↔ workflow)`
      );
    } catch (err) {
      this.logger.error('Failed to open diff', {
        workflowId: this.workflowId,
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      await vscode.window.showErrorMessage(
        `Failed to open diff: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async handleViewAllChanges(): Promise<void> {
    const worktreePath = this.currentState.worktreePath;

    if (!worktreePath) {
      await vscode.window.showErrorMessage('Worktree path not available');
      return;
    }

    try {
      // Open the Source Control view for the worktree
      await vscode.commands.executeCommand('git.openRepository', worktreePath);
      await vscode.commands.executeCommand('workbench.view.scm');
    } catch (err) {
      this.logger.error('Failed to open all changes', {
        workflowId: this.workflowId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleRunChecks(): Promise<void> {
    try {
      // Update state to show checking
      this.updateState({
        ...this.currentState,
        status: 'checking',
        checkResults: [],
        checksEnabled: true,
        isLoading: false,
      } as ReviewState);

      // TODO: Call daemon endpoint for running checks
      // For now, simulate completion
      await vscode.window.showInformationMessage('Pre-merge checks requested');

      await this.fetchWorkflowReview();
    } catch (err) {
      this.logger.error('Failed to run checks', {
        workflowId: this.workflowId,
        error: err instanceof Error ? err.message : String(err),
      });
      this.postMessage({
        type: 'error',
        payload: {
          message: `Failed to run checks: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    }
  }

  private async handleApprove(feedback?: string): Promise<void> {
    try {
      await this.client.approveWorkflow(this.workflowId, feedback);
      await vscode.window.showInformationMessage('Workflow approved and merged successfully');
      this.dispose();
    } catch (err) {
      this.logger.error('Failed to approve workflow', {
        workflowId: this.workflowId,
        error: err instanceof Error ? err.message : String(err),
      });
      await vscode.window.showErrorMessage(
        `Failed to approve: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async handleReject(reason?: string): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      'Are you sure you want to reject? All changes will be discarded.',
      { modal: true },
      'Reject'
    );

    if (confirm !== 'Reject') {
      return;
    }

    try {
      await this.client.rejectWorkflow(this.workflowId, reason);
      await vscode.window.showInformationMessage('Workflow rejected. Changes have been discarded.');
      this.dispose();
    } catch (err) {
      this.logger.error('Failed to reject workflow', {
        workflowId: this.workflowId,
        error: err instanceof Error ? err.message : String(err),
      });
      await vscode.window.showErrorMessage(
        `Failed to reject: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async handleOverrideChecks(reason: string): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `Override failed checks? This may introduce issues.\n\nReason: ${reason}`,
      { modal: true },
      'Override and Approve'
    );

    if (confirm !== 'Override and Approve') {
      return;
    }

    this.logger.warn('Pre-merge checks overridden', { workflowId: this.workflowId, reason });

    try {
      await this.client.approveWorkflow(this.workflowId, `[Override: ${reason}]`);
      await vscode.window.showInformationMessage('Workflow approved with check override');
      this.dispose();
    } catch (err) {
      await vscode.window.showErrorMessage(
        `Failed to approve: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
