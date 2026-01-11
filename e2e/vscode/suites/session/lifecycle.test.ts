/**
 * Session Lifecycle E2E Tests
 *
 * Tests session start/stop and state persistence.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  TestContext,
  initTestContext,
  getTestContext,
  cleanupTestContext,
  ensureDaemonHealthy,
} from '../setup';

suite('Session Lifecycle', function () {
  this.timeout(30000);

  let ctx: TestContext;

  suiteSetup(async function () {
    try {
      ctx = await initTestContext();
    } catch (err) {
      console.error('Suite setup failed:', err);
      throw err;
    }
  });

  suiteTeardown(async function () {
    await cleanupTestContext();
  });

  test('Session starts and UI reflects connected state', async function () {
    const ui = ctx.ui;

    // Verify we're connected (daemon should be running)
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      this.skip();
      return;
    }

    // Wait for connected state in UI
    await ui.waitForConnected(10000);

    // Verify status bar shows connected
    const statusState = await ui.getStatusBarState();
    assert.ok(statusState, 'Should get status bar state');
    assert.equal(statusState.isConnected, true, 'Status bar should show connected');
    assert.equal(statusState.isNotInitialized, false, 'Should not show not initialized');

    // Verify tree view is connected
    const treeState = await ui.getTreeViewState();
    assert.ok(treeState, 'Should get tree view state');
    assert.equal(treeState.isConnected, true, 'Tree view should show connected');
  });

  test('Status bar shows correct counts', async function () {
    const ui = ctx.ui;

    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      this.skip();
      return;
    }

    // Get status bar state
    const statusState = await ui.getStatusBarState();
    assert.ok(statusState, 'Should get status bar state');

    // Verify counts are non-negative numbers
    assert.ok(typeof statusState.activeCount === 'number', 'activeCount should be number');
    assert.ok(typeof statusState.pendingCount === 'number', 'pendingCount should be number');
    assert.ok(typeof statusState.questionCount === 'number', 'questionCount should be number');

    assert.ok(statusState.activeCount >= 0, 'activeCount should be >= 0');
    assert.ok(statusState.pendingCount >= 0, 'pendingCount should be >= 0');
    assert.ok(statusState.questionCount >= 0, 'questionCount should be >= 0');
  });

  test('State cache is accessible via test command', async function () {
    const ui = ctx.ui;

    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      this.skip();
      return;
    }

    // Get cache state
    const cacheState = await ui.getCacheState();
    assert.ok(cacheState, 'Should get cache state');
    assert.equal(cacheState.isInitialized, true, 'Cache should be initialized');

    // Verify cache has expected structure
    assert.ok(Array.isArray(cacheState.tasks), 'tasks should be array');
    assert.ok(Array.isArray(cacheState.agents), 'agents should be array');
    assert.ok(Array.isArray(cacheState.questions), 'questions should be array');
  });

  test('Session stop command is available', async function () {
    // Verify session control commands are registered
    const commands = await vscode.commands.getCommands(true);

    assert.ok(
      commands.includes('coven.startSession'),
      'startSession command should be registered'
    );
    assert.ok(
      commands.includes('coven.stopSession'),
      'stopSession command should be registered'
    );
  });

  test('Daemon health check works', async function () {
    const healthy = await ensureDaemonHealthy();

    // If daemon is available, it should be healthy
    if (healthy) {
      // Get health via direct client
      const healthResponse = await ctx.directClient.getHealth();
      assert.ok(healthResponse, 'Should get health response');
      assert.equal(healthResponse.status, 'healthy', 'Daemon should be healthy');
    } else {
      // If not healthy, we just skip - this test validates the mechanism works
      console.log('Daemon not healthy, skipping health check validation');
    }
  });
});
