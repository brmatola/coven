import { describe, it, expect, vi } from 'vitest';
import { MessageRouter } from './messageRouter';

// Test message types
type TestMessage =
  | { type: 'ping'; payload: string }
  | { type: 'pong'; payload: number }
  | { type: 'empty' };

describe('MessageRouter', () => {
  describe('on()', () => {
    it('registers a handler for a message type', () => {
      const router = new MessageRouter<TestMessage>();
      const handler = vi.fn();

      router.on('ping', handler);

      expect(router.hasHandler('ping')).toBe(true);
    });

    it('supports chained registration', () => {
      const router = new MessageRouter<TestMessage>();
      const pingHandler = vi.fn();
      const pongHandler = vi.fn();

      const result = router.on('ping', pingHandler).on('pong', pongHandler);

      expect(result).toBe(router);
      expect(router.hasHandler('ping')).toBe(true);
      expect(router.hasHandler('pong')).toBe(true);
    });

    it('overwrites existing handler when registered twice', () => {
      const router = new MessageRouter<TestMessage>();
      const firstHandler = vi.fn();
      const secondHandler = vi.fn();

      router.on('ping', firstHandler);
      router.on('ping', secondHandler);

      void router.route({ type: 'ping', payload: 'test' });

      expect(firstHandler).not.toHaveBeenCalled();
      expect(secondHandler).toHaveBeenCalled();
    });
  });

  describe('route()', () => {
    it('calls the registered handler with the message', async () => {
      const router = new MessageRouter<TestMessage>();
      const handler = vi.fn();
      router.on('ping', handler);

      await router.route({ type: 'ping', payload: 'hello' });

      expect(handler).toHaveBeenCalledWith({ type: 'ping', payload: 'hello' });
    });

    it('returns true when message is handled', async () => {
      const router = new MessageRouter<TestMessage>();
      router.on('ping', vi.fn());

      const result = await router.route({ type: 'ping', payload: 'test' });

      expect(result).toBe(true);
    });

    it('returns false when no handler is registered', async () => {
      const router = new MessageRouter<TestMessage>();

      const result = await router.route({ type: 'ping', payload: 'test' });

      expect(result).toBe(false);
    });

    it('routes to correct handler based on message type', async () => {
      const router = new MessageRouter<TestMessage>();
      const pingHandler = vi.fn();
      const pongHandler = vi.fn();

      router.on('ping', pingHandler).on('pong', pongHandler);

      await router.route({ type: 'pong', payload: 42 });

      expect(pingHandler).not.toHaveBeenCalled();
      expect(pongHandler).toHaveBeenCalledWith({ type: 'pong', payload: 42 });
    });

    it('handles async handlers correctly', async () => {
      const router = new MessageRouter<TestMessage>();
      let resolved = false;

      router.on('ping', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        resolved = true;
      });

      await router.route({ type: 'ping', payload: 'test' });

      expect(resolved).toBe(true);
    });

    it('handles messages with no payload', async () => {
      const router = new MessageRouter<TestMessage>();
      const handler = vi.fn();
      router.on('empty', handler);

      await router.route({ type: 'empty' });

      expect(handler).toHaveBeenCalledWith({ type: 'empty' });
    });
  });

  describe('hasHandler()', () => {
    it('returns false for unregistered message types', () => {
      const router = new MessageRouter<TestMessage>();

      expect(router.hasHandler('ping')).toBe(false);
      expect(router.hasHandler('pong')).toBe(false);
    });

    it('returns true only for registered message types', () => {
      const router = new MessageRouter<TestMessage>();
      router.on('ping', vi.fn());

      expect(router.hasHandler('ping')).toBe(true);
      expect(router.hasHandler('pong')).toBe(false);
    });
  });
});
