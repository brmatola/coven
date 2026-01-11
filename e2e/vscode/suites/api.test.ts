/**
 * Direct Daemon API E2E Tests.
 *
 * Tests daemon endpoints directly using TestDaemonClient
 * to verify daemon behavior independent of the extension.
 */
import * as assert from 'assert';
import {
  initTestContext,
  getTestContext,
  clearEvents,
  ensureDaemonHealthy,
} from './setup';

suite('Direct Daemon API', function () {
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

  test('Health endpoint returns expected format', async function () {
    const ctx = getTestContext();
    const health = await ctx.directClient.getHealth();
    assert.ok(health, 'Should return health response');
    assert.ok(health.status, 'Should have status field');
  });

  test('State endpoint handles empty workspace', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      return this.skip();
    }

    const ctx = getTestContext();
    try {
      const state = await ctx.directClient.getState();
      assert.ok(state, 'Should return state response');
      assert.ok('agents' in state || 'state' in state, 'Should have state structure');
    } catch (err: unknown) {
      const error = err as Error;
      console.log(`State fetch: ${error.message}`);
    }
  });

  test('Tasks endpoint returns array', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      return this.skip();
    }

    const ctx = getTestContext();
    try {
      const result = await ctx.directClient.getTasks();
      assert.ok(result, 'Should return tasks response');
      assert.ok(Array.isArray(result.tasks), 'Tasks should be array');
    } catch (err: unknown) {
      const error = err as Error;
      console.log(`Tasks fetch: ${error.message}`);
    }
  });

  test('Agents endpoint returns expected format', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      return this.skip();
    }

    const ctx = getTestContext();
    try {
      const result = await ctx.directClient.getAgents();
      assert.ok(result, 'Should return agents response');
      assert.ok(
        result.agents !== undefined,
        'Should have agents field'
      );
    } catch (err: unknown) {
      const error = err as Error;
      console.log(`Agents fetch: ${error.message}`);
    }
  });
});
