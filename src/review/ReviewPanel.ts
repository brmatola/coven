/**
 * ReviewPanel provides the webview UI for reviewing agent-completed work.
 * Shows changed files, acceptance criteria, and approval/revert actions.
 */

import * as vscode from 'vscode';
import { WebviewPanel } from '../shared/webview/WebviewPanel';
import { MessageRouter } from '../shared/messageRouter';
import { getLogger } from '../shared/logger';
import { ReviewManager } from './ReviewManager';
import { WorktreeManager } from '../git/WorktreeManager';
import { BeadsTaskSource } from '../tasks/BeadsTaskSource';
import { FamiliarManager } from '../agents/FamiliarManager';
import {
  ReviewState,
  ReviewMessageToExtension,
} from './types';

/**
 * Panel for reviewing completed agent work.
 */
export class ReviewPanel extends WebviewPanel<ReviewState, ReviewMessageToExtension> {
  private static panels = new Map<string, ReviewPanel>();

  private readonly router: MessageRouter<ReviewMessageToExtension>;
  private readonly reviewManager: ReviewManager;
  private readonly worktreeManager: WorktreeManager;
  private readonly beadsTaskSource: BeadsTaskSource;
  private readonly familiarManager: FamiliarManager;
  private readonly taskId: string;
  private readonly logger = getLogger();

  /**
   * Create or reveal a review panel for the given task.
   */
  public static async createOrShow(
    extensionUri: vscode.Uri,
    reviewManager: ReviewManager,
    worktreeManager: WorktreeManager,
    beadsTaskSource: BeadsTaskSource,
    familiarManager: FamiliarManager,
    taskId: string
  ): Promise<ReviewPanel | null> {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    // Check if panel already exists for this task
    const existing = ReviewPanel.panels.get(taskId);
    if (existing) {
      existing.reveal(column);
      existing.refreshState();
      return existing;
    }

    // Verify task exists and is in review status
    const task = beadsTaskSource.getTask(taskId);
    if (!task) {
      await vscode.window.showErrorMessage(`Task not found: ${taskId}`);
      return null;
    }

    if (task.status !== 'review') {
      await vscode.window.showWarningMessage(
        `Task is not ready for review. Current status: ${task.status}`
      );
      return null;
    }

    const panel = vscode.window.createWebviewPanel(
      'covenReview',
      `Review: ${task.title.substring(0, 25)}${task.title.length > 25 ? '...' : ''}`,
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
      reviewManager,
      worktreeManager,
      beadsTaskSource,
      familiarManager,
      taskId
    );

    ReviewPanel.panels.set(taskId, reviewPanel);

    // Start the review
    await reviewManager.startReview(taskId);
    reviewPanel.refreshState();

    return reviewPanel;
  }

  /**
   * Get an existing panel for a task if one exists.
   */
  public static get(taskId: string): ReviewPanel | undefined {
    return ReviewPanel.panels.get(taskId);
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
    reviewManager: ReviewManager,
    worktreeManager: WorktreeManager,
    beadsTaskSource: BeadsTaskSource,
    familiarManager: FamiliarManager,
    taskId: string
  ) {
    super(panel, extensionUri);
    this.reviewManager = reviewManager;
    this.worktreeManager = worktreeManager;
    this.beadsTaskSource = beadsTaskSource;
    this.familiarManager = familiarManager;
    this.taskId = taskId;

    this.router = new MessageRouter<ReviewMessageToExtension>()
      .on('viewDiff', (msg) => this.handleViewDiff(msg.payload.filePath))
      .on('viewAllChanges', () => this.handleViewAllChanges())
      .on('runChecks', () => this.handleRunChecks())
      .on('approve', (msg) => this.handleApprove(msg.payload?.feedback))
      .on('revert', (msg) => this.handleRevert(msg.payload?.reason))
      .on('refresh', () => this.refreshState())
      .on('overrideChecks', (msg) => this.handleOverrideChecks(msg.payload.reason));

    // Listen for review events
    this.setupReviewEventListeners();
  }

  protected getWebviewName(): string {
    return 'review';
  }

  protected onMessage(message: ReviewMessageToExtension): void {
    void this.router.route(message);
  }

  public override dispose(): void {
    ReviewPanel.panels.delete(this.taskId);
    super.dispose();
  }

  /**
   * Refresh the panel state from current data.
   */
  refreshState(): void {
    const state = this.buildState();
    this.updateState(state);
  }

  private buildState(): ReviewState {
    const task = this.beadsTaskSource.getTask(this.taskId);
    const review = this.reviewManager.getReview(this.taskId);
    const familiar = this.familiarManager.getFamiliar(this.taskId);
    const preMergeChecksConfig = this.reviewManager.getPreMergeChecksConfig();

    const changedFiles = review?.changedFiles ?? [];
    const totalLinesAdded = changedFiles.reduce((sum, f) => sum + f.linesAdded, 0);
    const totalLinesDeleted = changedFiles.reduce((sum, f) => sum + f.linesDeleted, 0);

    // Calculate duration if we have familiar info
    let durationMs: number | undefined;
    let completedAt: number | undefined;
    if (familiar) {
      completedAt = Date.now();
      durationMs = completedAt - familiar.spawnedAt;
    }

    return {
      taskId: this.taskId,
      title: task?.title ?? 'Unknown Task',
      description: task?.description ?? '',
      acceptanceCriteria: task?.acceptanceCriteria,
      agentSummary: this.getAgentSummary(familiar),
      completedAt,
      durationMs,
      changedFiles,
      totalLinesAdded,
      totalLinesDeleted,
      status: review?.status ?? 'pending',
      checkResults: review?.checkResults ?? [],
      checksEnabled: preMergeChecksConfig.enabled,
    };
  }

