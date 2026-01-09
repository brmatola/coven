import * as vscode from 'vscode';

/**
 * Application-wide events for cross-feature communication.
 */
export interface CovenEvents {
  'session:created': { sessionId: string };
  'session:ended': { sessionId: string };
  'prerequisites:changed': undefined;
}

type EventCallback<T> = T extends undefined ? () => void : (data: T) => void;

/**
 * Type-safe event bus for cross-feature communication.
 * Uses VS Code's EventEmitter under the hood for proper disposal.
 */
class EventBus {
  private emitters = new Map<string, vscode.EventEmitter<unknown>>();
  private disposables: vscode.Disposable[] = [];

  /**
   * Subscribe to an event.
   */
  on<K extends keyof CovenEvents>(
    event: K,
    callback: EventCallback<CovenEvents[K]>
  ): vscode.Disposable {
    const emitter = this.getOrCreateEmitter(event);
    return emitter.event(callback as (data: unknown) => void);
  }

  /**
   * Emit an event with optional data.
   */
  emit<K extends keyof CovenEvents>(
    event: K,
    ...args: CovenEvents[K] extends undefined ? [] : [CovenEvents[K]]
  ): void {
    const emitter = this.emitters.get(event);
    if (emitter) {
      emitter.fire(args[0]);
    }
  }

  private getOrCreateEmitter(event: string): vscode.EventEmitter<unknown> {
    let emitter = this.emitters.get(event);
    if (!emitter) {
      emitter = new vscode.EventEmitter<unknown>();
      this.emitters.set(event, emitter);
      this.disposables.push(emitter);
    }
    return emitter;
  }

  /**
   * Dispose all event emitters.
   */
  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    this.emitters.clear();
  }
}

// Singleton instance
let eventBusInstance: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!eventBusInstance) {
    eventBusInstance = new EventBus();
  }
  return eventBusInstance;
}

export function disposeEventBus(): void {
  if (eventBusInstance) {
    eventBusInstance.dispose();
    eventBusInstance = null;
  }
}
