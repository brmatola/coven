import { describe, it, expect } from 'vitest';
import { DaemonClient, DaemonClientError } from './index';

describe('daemon index exports', () => {
  it('exports DaemonClient', () => {
    expect(DaemonClient).toBeDefined();
    expect(typeof DaemonClient).toBe('function');
  });

  it('exports DaemonClientError', () => {
    expect(DaemonClientError).toBeDefined();
    expect(typeof DaemonClientError).toBe('function');
  });

  it('DaemonClient can be instantiated', () => {
    const client = new DaemonClient('/test.sock');
    expect(client).toBeInstanceOf(DaemonClient);
  });

  it('DaemonClientError can be instantiated', () => {
    const error = new DaemonClientError('connection_refused', 'Test');
    expect(error).toBeInstanceOf(DaemonClientError);
    expect(error).toBeInstanceOf(Error);
  });
});