  private getAgentSummary(familiar: ReturnType<FamiliarManager['getFamiliar']>): string | undefined {
    if (!familiar) return undefined;

    // Extract summary from output buffer if available
    const outputLines = familiar.outputBuffer;
    if (outputLines.length > 0) {
      // Look for common summary patterns
      const summaryIndex = outputLines.findIndex(
        (line) =>
          line.toLowerCase().includes('summary') ||
          line.toLowerCase().includes('completed') ||
          line.toLowerCase().includes('done')
      );

      if (summaryIndex >= 0) {
        return outputLines.slice(summaryIndex).join('\n');
      }

      // Return last few lines as summary
      return outputLines.slice(-5).join('\n');
    }

    return undefined;
  }

  private async handleViewDiff(filePath: string): Promise<void> {
    const worktree = this.worktreeManager.getWorktree(this.taskId);
    if (!worktree) {
      await vscode.window.showErrorMessage('Worktree not found for this task');
      return;
    }

    try {
      // Get the feature branch to compare against
      const featureBranch = await this.getFeatureBranch(worktree.path);

      // Create URIs for the diff
      const leftUri = vscode.Uri.parse(
        `git://${worktree.path}/${filePath}?ref=${featureBranch}`
      );
      const rightUri = vscode.Uri.file(`${worktree.path}/${filePath}`);

      // Open diff editor
      await vscode.commands.executeCommand(
        'vscode.diff',
        leftUri,
        rightUri,
        `${filePath} (${featureBranch} ↔ task branch)`
      );
    } catch (err) {
      this.logger.error('Failed to open diff', {
        taskId: this.taskId,
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      await vscode.window.showErrorMessage(`Failed to open diff: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async handleViewAllChanges(): Promise<void> {
    const worktree = this.worktreeManager.getWorktree(this.taskId);
    if (!worktree) {
      await vscode.window.showErrorMessage('Worktree not found for this task');
      return;
    }

    try {
      // Open the Source Control view for the worktree
      await vscode.commands.executeCommand('git.openRepository', worktree.path);
      await vscode.commands.executeCommand('workbench.view.scm');
    } catch (err) {
      this.logger.error('Failed to open all changes', {
        taskId: this.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleRunChecks(): Promise<void> {
    try {
      this.postMessage({ type: 'state', payload: { ...this.buildState(), status: 'checking' } });
      await this.reviewManager.runPreMergeChecks(this.taskId);
      this.refreshState();
    } catch (err) {
      this.logger.error('Failed to run checks', {
        taskId: this.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
      this.postMessage({
        type: 'error',
        payload: { message: `Failed to run checks: ${err instanceof Error ? err.message : String(err)}` },
      });
    }
  }

  private async handleApprove(feedback?: string): Promise<void> {
    const preMergeChecksConfig = this.reviewManager.getPreMergeChecksConfig();

    // Check if we need to run pre-merge checks first
    if (preMergeChecksConfig.enabled) {
      const review = this.reviewManager.getReview(this.taskId);
      const hasFailedChecks = review?.checkResults.some((r) => r.status === 'failed');
      const hasRunChecks = (review?.checkResults.length ?? 0) > 0;

      if (!hasRunChecks) {
        const choice = await vscode.window.showWarningMessage(
          'Pre-merge checks are enabled but haven\'t been run. Run checks first?',
          'Run Checks',
          'Skip Checks'
        );

        if (choice === 'Run Checks') {
          await this.handleRunChecks();
          return;
        }
      } else if (hasFailedChecks) {
        await vscode.window.showErrorMessage(
          'Cannot approve: pre-merge checks failed. Fix issues or use override.'
        );
        return;
      }
    }

    try {
      await this.reviewManager.approve(this.taskId, feedback);
      await vscode.window.showInformationMessage('Task approved and merged successfully');
      this.dispose();
    } catch (err) {
      this.logger.error('Failed to approve task', {
        taskId: this.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
      await vscode.window.showErrorMessage(
        `Failed to approve: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async handleRevert(reason?: string): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      'Are you sure you want to revert? All changes will be discarded.',
      { modal: true },
      'Revert'
    );

    if (confirm !== 'Revert') {
      return;
    }

    try {
      await this.reviewManager.revert(this.taskId, reason);
      await vscode.window.showInformationMessage('Task reverted. Changes have been discarded.');
      this.dispose();
    } catch (err) {
      this.logger.error('Failed to revert task', {
        taskId: this.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
      await vscode.window.showErrorMessage(
        `Failed to revert: ${err instanceof Error ? err.message : String(err)}`
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

    this.logger.warn('Pre-merge checks overridden', { taskId: this.taskId, reason });

    try {
      await this.reviewManager.approve(this.taskId, `[Override: ${reason}]`);
      await vscode.window.showInformationMessage('Task approved with check override');
      this.dispose();
    } catch (err) {
      await vscode.window.showErrorMessage(
        `Failed to approve: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async getFeatureBranch(worktreePath: string): Promise<string> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const { stdout } = await execAsync(
        'git rev-parse --abbrev-ref @{upstream} 2>/dev/null || echo main',
        { cwd: worktreePath }
      );
      return stdout.trim().replace('origin/', '') || 'main';
    } catch {
      return 'main';
    }
  }

  private setupReviewEventListeners(): void {
    const handleCheckCompleted = (event: { taskId: string; result: unknown }): void => {
      if (event.taskId === this.taskId) {
        void this.refreshState();
      }
    };

    this.reviewManager.on('check:completed', handleCheckCompleted);

    this.disposables.push({
      dispose: () => {
        this.reviewManager.off('check:completed', handleCheckCompleted);
      },
    });
  }
}
