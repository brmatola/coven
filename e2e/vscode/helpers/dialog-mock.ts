/**
 * Dialog mock helper for E2E tests.
 *
 * Provides a convenient API for configuring dialog mock responses
 * and asserting dialog invocations in tests.
 */
import * as vscode from 'vscode';

/**
 * Response configuration for a dialog.
 */
export interface DialogResponse {
  /** Button to click for message dialogs (undefined = cancel/dismiss) */
  button?: string;
  /** Text to return for showInputBox (undefined = cancel) */
  input?: string;
  /** Item to select for showQuickPick (undefined = cancel) */
  selection?: string;
}

/**
 * Record of a dialog invocation.
 */
export interface DialogInvocation {
  method: 'showWarningMessage' | 'showInformationMessage' | 'showInputBox' | 'showQuickPick' | 'showErrorMessage';
  message?: string;
  options?: string[];
  prompt?: string;
  items?: string[];
  timestamp: number;
}

/**
 * Helper class for configuring and asserting dialog mock behavior in E2E tests.
 *
 * Usage:
 * ```typescript
 * const dialogMock = new DialogMockHelper();
 *
 * // Configure response before executing command
 * await dialogMock.queueResponse('Stop this task', { button: 'Stop Task' });
 *
 * // Execute command that shows dialog
 * await vscode.commands.executeCommand('coven.stopTask', taskId);
 *
 * // Verify dialog was shown
 * const invocation = await dialogMock.assertDialogShown('Stop this task');
 * assert.equal(invocation.method, 'showWarningMessage');
 * ```
 */
export class DialogMockHelper {
  /**
   * Queue a response for dialogs matching a pattern.
   * Pattern is matched against the message/prompt text (substring match).
   *
   * @param pattern - Substring to match in dialog message/prompt
   * @param response - Response to return when pattern matches
   */
  async queueResponse(pattern: string, response: DialogResponse): Promise<void> {
    await vscode.commands.executeCommand('coven._queueDialogResponse', pattern, response);
  }

  /**
   * Queue a confirmation response (clicks the specified button).
   * Convenience method for common confirmation dialogs.
   *
   * @param pattern - Substring to match in dialog message
   * @param buttonText - Button text to click
   */
  async queueConfirm(pattern: string, buttonText: string): Promise<void> {
    await this.queueResponse(pattern, { button: buttonText });
  }

  /**
   * Queue a cancel response (dismiss the dialog without selecting anything).
   *
   * @param pattern - Substring to match in dialog message
   */
  async queueCancel(pattern: string): Promise<void> {
    await this.queueResponse(pattern, { button: undefined });
  }

  /**
   * Queue an input box response.
   *
   * @param pattern - Substring to match in prompt/placeholder
   * @param input - Text to return
   */
  async queueInput(pattern: string, input: string): Promise<void> {
    await this.queueResponse(pattern, { input });
  }

  /**
   * Queue a quick pick selection.
   *
   * @param pattern - Substring to match in placeholder/title
   * @param selection - Item label to select
   */
  async queueSelection(pattern: string, selection: string): Promise<void> {
    await this.queueResponse(pattern, { selection });
  }

  /**
   * Get all dialog invocations since last clear.
   */
  async getInvocations(): Promise<DialogInvocation[]> {
    const result = await vscode.commands.executeCommand<DialogInvocation[]>(
      'coven._getDialogInvocations'
    );
    return result ?? [];
  }

  /**
   * Clear recorded invocations.
   */
  async clearInvocations(): Promise<void> {
    await vscode.commands.executeCommand('coven._clearDialogInvocations');
  }

  /**
   * Reset mock to initial state (clear queue and invocations).
   */
  async reset(): Promise<void> {
    await vscode.commands.executeCommand('coven._resetDialogMock');
  }

