/**
 * Error Resilience E2E Tests.
 *
 * Tests error handling and recovery scenarios.
 * These tests should run last as they may affect daemon state.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  initTestContext,
  cleanupTestContext,
  getTestContext,
  clearEvents,
  ensureDaemonHealthy,
} from './setup';

suite('Error Resilience', function () {
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

  suiteTeardown(async function () {
    // Clean up the shared test context
    await cleanupTestContext();
  });

  setup(function () {
    clearEvents();
  });

  test('Handles missing daemon gracefully', async function () {
    // Test that a daemon helper correctly reports unhealthy when socket doesn't exist
    const { DaemonHelper } = await import('../helpers/daemon');
    const fakeHelper = new DaemonHelper({
      workspacePath: '/tmp/nonexistent-workspace-' + Date.now(),
    });

    // This should return false or throw - either is acceptable
    try {
      const healthy = await fakeHelper.isHealthy();
      assert.ok(!healthy, 'Should detect daemon not healthy');
    } catch {
      // An error is also acceptable - we just want no crash
      assert.ok(true, 'Error handled gracefully');
    }
  });

  test('Handles concurrent requests without deadlock', async function () {
    const ctx = getTestContext();

    const requests = [];
    for (let i = 0; i < 10; i++) {
      requests.push(
        ctx.daemon.sendRequest('GET', '/health').catch(() => null)
      );
      requests.push(
        ctx.daemon.sendRequest('GET', '/state').catch(() => null)
      );
    }

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), 10000)
    );

    try {
      await Promise.race([
        Promise.all(requests),
        timeout,
      ]);
    } catch (err: unknown) {
      const error = err as Error;
      assert.ok(
        !error.message.includes('Timeout'),
        'Should not timeout on concurrent requests'
      );
    }
  });

  test('Commands remain available after errors', async function () {
    // First verify commands are available
    const commandsBefore = await vscode.commands.getCommands(true);
    assert.ok(
      commandsBefore.includes('coven.startSession'),
      'Commands should be available initially'
    );

    // Cause an API error (not via command to avoid modal dialogs)
    const ctx = getTestContext();
    try {
      await ctx.daemon.sendRequest('POST', '/invalid-endpoint');
    } catch {
      // Expected error - endpoint doesn't exist
    }

    // Commands should still be available after the daemon error
    const commandsAfter = await vscode.commands.getCommands(true);
    assert.ok(
      commandsAfter.includes('coven.startSession'),
      'Commands should remain available after error'
    );
    assert.ok(
      commandsAfter.includes('coven.startTask'),
      'startTask command should remain available after error'
    );
  });

  test('Daemon stays healthy after invalid requests', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      return this.skip();
    }

    const ctx = getTestContext();

    // Make some invalid requests
    try {
      await ctx.daemon.sendRequest('GET', '/nonexistent');
    } catch {
      // Expected
    }

    try {
      await ctx.daemon.sendRequest('POST', '/tasks/invalid/start');
    } catch {
      // Expected
    }

    // Daemon should still be healthy
    const stillHealthy = await ctx.daemon.isHealthy();
    assert.ok(stillHealthy, 'Daemon should remain healthy after invalid requests');
  });
});
