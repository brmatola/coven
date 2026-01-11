/**
 * UI state verification helper for E2E tests.
 *
 * Provides utilities to query and assert on UI state
 * by executing test commands in the extension.
 */
import * as vscode from 'vscode';

/**
 * Tree view state snapshot matching WorkflowTreeProvider.getStateSnapshot().
 */
export interface TreeViewState {
  active: string[];
  questions: string[];
  ready: string[];
  blocked: string[];
  completed: string[];
  isConnected: boolean;
}

/**
 * Status bar state snapshot matching CovenStatusBar.getStateSnapshot().
 */
export interface StatusBarState {
  text: string;
  tooltip: string;
  isConnected: boolean;
  isNotInitialized: boolean;
  activeCount: number;
  pendingCount: number;
  questionCount: number;
  hasWarningBackground: boolean;
}

/**
 * Cache state snapshot from the daemon.
 */
export interface CacheState {
  isInitialized: boolean;
  tasks: unknown[];
  agents: unknown[];
  questions: unknown[];
  workflow: unknown;
  session: unknown;
}

/**
 * Section types for the tree view.
 */
export type SectionType = 'active' | 'questions' | 'ready' | 'blocked' | 'completed';

/**
 * Helper for verifying UI state in E2E tests.
 *
 * Uses internal test commands (coven._*) to query extension state.
 * These commands are only registered when COVEN_E2E_MODE=true.
 *
 * Usage:
 * ```typescript
 * const ui = new UIStateVerifier();
 * await ui.waitForTaskInSection(taskId, 'active', 5000);
 * const status = await ui.getStatusBarState();
 * assert.equal(status.activeCount, 1);
 * ```
 */
export class UIStateVerifier {
  private readonly pollIntervalMs: number;

  constructor(pollIntervalMs = 100) {
    this.pollIntervalMs = pollIntervalMs;
  }

