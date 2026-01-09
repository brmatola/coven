import * as vscode from 'vscode';
import { getLogger, disposeLogger, ILogger } from './logger';
import { disposeEventBus } from './eventBus';

/**
 * Centralized extension context that holds all shared state.
 * Replaces scattered global variables with a single managed container.
 */
export class ExtensionContext {
  private static instance: ExtensionContext | null = null;

  public readonly extensionUri: vscode.Uri;
  public readonly subscriptions: vscode.Disposable[];
  public readonly logger: ILogger;

  public statusBarItem: vscode.StatusBarItem | null = null;

  private constructor(context: vscode.ExtensionContext) {
    this.extensionUri = context.extensionUri;
    this.subscriptions = context.subscriptions;
    this.logger = getLogger();
  }

  /**
   * Initialize the extension context. Call once during activation.
   */
  static initialize(context: vscode.ExtensionContext): ExtensionContext {
    if (ExtensionContext.instance) {
      throw new Error('ExtensionContext already initialized');
    }
    ExtensionContext.instance = new ExtensionContext(context);
    return ExtensionContext.instance;
  }

  /**
   * Get the current extension context.
   */
  static get(): ExtensionContext {
    if (!ExtensionContext.instance) {
      throw new Error('ExtensionContext not initialized. Call initialize() first.');
    }
    return ExtensionContext.instance;
  }

  /**
   * Check if context is initialized.
   */
  static isInitialized(): boolean {
    return ExtensionContext.instance !== null;
  }

  /**
   * Dispose of all resources.
   */
  static dispose(): void {
    disposeLogger();
    disposeEventBus();
    ExtensionContext.instance = null;
  }
}
