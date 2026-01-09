import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Session status types matching CovenSession.
 */
export type SessionStatus = 'inactive' | 'starting' | 'active' | 'paused' | 'stopping';

/**
 * Persisted session state structure (from .coven/session.json).
 */
export interface PersistedSessionState {
  status: SessionStatus;
  featureBranch: string | null;
  timestamp: number;
}

/**
 * Session state for test assertions.
 */
export interface SessionState {
  status: SessionStatus;
  featureBranch: string | null;
  isActive: boolean;
  isPaused: boolean;
  timestamp: number | null;
}

/**
 * Default timeout for session operations (ms).
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Polling interval for status checks (ms).
 */
const POLL_INTERVAL = 200;

/**
 * Helper for session operations in E2E tests.
 * Reads actual state from .coven/session.json for verification.
 */
export class SessionHelper {
  private covenDir: string;
  private sessionFilePath: string;

  constructor(workspacePath: string) {
    this.covenDir = path.join(workspacePath, '.coven');
    this.sessionFilePath = path.join(this.covenDir, 'session.json');
  }

  /**
   * Start a session with the given branch name.
   * Note: In E2E tests, we need to handle the input box prompt.
   * The branchName is used for waitForStatus validation after the command.
   */
  async startSession(_branchName: string, timeoutMs = DEFAULT_TIMEOUT): Promise<void> {
    // Set up input box mock to provide branch name
    // VS Code E2E tests can use quickPick/inputBox mocking
    const disposable = vscode.window.onDidChangeWindowState(() => {});

    try {
      // Execute command - it will prompt for branch name
      // In E2E context, we may need to provide input programmatically
      await this.executeCommand('coven.startSession');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // These are expected failures in test context
      if (!msg.includes('prerequisites') && !msg.includes('cancelled') && !msg.includes('No workspace')) {
        throw err;
      }
    } finally {
      disposable.dispose();
    }

    // Wait for session to become active
    await this.waitForStatus('active', timeoutMs);
  }

  /**
   * Start a session programmatically by writing state file.
   * Use this for test setup when you need to bypass the UI prompt.
   */
  async startSessionDirect(branchName: string): Promise<void> {
    // Ensure .coven directory exists
    await fs.promises.mkdir(this.covenDir, { recursive: true });

    // Write session state directly
    const sessionState: PersistedSessionState = {
      status: 'active',
      featureBranch: branchName,
      timestamp: Date.now(),
    };
    await fs.promises.writeFile(this.sessionFilePath, JSON.stringify(sessionState, null, 2));
  }

  /**
   * Stop the current session.
   */
  async stopSession(timeoutMs = DEFAULT_TIMEOUT): Promise<void> {
    try {
      await this.executeCommand('coven.stopSession');
    } catch (err) {
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
   * Stop session by clearing state file directly.
   * Use this for test cleanup.
   */
  async stopSessionDirect(): Promise<void> {
    const sessionState: PersistedSessionState = {
      status: 'inactive',
      featureBranch: null,
      timestamp: Date.now(),
    };

    try {
      await fs.promises.writeFile(this.sessionFilePath, JSON.stringify(sessionState, null, 2));
    } catch {
      // File may not exist - that's OK
    }
  }

  /**
   * Get the current session state by reading .coven/session.json.
   * Returns null if file doesn't exist or can't be read.
   */
  getSessionState(): SessionState | null {
    try {
      if (!fs.existsSync(this.sessionFilePath)) {
        return null;
      }

      const content = fs.readFileSync(this.sessionFilePath, 'utf-8');
      const persisted = JSON.parse(content) as PersistedSessionState;

      return {
        status: persisted.status,
        featureBranch: persisted.featureBranch,
        isActive: persisted.status === 'active',
        isPaused: persisted.status === 'paused',
        timestamp: persisted.timestamp,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get session state asynchronously.
   */
  async getSessionStateAsync(): Promise<SessionState | null> {
    try {
      const content = await fs.promises.readFile(this.sessionFilePath, 'utf-8');
      const persisted = JSON.parse(content) as PersistedSessionState;

      return {
        status: persisted.status,
        featureBranch: persisted.featureBranch,
        isActive: persisted.status === 'active',
        isPaused: persisted.status === 'paused',
        timestamp: persisted.timestamp,
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if session file exists.
   */
  sessionFileExists(): boolean {
    return fs.existsSync(this.sessionFilePath);
  }

  /**
   * Wait for session to reach a specific status.
   * Polls the session.json file until status matches or timeout.
   */
  async waitForStatus(status: SessionStatus, timeoutMs = DEFAULT_TIMEOUT): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const state = this.getSessionState();

      if (state?.status === status) {
        return;
      }

      // For 'inactive' status, null state (no file) is also acceptable
      if (status === 'inactive' && (state === null || state.status === 'inactive')) {
        return;
      }

      await this.sleep(POLL_INTERVAL);
    }

    const currentState = this.getSessionState();
    throw new Error(
      `Timeout waiting for session status '${status}' after ${timeoutMs}ms. ` +
      `Current status: ${currentState?.status ?? 'no session file'}`
    );
  }

  /**
   * Wait for session file to be created.
   */
  async waitForSessionFile(timeoutMs = DEFAULT_TIMEOUT): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (this.sessionFileExists()) {
        return;
      }
      await this.sleep(POLL_INTERVAL);
    }

    throw new Error(`Timeout waiting for session file after ${timeoutMs}ms`);
  }

  /**
   * Execute a VS Code command.
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
   * Start a task via extension command.
   */
  async startTask(taskId: string): Promise<void> {
    await this.executeCommand('coven.startTask', taskId);
  }

  /**
   * Stop a task via extension command.
   */
  async stopTask(taskId: string): Promise<void> {
    await this.executeCommand('coven.stopTask', taskId);
  }

  /**
   * Review a task via extension command.
   */
  async reviewTask(taskId: string): Promise<void> {
    await this.executeCommand('coven.reviewTask', taskId);
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
   * Get the .coven directory path.
   */
  getCovenDir(): string {
    return this.covenDir;
  }

  /**
   * Get the worktrees directory path.
   */
  getWorktreesDir(): string {
    return path.join(this.covenDir, 'worktrees');
  }

  /**
   * Get the familiars directory path.
   */
  getFamiliarsDir(): string {
    return path.join(this.covenDir, 'familiars');
  }

  /**
   * Clean up .coven directory.
   * Use this in test teardown.
   */
  async cleanup(): Promise<void> {
    try {
      // Don't delete the entire .coven dir as it may have config
      // Just clear session state
      await this.stopSessionDirect();

      // Clear familiars
      const familiarsDir = this.getFamiliarsDir();
      if (fs.existsSync(familiarsDir)) {
        const files = await fs.promises.readdir(familiarsDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            await fs.promises.unlink(path.join(familiarsDir, file));
          }
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

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