  /**
   * Get the current tree view state.
   *
   * @returns Tree view state or null if not available
   */
  async getTreeViewState(): Promise<TreeViewState | null> {
    try {
      const state = await vscode.commands.executeCommand<TreeViewState>(
        'coven._getTreeViewState'
      );
      return state ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Get the current status bar state.
   *
   * @returns Status bar state or null if not available
   */
  async getStatusBarState(): Promise<StatusBarState | null> {
    try {
      const state = await vscode.commands.executeCommand<StatusBarState>(
        'coven._getStatusBarState'
      );
      return state ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Get the current cache state.
   *
   * @returns Cache state or null if not available
   */
  async getCacheState(): Promise<CacheState | null> {
    try {
      const state = await vscode.commands.executeCommand<CacheState>(
        'coven._getCacheState'
      );
      return state ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Check if the extension is connected to daemon.
   */
  async isConnected(): Promise<boolean> {
    try {
      const connected = await vscode.commands.executeCommand<boolean>(
        'coven._isConnected'
      );
      return connected ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Wait for a task to appear in a specific section.
   *
   * @param taskId Task ID to look for
   * @param section Section where task should appear
   * @param timeout Maximum time to wait in ms
   * @throws Error if timeout expires
   */
  async waitForTaskInSection(
    taskId: string,
    section: SectionType,
    timeout = 5000
  ): Promise<void> {
    const endTime = Date.now() + timeout;

    while (Date.now() < endTime) {
      const state = await this.getTreeViewState();
      if (state && state[section].includes(taskId)) {
        return;
      }
      await this.delay(this.pollIntervalMs);
    }

    // Get final state for error message
    const finalState = await this.getTreeViewState();
    throw new Error(
      `Task ${taskId} did not appear in '${section}' section within ${timeout}ms. ` +
        `Current state: ${JSON.stringify(finalState)}`
    );
  }

  /**
   * Wait for a task to NOT be in any section (removed from tree view).
   *
   * @param taskId Task ID to check
   * @param timeout Maximum time to wait in ms
   */
  async waitForTaskRemoved(taskId: string, timeout = 5000): Promise<void> {
    const endTime = Date.now() + timeout;

    while (Date.now() < endTime) {
      const state = await this.getTreeViewState();
      if (state) {
        const allSections = [
          ...state.active,
          ...state.questions,
          ...state.ready,
          ...state.blocked,
          ...state.completed,
        ];
        if (!allSections.includes(taskId)) {
          return;
        }
      }
      await this.delay(this.pollIntervalMs);
    }

    throw new Error(`Task ${taskId} was not removed within ${timeout}ms`);
  }

  /**
   * Wait for status bar to match a predicate.
   *
   * @param predicate Function that returns true when condition is met
   * @param timeout Maximum time to wait in ms
   * @param description Description of what we're waiting for (for error messages)
   */
  async waitForStatusBar(
    predicate: (state: StatusBarState) => boolean,
    timeout = 5000,
    description = 'status bar condition'
  ): Promise<StatusBarState> {
    const endTime = Date.now() + timeout;

    while (Date.now() < endTime) {
      const state = await this.getStatusBarState();
      if (state && predicate(state)) {
        return state;
      }
      await this.delay(this.pollIntervalMs);
    }

    const finalState = await this.getStatusBarState();
    throw new Error(
      `Timeout waiting for ${description} after ${timeout}ms. ` +
        `Final state: ${JSON.stringify(finalState)}`
    );
  }

  /**
   * Wait for status bar to show connected state.
   */
  async waitForConnected(timeout = 10000): Promise<void> {
    await this.waitForStatusBar(
      (state) => state.isConnected,
      timeout,
      'daemon connection'
    );
  }

  /**
   * Wait for status bar to show disconnected state.
   */
  async waitForDisconnected(timeout = 5000): Promise<void> {
    await this.waitForStatusBar(
      (state) => !state.isConnected,
      timeout,
      'daemon disconnection'
    );
  }

  /**
   * Wait for a question to appear in the tree view.
   *
   * @param taskId Task ID that should have a question
   * @param timeout Maximum time to wait in ms
   */
  async waitForQuestion(taskId: string, timeout = 10000): Promise<void> {
    await this.waitForTaskInSection(taskId, 'questions', timeout);
  }

  /**
   * Wait for status bar to show active workflows.
   *
   * @param count Expected number of active workflows
   * @param timeout Maximum time to wait in ms
   */
  async waitForActiveCount(count: number, timeout = 5000): Promise<void> {
    await this.waitForStatusBar(
      (state) => state.activeCount === count,
      timeout,
      `${count} active workflows`
    );
  }

  /**
   * Wait for tree view to show specific state.
   *
   * @param predicate Function that returns true when condition is met
   * @param timeout Maximum time to wait in ms
   * @param description Description of what we're waiting for
   */
  async waitForTreeState(
    predicate: (state: TreeViewState) => boolean,
    timeout = 5000,
    description = 'tree view condition'
  ): Promise<TreeViewState> {
    const endTime = Date.now() + timeout;

    while (Date.now() < endTime) {
      const state = await this.getTreeViewState();
      if (state && predicate(state)) {
        return state;
      }
      await this.delay(this.pollIntervalMs);
    }

    const finalState = await this.getTreeViewState();
    throw new Error(
      `Timeout waiting for ${description} after ${timeout}ms. ` +
        `Final state: ${JSON.stringify(finalState)}`
    );
  }

  /**
   * Assert that the tree view is in the expected state.
   *
   * @param expected Expected tree view state (partial match)
   */
  async assertTreeViewState(expected: Partial<TreeViewState>): Promise<void> {
    const state = await this.getTreeViewState();
    if (!state) {
      throw new Error('Failed to get tree view state');
    }

    for (const [key, value] of Object.entries(expected)) {
      const actual = state[key as keyof TreeViewState];
      if (Array.isArray(value)) {
        if (!Array.isArray(actual)) {
          throw new Error(`Expected ${key} to be an array, got ${typeof actual}`);
        }
        // Check that expected items are present (not exact match)
        for (const item of value) {
          if (!actual.includes(item)) {
            throw new Error(
              `Expected ${key} to contain '${item}', but got ${JSON.stringify(actual)}`
            );
          }
        }
      } else if (actual !== value) {
        throw new Error(`Expected ${key} to be ${value}, got ${actual}`);
      }
    }
  }

  /**
   * Helper to delay for a specified number of milliseconds.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a UIStateVerifier with default settings.
 */
export function createUIStateVerifier(): UIStateVerifier {
  return new UIStateVerifier();
}
