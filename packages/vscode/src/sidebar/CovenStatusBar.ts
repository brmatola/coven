import * as vscode from 'vscode';
import { StateCache, SessionState } from '../daemon/cache';
import { WorkflowState } from '../daemon/types';

/**
 * Manages the Coven status bar item.
 * Shows daemon connection status and provides quick access to actions.
 */
export class CovenStatusBar implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private stateCache: StateCache | null = null;
  private workflowChangeHandler: ((workflow: WorkflowState) => void) | null = null;
  private pulseInterval: ReturnType<typeof setInterval> | null = null;
  private isPulsing = false;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.name = 'Coven Session Status';
    this.updateDisconnected();
    this.statusBarItem.show();
  }

  /**
   * Connect to a StateCache and subscribe to session changes.
   */
  setStateCache(cache: StateCache | null): void {
    // Unsubscribe from previous cache
    if (this.stateCache && this.workflowChangeHandler) {
      this.stateCache.off('workflows.changed', this.workflowChangeHandler);
      this.workflowChangeHandler = null;
    }

    this.stateCache = cache;

    if (cache) {
      this.workflowChangeHandler = (): void => {
        this.updateFromSession(cache.getSessionState());
      };
      cache.on('workflows.changed', this.workflowChangeHandler);

      // Initial update
      this.updateFromSession(cache.getSessionState());
    } else {
      this.updateDisconnected();
    }
  }

  /**
   * Update the status bar based on session state.
   */
  private updateFromSession(state: SessionState): void {
    this.stopPulse();

    if (!state.active) {
      this.updateInactive();
      return;
    }

    // Active session - get workflow info
    const workflows = this.stateCache?.getWorkflows() ?? [];
    const questions = this.stateCache?.getQuestions() ?? [];

    // Count active (running) and pending (pending_merge, blocked) workflows
    const active = workflows.filter((w) => w.status === 'running').length;
    const pending = workflows.filter(
      (w) => w.status === 'pending_merge' || w.status === 'blocked'
    ).length;
    const pendingQuestions = questions.length;

    let text: string;

    if (pendingQuestions > 0) {
      text = `$(bell) covend: ${pendingQuestions} awaiting response`;
      this.startPulse();
    } else if (active > 0) {
      text = `$(sync~spin) covend: ${active} active, ${pending} pending`;
    } else if (pending > 0) {
      text = `$(broadcast) covend: ${active} active, ${pending} pending`;
    } else {
      text = `$(broadcast) covend: 0 active, 0 pending`;
    }

    this.statusBarItem.text = text;
    this.statusBarItem.command = 'coven.revealSidebar';

    // Build tooltip
    const tooltipParts = [
      `**Status:** Connected`,
      '',
      `**Active workflows:** ${active}`,
      `**Pending review:** ${pending}`,
      `**Questions:** ${pendingQuestions}`,
    ];

    if (pendingQuestions > 0) {
      tooltipParts.push('', `**Questions need your response**`);
    }

    tooltipParts.push('', '_Click to reveal sidebar_');

    this.statusBarItem.tooltip = new vscode.MarkdownString(tooltipParts.join('\n'));
  }

  /**
   * Show disconnected state.
   */
  private updateDisconnected(): void {
    this.statusBarItem.text = '$(circle-outline) covend: disconnected';
    this.statusBarItem.tooltip = 'Daemon not connected';
    this.statusBarItem.command = 'coven.startSession';
    this.statusBarItem.backgroundColor = undefined;
  }

  /**
   * Show inactive state.
   */
  private updateInactive(): void {
    this.statusBarItem.text = '$(circle-outline) Coven: Inactive';
    this.statusBarItem.tooltip = 'Click to start a Coven session';
    this.statusBarItem.command = 'coven.startSession';
    this.statusBarItem.backgroundColor = undefined;
  }

  /**
   * Show not initialized state when .coven/ directory is missing.
   */
  setNotInitialized(): void {
    this.stopPulse();
    this.statusBarItem.text = '$(warning) Coven: not initialized';
    this.statusBarItem.tooltip = new vscode.MarkdownString(
      '**Coven is not initialized in this workspace**\n\n' +
      'Run `coven init` or click to set up.\n\n' +
      '_Click to initialize workspace_'
    );
    this.statusBarItem.command = 'coven.showSetup';
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  /**
   * Show connected state.
   */
  setConnected(): void {
    // If we have a state cache, let it drive the status
    if (this.stateCache) {
      this.updateFromSession(this.stateCache.getSessionState());
    } else {
      this.statusBarItem.text = '$(broadcast) covend: 0 active, 0 pending';
      this.statusBarItem.tooltip = 'Connected to Coven daemon';
      this.statusBarItem.command = 'coven.revealSidebar';
      this.statusBarItem.backgroundColor = undefined;
    }
  }

  /**
   * Show disconnected state.
   */
  setDisconnected(): void {
    this.stopPulse();
    this.statusBarItem.text = '$(warning) covend: disconnected';
    this.statusBarItem.tooltip = new vscode.MarkdownString(
      '**Connection to daemon lost**\n\n' +
      '_Click to retry connection_'
    );
    this.statusBarItem.command = 'coven.startSession';
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  /**
   * Start pulsing the status bar to attract attention.
   */
  private startPulse(): void {
    if (this.isPulsing) return;
    this.isPulsing = true;

    // Use warning background color to highlight
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  /**
   * Stop pulsing the status bar.
   */
  private stopPulse(): void {
    if (!this.isPulsing) return;
    this.isPulsing = false;

    if (this.pulseInterval) {
      clearInterval(this.pulseInterval);
      this.pulseInterval = null;
    }
    this.statusBarItem.backgroundColor = undefined;
  }

  /**
   * Get the underlying status bar item for disposal tracking.
   */
  getStatusBarItem(): vscode.StatusBarItem {
    return this.statusBarItem;
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.stopPulse();
    if (this.stateCache && this.workflowChangeHandler) {
      this.stateCache.off('workflows.changed', this.workflowChangeHandler);
    }
    this.statusBarItem.dispose();
  }
}