  /**
   * Assert that a dialog was shown with expected text.
   *
   * @param expectedText - Substring that should appear in the dialog message/prompt
   * @returns The matching DialogInvocation
   * @throws Error if no matching dialog was found
   */
  async assertDialogShown(expectedText: string): Promise<DialogInvocation> {
    const invocations = await this.getInvocations();
    const match = invocations.find(
      (inv) => inv.message?.includes(expectedText) || inv.prompt?.includes(expectedText)
    );
    if (!match) {
      const recorded = invocations.map((inv) => inv.message || inv.prompt).join(', ');
      throw new Error(
        `Expected dialog with text "${expectedText}" but found: [${recorded || 'none'}]`
      );
    }
    return match;
  }

  /**
   * Assert that a specific dialog method was called.
   *
   * @param method - The dialog method name
   * @returns The matching DialogInvocation
   * @throws Error if method was not called
   */
  async assertMethodCalled(
    method: DialogInvocation['method']
  ): Promise<DialogInvocation> {
    const invocations = await this.getInvocations();
    const match = invocations.find((inv) => inv.method === method);
    if (!match) {
      const methods = invocations.map((inv) => inv.method).join(', ');
      throw new Error(`Expected ${method} to be called but found: [${methods || 'none'}]`);
    }
    return match;
  }

  /**
   * Assert that no dialogs were shown.
   *
   * @throws Error if any dialogs were recorded
   */
  async assertNoDialogs(): Promise<void> {
    const invocations = await this.getInvocations();
    if (invocations.length > 0) {
      const messages = invocations.map((inv) => inv.message || inv.prompt).join(', ');
      throw new Error(`Expected no dialogs but found: [${messages}]`);
    }
  }

  /**
   * Assert that an error message was shown.
   *
   * @param expectedText - Substring that should appear in the error message
   * @returns The matching DialogInvocation
   * @throws Error if no matching error dialog was found
   */
  async assertErrorShown(expectedText: string): Promise<DialogInvocation> {
    const invocations = await this.getInvocations();
    const match = invocations.find(
      (inv) => inv.method === 'showErrorMessage' && inv.message?.includes(expectedText)
    );
    if (!match) {
      const errors = invocations
        .filter((inv) => inv.method === 'showErrorMessage')
        .map((inv) => inv.message)
        .join(', ');
      throw new Error(
        `Expected error message with "${expectedText}" but found: [${errors || 'none'}]`
      );
    }
    return match;
  }

  /**
   * Assert that an information message was shown.
   *
   * @param expectedText - Substring that should appear in the info message
   * @returns The matching DialogInvocation
   * @throws Error if no matching info dialog was found
   */
  async assertInfoShown(expectedText: string): Promise<DialogInvocation> {
    const invocations = await this.getInvocations();
    const match = invocations.find(
      (inv) => inv.method === 'showInformationMessage' && inv.message?.includes(expectedText)
    );
    if (!match) {
      const infos = invocations
        .filter((inv) => inv.method === 'showInformationMessage')
        .map((inv) => inv.message)
        .join(', ');
      throw new Error(
        `Expected info message with "${expectedText}" but found: [${infos || 'none'}]`
      );
    }
    return match;
  }

  /**
   * Get the count of dialogs shown.
   */
  async getDialogCount(): Promise<number> {
    const invocations = await this.getInvocations();
    return invocations.length;
  }

  /**
   * Wait for a dialog to be shown matching the pattern.
   *
   * @param pattern - Substring to match
   * @param timeoutMs - Maximum time to wait (default 5000ms)
   * @returns The matching DialogInvocation
   * @throws Error if timeout reached without matching dialog
   */
  async waitForDialog(pattern: string, timeoutMs: number = 5000): Promise<DialogInvocation> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        return await this.assertDialogShown(pattern);
      } catch {
        // Not found yet, wait and retry
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error(`Timeout waiting for dialog with pattern "${pattern}"`);
  }
}

/**
 * Create a new DialogMockHelper instance.
 */
export function createDialogMockHelper(): DialogMockHelper {
  return new DialogMockHelper();
}
