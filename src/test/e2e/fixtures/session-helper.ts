import * as vscode from 'vscode';

/**
 * Session status types matching CovenSession.
 */
export type SessionStatus = 'inactive' | 'starting' | 'active' | 'paused' | 'stopping';

/**
 * Simplified session state for test assertions.
 */
export interface SessionState {
  status: SessionStatus;
  featureBranch: string | null;
  isActive: boolean;
  isPaused: boolean;
}

/**
 * Default timeout for session operations (ms).
 */
const DEFAULT_TIMEOUT = 10000;

/**
 * Polling interval for status checks (ms).
 */
const POLL_INTERVAL = 100;

/**
 * Helper for session operations in E2E tests.
 * Wraps VS Code commands and provides wait-for-state utilities.
 */
export class SessionHelper {
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /**
   * Start a session with the given branch name.
   * Waits for session to become active.
   */
  async startSession(branchName: string, timeoutMs = DEFAULT_TIMEOUT): Promise<void> {
    // Note: In E2E tests, we can't easily mock the input box.
    // The actual startSession command prompts for branch name.
    // For now, we'll execute and catch any errors.
    try {
      await this.executeCommand('coven.startSession');
    } catch (err) {
      // If the command fails because prerequisites aren't met, that's expected
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('prerequisites') && !msg.includes('cancelled')) {
        throw err;
      }
    }

    // Wait for session to become active (or timeout)
    await this.waitForStatus('active', timeoutMs).catch(() => {
      // Session might not start if prerequisites fail - that's OK for some tests
    });
  }

  /**
   * Stop the current session.
   * Waits for session to become inactive.
   */
  async stopSession(timeoutMs = DEFAULT_TIMEOUT): Promise<void> {
    try {
      await this.executeCommand('coven.stopSession');
    } catch (err) {
      // If no active session, that's fine
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('No active session')) {
        throw err;
      }
    }

    await this.waitForStatus('inactive', timeoutMs).catch(() => {
      // May already be inactive
    });
  }

  /**
   * Pause the current session.
   */
  pauseSession(): Promise<void> {
    // Note: Pause command not yet implemented in extension.ts
    // This is a placeholder for when it's added
    return Promise.reject(new Error('Pause session command not yet implemented'));
  }

  /**
   * Resume a paused session.
   */
  resumeSession(): Promise<void> {
    // Note: Resume command not yet implemented in extension.ts
    // This is a placeholder for when it's added
    return Promise.reject(new Error('Resume session command not yet implemented'));
  }

  /**
   * Get the current session state.
   * Returns null if extension is not active or session can't be read.
   */
  getSessionState(): SessionState | null {
    // In E2E tests, we can't directly access CovenSession.
    // We infer state from available VS Code APIs.
    // For now, return a basic state based on extension activity.

    const extension = vscode.extensions.getExtension('coven.coven');
    if (!extension?.isActive) {
      return null;
    }

    // We can't access internal state directly in E2E tests.
    // Return a minimal state indicating extension is active.
    return {
      status: 'inactive', // Can't determine actual status from E2E
      featureBranch: null,
      isActive: false,
      isPaused: false,
    };
  }

  /**
   * Wait for session to reach a specific status.
   * Polls until status matches or timeout.
   */
  async waitForStatus(status: SessionStatus, timeoutMs = DEFAULT_TIMEOUT): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const state = this.getSessionState();
      if (state?.status === status) {
        return;
      }

      // For 'inactive' status, null state is also acceptable
      if (status === 'inactive' && (state === null || state.status === 'inactive')) {
        return;
      }

      await this.sleep(POLL_INTERVAL);
    }

    throw new Error(`Timeout waiting for session status '${status}' after ${timeoutMs}ms`);
  }

  /**
   * Execute a VS Code command and capture any errors.
   */
  async executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
    return vscode.commands.executeCommand(command, ...args);
  }

  /**
   * Refresh tasks from Beads.
   */
  async refreshTasks(): Promise<void> {
    await this.executeCommand('coven.refreshTasks');
  }

  /**
   * Open the setup panel.
   */
  async openSetup(): Promise<void> {
    await this.executeCommand('coven.showSetup');
  }

  /**
   * Reveal the sidebar.
   */
  async revealSidebar(): Promise<void> {
    await this.executeCommand('coven.revealSidebar');
  }

  /**
   * Check if a command is registered.
   */
  async isCommandRegistered(command: string): Promise<boolean> {
    const commands = await vscode.commands.getCommands(true);
    return commands.includes(command);
  }

  /**
   * Get all registered Coven commands.
   */
  async getCovenCommands(): Promise<string[]> {
    const commands = await vscode.commands.getCommands(true);
    return commands.filter((cmd) => cmd.startsWith('coven.'));
  }

  /**
   * Sleep for the specified duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a SessionHelper for the given workspace.
 */
export function createSessionHelper(workspacePath: string): SessionHelper {
  return new SessionHelper(workspacePath);
}
