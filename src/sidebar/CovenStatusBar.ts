import * as vscode from 'vscode';
import { CovenSession } from '../session/CovenSession';
import { CovenState } from '../shared/types';

/**
 * Manages the Coven status bar item.
 * Shows session state summary and provides quick access to actions.
 */
export class CovenStatusBar implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private _session: CovenSession | null = null;
  private stateSubscription: (() => void) | null = null;
  private pulseInterval: ReturnType<typeof setInterval> | null = null;
  private isPulsing = false;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.name = 'Coven Session Status';
    this.updateInactive();
    this.statusBarItem.show();
  }

  /**
   * Connect to a CovenSession and subscribe to state changes.
   */
  setSession(session: CovenSession | null): void {
    // Unsubscribe from previous session
    if (this.stateSubscription) {
      this.stateSubscription();
      this.stateSubscription = null;
    }

    this._session = session;

    if (session) {
      const handler = (): void => {
        if (this._session) {
          this.update(this._session.getState());
        }
      };
      session.on('state:changed', handler);
      this.stateSubscription = (): void => {
        session.off('state:changed', handler);
      };

      // Initial update
      this.update(session.getState());
    } else {
      this.updateInactive();
    }
  }

  /**
   * Update the status bar based on current state.
   */
  private update(state: CovenState): void {
    this.stopPulse();

    switch (state.sessionStatus) {
      case 'inactive':
        this.updateInactive();
        break;
      case 'starting':
        this.updateStarting();
        break;
      case 'active':
      case 'paused':
        this.updateActive(state);
        break;
      case 'stopping':
        this.updateStopping();
        break;
    }
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
   * Show starting state.
   */
  private updateStarting(): void {
    this.statusBarItem.text = '$(sync~spin) Coven: Starting...';
    this.statusBarItem.tooltip = 'Session is starting...';
    this.statusBarItem.command = undefined;
    this.statusBarItem.backgroundColor = undefined;
  }

  /**
   * Show stopping state.
   */
  private updateStopping(): void {
    this.statusBarItem.text = '$(sync~spin) Coven: Stopping...';
    this.statusBarItem.tooltip = 'Session is stopping...';
    this.statusBarItem.command = undefined;
    this.statusBarItem.backgroundColor = undefined;
  }

  /**
   * Show active session state with summary.
   */
  private updateActive(state: CovenState): void {
    const working = state.tasks.working.length;
    const review = state.tasks.review.length;
    const pendingQuestions = state.pendingQuestions.length;

    // Build summary text
    const parts: string[] = [];
    if (working > 0) parts.push(`${working} working`);
    if (review > 0) parts.push(`${review} review`);

    let text: string;
    let icon: string;

    if (state.sessionStatus === 'paused') {
      icon = '$(debug-pause)';
      text = `${icon} Coven: Paused`;
    } else if (pendingQuestions > 0) {
      icon = '$(bell)';
      text = `${icon} Coven: ${pendingQuestions} awaiting response`;
      this.startPulse();
    } else if (parts.length > 0) {
      icon = '$(circle-filled)';
      text = `${icon} Coven: ${parts.join(', ')}`;
    } else {
      icon = '$(circle-filled)';
      text = `${icon} Coven: Active`;
    }

    this.statusBarItem.text = text;
    this.statusBarItem.command = 'coven.revealSidebar';

    // Build tooltip
    const tooltipParts = [
      `**Branch:** ${state.featureBranch ?? 'Unknown'}`,
      `**Status:** ${state.sessionStatus}`,
      '',
      `**Tasks:**`,
      `  Ready: ${state.tasks.ready.length}`,
      `  Working: ${state.tasks.working.length}`,
      `  Review: ${state.tasks.review.length}`,
      `  Done: ${state.tasks.done.length}`,
      `  Blocked: ${state.tasks.blocked.length}`,
    ];

    if (pendingQuestions > 0) {
      tooltipParts.push('', `**⚠️ ${pendingQuestions} question(s) need your response**`);
    }

    tooltipParts.push('', '_Click to reveal sidebar_');

    this.statusBarItem.tooltip = new vscode.MarkdownString(tooltipParts.join('\n'));
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
    if (this.stateSubscription) {
      this.stateSubscription();
    }
    this.statusBarItem.dispose();
  }
}
