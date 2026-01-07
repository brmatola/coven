import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEventBus, disposeEventBus } from './eventBus';

describe('EventBus', () => {
  beforeEach(() => {
    // Reset singleton between tests
    disposeEventBus();
  });

  describe('getEventBus()', () => {
    it('returns the same instance on multiple calls', () => {
      const bus1 = getEventBus();
      const bus2 = getEventBus();

      expect(bus1).toBe(bus2);
    });

    it('returns new instance after disposeEventBus()', () => {
      const bus1 = getEventBus();
      disposeEventBus();
      const bus2 = getEventBus();

      expect(bus1).not.toBe(bus2);
    });
  });

  describe('on() and emit()', () => {
    it('calls subscriber when event is emitted with payload', () => {
      const bus = getEventBus();
      const callback = vi.fn();

      bus.on('session:created', callback);
      bus.emit('session:created', { sessionId: 'test-123' });

      expect(callback).toHaveBeenCalledWith({ sessionId: 'test-123' });
    });

    it('calls subscriber for events without payload', () => {
      const bus = getEventBus();
      const callback = vi.fn();

      bus.on('prerequisites:changed', callback);
      bus.emit('prerequisites:changed');

      expect(callback).toHaveBeenCalled();
    });

    it('supports multiple subscribers for same event', () => {
      const bus = getEventBus();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      bus.on('session:created', callback1);
      bus.on('session:created', callback2);
      bus.emit('session:created', { sessionId: 'abc' });

      expect(callback1).toHaveBeenCalledWith({ sessionId: 'abc' });
      expect(callback2).toHaveBeenCalledWith({ sessionId: 'abc' });
    });

    it('only notifies subscribers of the emitted event type', () => {
      const bus = getEventBus();
      const createdCallback = vi.fn();
      const endedCallback = vi.fn();

      bus.on('session:created', createdCallback);
      bus.on('session:ended', endedCallback);
      bus.emit('session:created', { sessionId: 'xyz' });

      expect(createdCallback).toHaveBeenCalled();
      expect(endedCallback).not.toHaveBeenCalled();
    });

    it('does not throw when emitting event with no subscribers', () => {
      const bus = getEventBus();

      expect(() => {
        bus.emit('session:created', { sessionId: 'test' });
      }).not.toThrow();
    });

    it('returns a disposable that unsubscribes when disposed', () => {
      const bus = getEventBus();
      const callback = vi.fn();

      const subscription = bus.on('session:created', callback);
      subscription.dispose();
      bus.emit('session:created', { sessionId: 'test' });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('dispose()', () => {
    it('stops all event delivery after dispose', () => {
      const bus = getEventBus();
      const callback = vi.fn();

      bus.on('session:created', callback);
      bus.dispose();
      bus.emit('session:created', { sessionId: 'test' });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('disposeEventBus()', () => {
    it('disposes the singleton instance', () => {
      const bus = getEventBus();
      const callback = vi.fn();
      bus.on('session:created', callback);

      disposeEventBus();

      // Get new instance and emit - old callback should not be called
      const newBus = getEventBus();
      newBus.emit('session:created', { sessionId: 'new' });

      expect(callback).not.toHaveBeenCalled();
    });

    it('does not throw when called multiple times', () => {
      disposeEventBus();
      expect(() => disposeEventBus()).not.toThrow();
    });
  });
});
