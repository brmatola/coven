/**
 * Dialog mock for E2E testing.
 *
 * Intercepts vscode.window dialog methods to enable automated testing
 * of commands that show confirmation dialogs, input boxes, or quick picks.
 *
 * Only active when COVEN_E2E_MODE=true.
 */
import * as vscode from 'vscode';

/**
 * Record of a dialog invocation for assertions.
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
 * Configured response for a dialog.
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
 * Queue entry for dialog responses.
 */
interface QueuedResponse {
  pattern: string;
  response: DialogResponse;
  used: boolean;
}

/**
 * Original vscode.window method signatures.
 */
interface OriginalMethods {
  showWarningMessage: typeof vscode.window.showWarningMessage;
  showInformationMessage: typeof vscode.window.showInformationMessage;
  showErrorMessage: typeof vscode.window.showErrorMessage;
  showInputBox: typeof vscode.window.showInputBox;
  showQuickPick: typeof vscode.window.showQuickPick;
}

/**
 * DialogMock intercepts vscode.window dialog methods during E2E tests.
 *
 * Usage:
 * 1. Call install() during extension activation in E2E mode
 * 2. Tests configure responses via queueResponse()
 * 3. When a dialog method is called, the mock returns the configured response
 * 4. Tests can verify dialog invocations via getInvocations()
 */
export class DialogMock {
  private responseQueue: QueuedResponse[] = [];
  private invocations: DialogInvocation[] = [];
  private originalMethods: OriginalMethods | null = null;
  private installed = false;

  /**
   * Install the mock by replacing vscode.window methods.
   * Should only be called once during extension activation.
   */
  install(): void {
    if (this.installed) {
      return;
    }

    // Store original methods
    this.originalMethods = {
      showWarningMessage: vscode.window.showWarningMessage.bind(vscode.window),
      showInformationMessage: vscode.window.showInformationMessage.bind(vscode.window),
      showErrorMessage: vscode.window.showErrorMessage.bind(vscode.window),
      showInputBox: vscode.window.showInputBox.bind(vscode.window),
      showQuickPick: vscode.window.showQuickPick.bind(vscode.window),
    };

    // Replace with mock implementations
    // We need to cast to unknown first, then to a writable type to replace methods
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const win = vscode.window as any;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    win.showWarningMessage = this.mockShowWarningMessage.bind(this);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    win.showInformationMessage = this.mockShowInformationMessage.bind(this);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    win.showErrorMessage = this.mockShowErrorMessage.bind(this);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    win.showInputBox = this.mockShowInputBox.bind(this);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    win.showQuickPick = this.mockShowQuickPick.bind(this);

    this.installed = true;
  }

  /**
   * Uninstall the mock and restore original methods.
   */
  uninstall(): void {
    if (!this.installed || !this.originalMethods) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const win = vscode.window as any;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    win.showWarningMessage = this.originalMethods.showWarningMessage;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    win.showInformationMessage = this.originalMethods.showInformationMessage;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    win.showErrorMessage = this.originalMethods.showErrorMessage;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    win.showInputBox = this.originalMethods.showInputBox;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    win.showQuickPick = this.originalMethods.showQuickPick;

    this.originalMethods = null;
    this.installed = false;
  }

  /**
   * Queue a response for dialogs matching a pattern.
   * Pattern is matched against the message/prompt text (substring match).
   */
  queueResponse(pattern: string, response: DialogResponse): void {
    this.responseQueue.push({ pattern, response, used: false });
  }

  /**
   * Get all dialog invocations since last clear.
   */
  getInvocations(): DialogInvocation[] {
    return [...this.invocations];
  }

  /**
   * Clear recorded invocations.
   */
  clearInvocations(): void {
    this.invocations = [];
  }

  /**
   * Reset mock to initial state (clear queue and invocations).
   */
  reset(): void {
    this.responseQueue = [];
    this.invocations = [];
  }

  /**
   * Check if mock is installed.
   */
  isInstalled(): boolean {
    return this.installed;
  }

  // ============================================================================
  // Mock Implementations
  // ============================================================================

  /**
   * Find a queued response matching the given text.
   */
  private findResponse(text: string): DialogResponse | undefined {
    for (const entry of this.responseQueue) {
      if (!entry.used && text.includes(entry.pattern)) {
        entry.used = true;
        return entry.response;
      }
    }
    return undefined;
  }

