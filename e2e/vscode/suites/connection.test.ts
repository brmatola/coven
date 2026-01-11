/**
 * Connection Lifecycle E2E Tests.
 *
 * Tests daemon connectivity, SSE events, and connection stability.
 * Addresses user complaint: "connection to daemon lost" notifications.
 */
import * as assert from 'assert';
import {
  initTestContext,
  cleanupTestContext,
  getTestContext,
  getEventWaiter,
  clearEvents,
} from './setup';
import { createEventWaiter } from '../helpers';

suite('Connection Lifecycle', function () {
  this.timeout(60000);

  suiteSetup(async function () {
    try {
      await initTestContext();
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('binary not found')) {
        console.log('Daemon binary not found. Run `make build` first.');
        this.skip();
      }
      throw err;
    }
  });

  setup(function () {
    clearEvents();
  });

  test('Daemon health check returns valid response', async function () {
    const ctx = getTestContext();
    const healthy = await ctx.daemon.isHealthy();
    assert.ok(healthy, 'Daemon should respond to health checks');
  });

  test('State endpoint returns valid state structure', async function () {
    const ctx = getTestContext();
    const response = await ctx.daemon.sendRequest<{ state: unknown; timestamp: string }>(
      'GET',
      '/state'
    );

    assert.ok(response, 'Should receive state response');
    assert.ok(response.state, 'Response should have state object');
    assert.ok(response.timestamp, 'Response should have timestamp');

    const state = response.state as {
      agents?: unknown;
      tasks?: unknown;
      workflow?: unknown;
    };

    // Verify structure matches what extension expects
    if (state.agents !== undefined) {
      assert.ok(
        typeof state.agents === 'object',
        'Agents should be object or array'
      );
    }

    if (state.tasks !== undefined) {
      assert.ok(
        Array.isArray(state.tasks),
        'Tasks should be an array'
      );
    }
  });

  test('SSE connection receives state.snapshot event', async function () {
    const events = await getEventWaiter();

    const snapshot = await events.waitForEvent('state.snapshot', 10000);
    assert.ok(snapshot, 'Should receive state.snapshot event');

    // Recursively check for state structure
    function hasStateFields(obj: unknown): boolean {
      if (!obj || typeof obj !== 'object') return false;
      const o = obj as Record<string, unknown>;

      if ('agents' in o || 'tasks' in o || 'workflow' in o || 'session' in o) {
        return true;
      }

      if ('data' in o && typeof o.data === 'object') {
        return hasStateFields(o.data);
      }

      if ('state' in o && typeof o.state === 'object') {
        return hasStateFields(o.state);
      }

      return false;
    }

    assert.ok(
      hasStateFields(snapshot.data),
      `Snapshot should contain state structure. Got: ${JSON.stringify(snapshot.data).slice(0, 200)}`
    );
  });

  test('SSE connection receives periodic state.snapshot heartbeats', async function () {
    this.timeout(40000);

    const events = await getEventWaiter();

    // Wait for initial snapshot
    const snapshot1 = await events.waitForEvent('state.snapshot', 5000);
    assert.ok(snapshot1, 'Should receive initial state.snapshot');

    // Clear events and wait for periodic heartbeat (daemon sends every 30s)
    clearEvents();
    const snapshot2 = await events.waitForEvent('state.snapshot', 35000);
    assert.ok(snapshot2, 'Should receive periodic state.snapshot heartbeat');
  });

  test('Multiple concurrent SSE clients are supported', async function () {
    this.timeout(15000);

    const ctx = getTestContext();
    const healthy = await ctx.daemon.isHealthy();
    if (!healthy) {
      return this.skip();
    }

    const client1 = await createEventWaiter(ctx.daemon.getSocketPath());
    const client2 = await createEventWaiter(ctx.daemon.getSocketPath());

    try {
      const [snapshot1, snapshot2] = await Promise.all([
        client1.waitForEvent('state.snapshot', 10000),
        client2.waitForEvent('state.snapshot', 10000),
      ]);

      assert.ok(snapshot1, 'Client 1 should receive snapshot');
      assert.ok(snapshot2, 'Client 2 should receive snapshot');
    } finally {
      client1.stop();
      client2.stop();
    }
  });
});
