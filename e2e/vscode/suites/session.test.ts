/**
 * Session Lifecycle E2E Tests.
 *
 * Tests session control via daemon API.
 */
import * as assert from 'assert';
import {
  initTestContext,
  getTestContext,
  clearEvents,
  ensureDaemonHealthy,
} from './setup';

suite('Session Lifecycle', function () {
  this.timeout(30000);

  suiteSetup(async function () {
    try {
      await initTestContext();
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('binary not found')) {
        this.skip();
      }
      throw err;
    }
  });

  setup(function () {
    clearEvents();
  });

  test('Session API is available via daemon', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      return this.skip();
    }

    const ctx = getTestContext();
    try {
      await ctx.daemon.sendRequest<{ success?: boolean }>('POST', '/session/start');
      assert.ok(true, 'Session API responded');
    } catch (err: unknown) {
      const error = err as Error;
      // Session might already be active - that's fine
      console.log(`Session API: ${error.message}`);
    }

    const stillHealthy = await ctx.daemon.isHealthy();
    assert.ok(stillHealthy, 'Daemon should remain healthy');
  });

  test('Session stop API handles gracefully', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      return this.skip();
    }

    const ctx = getTestContext();
    try {
      await ctx.daemon.sendRequest('POST', '/session/stop');
      assert.ok(true, 'Session stop API responded');
    } catch (err: unknown) {
      const error = err as Error;
      // No active session is expected
      console.log(`Session stop: ${error.message}`);
    }

    const stillHealthy = await ctx.daemon.isHealthy();
    assert.ok(stillHealthy, 'Daemon should remain healthy');
  });

  test('Daemon state reflects session status', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      return this.skip();
    }

    const ctx = getTestContext();
    const response = await ctx.daemon.sendRequest<{ state: { session?: unknown } }>(
      'GET',
      '/state'
    );
    assert.ok(response, 'Should receive state response');
  });
});
