/**
 * Daemon Disconnect E2E Tests
 *
 * Tests that the UI properly handles daemon disconnection and reconnection.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  TestContext,
  initTestContext,
  cleanupTestContext,
  ensureDaemonHealthy,
} from '../setup';

suite('Daemon Disconnect Handling', function () {
  this.timeout(60000);

  let ctx: TestContext;

  suiteSetup(async function () {
    try {
      ctx = await initTestContext();

      // Skip if we're using VS Code's daemon (we don't control it)
      if (ctx.usingVSCodeDaemon) {
        console.log('Using VS Code daemon - skipping disconnect tests');
        this.skip();
      }
    } catch (err) {
      console.error('Suite setup failed:', err);
      throw err;
    }
  });

  suiteTeardown(async function () {
    // Ensure daemon is restarted for other tests
    try {
      await ctx.daemon.start();
    } catch {
      // Ignore if already running
    }
    await cleanupTestContext();
  });

  test('UI shows disconnected state when daemon stops', async function () {
    const ui = ctx.ui;

    // Verify we're initially connected
    await ui.waitForConnected(10000);
    console.log('Initially connected');

    // Stop the daemon
    await ctx.daemon.stop();
    console.log('Daemon stopped');

    // Wait for UI to show disconnected
    await ui.waitForDisconnected(10000);
    console.log('UI shows disconnected');

    // Verify status bar state
    const statusState = await ui.getStatusBarState();
    assert.ok(statusState, 'Should get status bar state');
    assert.equal(statusState.isConnected, false, 'Should show disconnected');
  });

  test('UI recovers when daemon restarts', async function () {
    const ui = ctx.ui;

    // Ensure daemon is stopped
    try {
      await ctx.daemon.stop();
    } catch {
      // Might already be stopped
    }

    // Verify disconnected
    await ui.waitForDisconnected(5000);

    // Restart daemon
    await ctx.daemon.start();
    console.log('Daemon restarted');

    // Wait for reconnection
    // The extension should auto-reconnect when daemon becomes available
    await ui.waitForConnected(30000);
    console.log('UI shows reconnected');

    // Verify status bar is back to connected state
    const statusState = await ui.getStatusBarState();
    assert.ok(statusState, 'Should get status bar state');
    assert.equal(statusState.isConnected, true, 'Should show connected after restart');
  });

  test('Tree view handles disconnection gracefully', async function () {
    const ui = ctx.ui;

    // Make sure daemon is running
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      try {
        await ctx.daemon.start();
        await ui.waitForConnected(10000);
      } catch {
        this.skip();
        return;
      }
    }

    // Get initial tree state
    let treeState = await ui.getTreeViewState();
    assert.ok(treeState, 'Should get tree state');
    assert.equal(treeState.isConnected, true, 'Should be connected');

    // Stop daemon
    await ctx.daemon.stop();
    await ui.waitForDisconnected(10000);

    // Tree view should show disconnected state
    treeState = await ui.getTreeViewState();
    assert.ok(treeState, 'Should still get tree state when disconnected');
    assert.equal(treeState.isConnected, false, 'Tree should show disconnected');

    // Restart for other tests
    await ctx.daemon.start();
    await ui.waitForConnected(30000);
  });
});
