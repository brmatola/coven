/**
 * Daemon Connection E2E Tests
 *
 * Tests the connection between the extension and daemon.
 */
import * as assert from 'assert';
import {
  TestContext,
  initTestContext,
  cleanupTestContext,
  ensureDaemonHealthy,
} from '../setup';

suite('Daemon Connection', function () {
  this.timeout(30000);

  let ctx: TestContext;

  suiteSetup(async function () {
    try {
      ctx = await initTestContext();
    } catch (err) {
      if (err instanceof Error && err.message.includes('binary not found')) {
        console.log('Daemon binary not found, skipping connection tests');
        this.skip();
        return;
      }
      throw err;
    }
  });

  suiteTeardown(async function () {
    await cleanupTestContext();
  });

  test('Daemon is healthy', async function () {
    const healthy = await ensureDaemonHealthy();
    assert.ok(healthy, 'Daemon should be healthy');
  });

  test('Health endpoint returns expected structure', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      this.skip();
      return;
    }

    const health = await ctx.directClient.getHealth();
    assert.ok(health, 'Should get health response');
    assert.equal(health.status, 'healthy', 'Status should be healthy');
    assert.ok(health.version, 'Should have version');
    assert.ok(health.uptime !== undefined, 'Should have uptime');
  });

  test('State endpoint returns expected structure', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      this.skip();
      return;
    }

    const state = await ctx.directClient.getState();
    assert.ok(state, 'Should get state response');

    // State should have expected fields
    assert.ok('tasks' in state, 'State should have tasks');
    assert.ok('agents' in state, 'State should have agents');
  });

  test('UI reflects connection status', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      this.skip();
      return;
    }

    const ui = ctx.ui;

    // Check connection via test command
    const connected = await ui.isConnected();
    assert.equal(connected, true, 'Should report connected');

    // Verify tree view state
    const treeState = await ui.getTreeViewState();
    assert.ok(treeState, 'Should get tree view state');
    assert.equal(treeState.isConnected, true, 'Tree view should show connected');

    // Verify status bar state
    const statusState = await ui.getStatusBarState();
    assert.ok(statusState, 'Should get status bar state');
    assert.equal(statusState.isConnected, true, 'Status bar should show connected');
  });

  test('Tasks endpoint returns array', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      this.skip();
      return;
    }

    const tasks = await ctx.directClient.getTasks();
    assert.ok(Array.isArray(tasks), 'Tasks should be an array');
  });

  test('Agents endpoint returns array', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      this.skip();
      return;
    }

    const agents = await ctx.directClient.getAgents();
    assert.ok(Array.isArray(agents), 'Agents should be an array');
  });
});
