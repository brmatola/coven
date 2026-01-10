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
    const workflow = this.stateCache?.getWorkflow();
    const questions = this.stateCache?.getQuestions() ?? [];

    const running = workflow?.status === 'running' ? 1 : 0;
    const pendingQuestions = questions.length;

    let text: string;
    let icon: string;

    if (pendingQuestions > 0) {
      icon = '$(bell)';
      text = `${icon} Coven: ${pendingQuestions} awaiting response`;
      this.startPulse();
    } else if (running > 0) {
      icon = '$(sync~spin)';
      text = `${icon} Coven: ${running} running`;
    } else {
      icon = '$(circle-filled)';
      text = `${icon} Coven: Connected`;
    }

    this.statusBarItem.text = text;
    this.statusBarItem.command = 'coven.revealSidebar';

    // Build tooltip
    const tooltipParts = [
      `**Status:** Connected`,
      '',
      `**Workflows:** ${running} running`,
      `**Questions:** ${pendingQuestions} pending`,
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
    this.statusBarItem.text = '$(circle-outline) Coven: Disconnected';
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
