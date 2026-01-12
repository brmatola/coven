/**
 * Reconnection E2E Tests
 *
 * Tests extension behavior when the daemon restarts or connection is lost:
 * - Automatic reconnection
 * - State restoration after reconnection
 * - Active workflow monitoring resumes
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  TestContext,
  initTestContextWithMockAgent,
  cleanupTestContext,
  ensureTestIsolation,
  waitForExtensionConnected,
} from '../setup';
import { BeadsClient, isBeadsAvailable } from '../../helpers/beads-client';

suite('Reconnection Handling', function () {
  this.timeout(90000);

  let ctx: TestContext;
  let beads: BeadsClient;
  let testTaskIds: string[] = [];

  suiteSetup(async function () {
    if (!isBeadsAvailable()) {
      console.log('Beads CLI not available, skipping reconnection tests');
      this.skip();
      return;
    }

    try {
      // Use mock agent with moderate delay
      ctx = await initTestContextWithMockAgent({ delay: '5s' });
      beads = new BeadsClient(ctx.workspacePath);

      if (!beads.isInitialized()) {
        beads.initialize();
      }

      // Skip if using VS Code daemon (we can't control it)
      if (ctx.usingVSCodeDaemon) {
        console.log('Using VS Code daemon - skipping reconnection tests');
        this.skip();
        return;
      }

      beads.cleanupTestTasks('E2E Reconnect');
    } catch (err) {
      console.error('Suite setup failed:', err);
      throw err;
    }
  });

  suiteTeardown(async function () {
    // Ensure daemon is running for other tests
    try {
      if (ctx && !ctx.usingVSCodeDaemon) {
        await ctx.daemon.start();
        await waitForExtensionConnected();
      }
    } catch {
      // Ignore if already running
    }

    for (const taskId of testTaskIds) {
      try {
        beads.closeTask(taskId, 'E2E test cleanup');
      } catch {
        // Ignore
      }
    }
    await cleanupTestContext();
  });

  setup(async function () {
    await ensureTestIsolation();
  });

  test('Extension reconnects after daemon restart', async function () {
    const ui = ctx.ui;

    // Verify initially connected
    await ui.waitForConnected(10000);
    console.log('Initially connected');

    // Restart daemon
    await ctx.daemon.restart();
    console.log('Daemon restarted');

    // Wait for reconnection
    await ui.waitForConnected(30000);
    console.log('Reconnected after restart');

    // Verify tree view still works
    const state = await ui.getTreeViewState();
    assert.ok(state, 'Should get tree view state after reconnection');
    assert.strictEqual(state.isConnected, true, 'Should show connected');
  });

  test('Extension shows disconnected state when daemon stops', async function () {
    const ui = ctx.ui;

    // Verify initially connected
    await ui.waitForConnected(10000);
    console.log('Initially connected');

    // Stop daemon
    await ctx.daemon.stop();
    console.log('Daemon stopped');

    // Wait for disconnected state
    await ui.waitForDisconnected(10000);
    console.log('UI shows disconnected');

    // Tree view should show disconnected
    const state = await ui.getTreeViewState();
    assert.strictEqual(state?.isConnected, false, 'Should show disconnected');

    // Restart daemon for other tests
    await ctx.daemon.start();
    await waitForExtensionConnected();
  });

  test('Task list restored after reconnection', async function () {
    const ui = ctx.ui;

    // Create a task
    const taskTitle = `E2E Reconnect Task ${Date.now()}`;
    const taskId = beads.createTask({ title: taskTitle, type: 'task', priority: 2 });
    testTaskIds.push(taskId);
    console.log(`Created task: ${taskId}`);

    // Refresh and verify task appears
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(taskId, 'ready', 15000);
    console.log('Task visible in tree');

    // Restart daemon
    await ctx.daemon.restart();
    console.log('Daemon restarted');

    // Wait for reconnection
    await waitForExtensionConnected();
    console.log('Reconnected');

    // Refresh tasks
    await vscode.commands.executeCommand('coven.refreshTasks');

    // Task should still be visible
    await ui.waitForTaskInSection(taskId, 'ready', 15000);
    console.log('Task still visible after reconnection');
  });

  test('Status bar updates correctly during reconnection', async function () {
    const ui = ctx.ui;

    // Verify initially connected with status bar
    await ui.waitForConnected(10000);
    let status = await ui.getStatusBarState();
    assert.ok(status?.isConnected, 'Should show connected initially');
    console.log('Status bar shows connected');

    // Stop daemon
    await ctx.daemon.stop();

    // Status bar should eventually show disconnected
    await ui.waitForStatusBar(
      (state) => !state.isConnected,
      15000,
      'status bar shows disconnected'
    );
    console.log('Status bar shows disconnected');

    // Start daemon
    await ctx.daemon.start();
    await waitForExtensionConnected();

    // Status bar should show connected again
    await ui.waitForStatusBar(
      (state) => state.isConnected,
      15000,
      'status bar shows connected'
    );
    console.log('Status bar shows connected after restart');
  });

  test('Active task monitoring resumes after reconnection', async function () {
    const ui = ctx.ui;

    // Use shorter delay for this test
    ctx.mockAgent.configure({ delay: '2s' });

    // Create a task
    const taskTitle = `E2E Reconnect Active ${Date.now()}`;
    const taskId = beads.createTask({ title: taskTitle, type: 'task', priority: 2 });
    testTaskIds.push(taskId);

    // Start the task
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(taskId, 'ready', 15000);
    await vscode.commands.executeCommand('coven.startTask', taskId);
    await ui.waitForTaskInSection(taskId, 'active', 15000);
    console.log('Task is active');

    // Verify status bar shows 1 active
    await ui.waitForStatusBar(
      (state) => state.activeCount === 1,
      5000,
      'status bar shows 1 active'
    );

    // Restart daemon (this will kill the agent)
    await ctx.daemon.restart();
    console.log('Daemon restarted');

    // Wait for reconnection
    await waitForExtensionConnected();
    console.log('Reconnected');

    // Refresh to get current state
    await vscode.commands.executeCommand('coven.refreshTasks');

    // Task should no longer be active (agent was killed)
    await ui.waitForTreeState(
      (state) => !state.active.includes(taskId),
      15000,
      'task not active after daemon restart'
    );

    // Status bar should show 0 active
    await ui.waitForStatusBar(
      (state) => state.activeCount === 0,
      5000,
      'status bar shows 0 active'
    );
    console.log('Active task monitoring updated after reconnection');

    // Restore delay
    ctx.mockAgent.configure({ delay: '5s' });
  });

  test('Multiple reconnections handled gracefully', async function () {
    const ui = ctx.ui;

    // Verify initially connected
    await ui.waitForConnected(10000);

    // Restart multiple times
    for (let i = 0; i < 3; i++) {
      console.log(`Restart ${i + 1}/3`);

      await ctx.daemon.restart();
      await waitForExtensionConnected();

      // Verify connected and functional
      const state = await ui.getTreeViewState();
      assert.ok(state, `Should get state after restart ${i + 1}`);
      assert.strictEqual(state.isConnected, true, `Should be connected after restart ${i + 1}`);
    }

    console.log('Multiple reconnections handled successfully');
  });
});