  /**
   * Mock implementation of showWarningMessage.
   */
  private mockShowWarningMessage(
    message: string,
    options?: vscode.MessageOptions | string,
    ...items: string[]
  ): Promise<string | undefined> {
    // Handle overloaded signatures
    let actualItems: string[];
    if (typeof options === 'string') {
      actualItems = [options, ...items];
    } else {
      actualItems = items;
    }

    // Record invocation
    this.invocations.push({
      method: 'showWarningMessage',
      message,
      options: actualItems,
      timestamp: Date.now(),
    });

    // Check for queued response
    const response = this.findResponse(message);
    if (response !== undefined) {
      return Promise.resolve(response.button);
    }

    // No response configured - return undefined (user cancelled)
    return Promise.resolve(undefined);
  }

  /**
   * Mock implementation of showInformationMessage.
   */
  private mockShowInformationMessage(
    message: string,
    options?: vscode.MessageOptions | string,
    ...items: string[]
  ): Promise<string | undefined> {
    // Handle overloaded signatures
    let actualItems: string[];
    if (typeof options === 'string') {
      actualItems = [options, ...items];
    } else {
      actualItems = items;
    }

    // Record invocation
    this.invocations.push({
      method: 'showInformationMessage',
      message,
      options: actualItems,
      timestamp: Date.now(),
    });

    // Check for queued response
    const response = this.findResponse(message);
    if (response !== undefined) {
      return Promise.resolve(response.button);
    }

    // No response configured - return undefined
    return Promise.resolve(undefined);
  }

  /**
   * Mock implementation of showErrorMessage.
   * Error messages are typically informational, so we just record them.
   */
  private mockShowErrorMessage(
    message: string,
    options?: vscode.MessageOptions | string,
    ...items: string[]
  ): Promise<string | undefined> {
    // Handle overloaded signatures
    let actualItems: string[];
    if (typeof options === 'string') {
      actualItems = [options, ...items];
    } else {
      actualItems = items;
    }

    // Record invocation
    this.invocations.push({
      method: 'showErrorMessage',
      message,
      options: actualItems,
      timestamp: Date.now(),
    });

    // Check for queued response
    const response = this.findResponse(message);
    if (response !== undefined) {
      return Promise.resolve(response.button);
    }

    // No response configured - return undefined
    return Promise.resolve(undefined);
  }

  /**
   * Mock implementation of showInputBox.
   */
  private mockShowInputBox(
    options?: vscode.InputBoxOptions
  ): Promise<string | undefined> {
    const prompt = options?.prompt ?? options?.placeHolder ?? '';

    // Record invocation
    this.invocations.push({
      method: 'showInputBox',
      prompt,
      timestamp: Date.now(),
    });

    // Check for queued response
    const response = this.findResponse(prompt);
    if (response !== undefined) {
      return Promise.resolve(response.input);
    }

    // No response configured - return undefined (user cancelled)
    return Promise.resolve(undefined);
  }

  /**
   * Mock implementation of showQuickPick.
   */
  private async mockShowQuickPick(
    items: readonly string[] | Thenable<readonly string[]>,
    options?: vscode.QuickPickOptions
  ): Promise<string | undefined> {
    const resolvedItems = await items;
    const prompt = options?.placeHolder ?? options?.title ?? '';

    // Record invocation
    this.invocations.push({
      method: 'showQuickPick',
      prompt,
      items: [...resolvedItems],
      timestamp: Date.now(),
    });

    // Check for queued response
    const response = this.findResponse(prompt);
    if (response !== undefined && response.selection) {
      // Find matching item
      const selected = resolvedItems.find(item => item === response.selection);
      return selected;
    }

    // No response configured - return undefined (user cancelled)
    return undefined;
  }
}

// Singleton instance
let dialogMockInstance: DialogMock | null = null;

/**
 * Get the global DialogMock instance.
 * Creates one if it doesn't exist.
 */
export function getDialogMock(): DialogMock {
  if (!dialogMockInstance) {
    dialogMockInstance = new DialogMock();
  }
  return dialogMockInstance;
}

/**
 * Install the dialog mock and return the instance.
 * Should be called during extension activation in E2E mode.
 */
export function installDialogMock(): DialogMock {
  const mock = getDialogMock();
  mock.install();
  return mock;
}
