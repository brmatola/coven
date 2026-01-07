import { WebviewMessage } from './webview/WebviewPanel';

type MessageHandler<T extends WebviewMessage> = (message: T) => void | Promise<void>;

type MessageHandlerMap<T extends WebviewMessage> = {
  [K in T['type']]?: MessageHandler<Extract<T, { type: K }>>;
};

/**
 * Type-safe message router for webview communication.
 * Ensures all message types have handlers and provides exhaustiveness checking.
 */
export class MessageRouter<T extends WebviewMessage> {
  private handlers: MessageHandlerMap<T> = {};

  /**
   * Register a handler for a specific message type.
   */
  on<K extends T['type']>(
    type: K,
    handler: MessageHandler<Extract<T, { type: K }>>
  ): this {
    this.handlers[type] = handler as MessageHandler<T>;
    return this;
  }

  /**
   * Route a message to its registered handler.
   * Returns true if handled, false if no handler registered.
   */
  async route(message: T): Promise<boolean> {
    const handler = this.handlers[message.type as T['type']];
    if (handler) {
      await handler(message as Extract<T, { type: T['type'] }>);
      return true;
    }
    return false;
  }

  /**
   * Check if a handler is registered for a message type.
   */
  hasHandler(type: T['type']): boolean {
    return type in this.handlers;
  }
}
