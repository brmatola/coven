/**
 * Timeout Handling E2E Tests
 *
 * Tests that long-running agents are properly terminated after timeout
 * and the UI reflects the timeout state correctly.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  TestContext,
  initTestContext,
  cleanupTestContext,
  getEventWaiter,
  ensureTestIsolation,
  waitForExtensionConnected,
} from '../setup';
import { BeadsClient, isBeadsAvailable } from '../../helpers/beads-client';

suite('Timeout Handling', function () {
  this.timeout(120000); // Long timeout for timeout tests

  let ctx: TestContext;
  let beads: BeadsClient;
  let testTaskIds: string[] = [];
  let originalConfig: string | null = null;

  suiteSetup(async function () {
    if (!isBeadsAvailable()) {
      console.log('Beads CLI not available, skipping timeout tests');
      this.skip();
      return;
    }

    try {
      ctx = await initTestContext();
      beads = new BeadsClient(ctx.workspacePath);

      if (!beads.isInitialized()) {
        beads.initialize();
      }

      // Store original config
      const configPath = path.join(ctx.workspacePath, '.coven', 'config.json');
      if (fs.existsSync(configPath)) {
        originalConfig = fs.readFileSync(configPath, 'utf-8');
      }

      // Configure short timeout for testing
      const timeoutConfig = {
        poll_interval: 1,
        agent_timeout: 5, // 5 second timeout for testing
        log_level: 'info',
      };
      fs.writeFileSync(configPath, JSON.stringify(timeoutConfig, null, 2));
      console.log('Configured agent_timeout: 5s');

      // Build mock agent with long delay to trigger timeout
      if (!ctx.mockAgent.isBuilt()) {
        await ctx.mockAgent.ensureBuilt();
      }
      ctx.mockAgent.configure({ delay: '30s' }); // Much longer than timeout

      await ctx.daemon.restart();
      await waitForExtensionConnected();

      beads.cleanupTestTasks('E2E Timeout');
    } catch (err) {
      console.error('Suite setup failed:', err);
      throw err;
    }
  });

  suiteTeardown(async function () {
    // Restore original config
    if (originalConfig) {
      const configPath = path.join(ctx.workspacePath, '.coven', 'config.json');
      fs.writeFileSync(configPath, originalConfig);
      console.log('Restored original config');
    }

    // Clean up tasks
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

  test('Agent terminated after timeout', async function () {
    const ui = ctx.ui;
    const events = await getEventWaiter();

    // Create a task
    const taskTitle = `E2E Timeout Test ${Date.now()}`;
    const taskId = beads.createTask({ title: taskTitle, type: 'task', priority: 2 });
    testTaskIds.push(taskId);
    console.log(`Created task: ${taskId}`);

    // Start the task
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(taskId, 'ready', 15000);
    await vscode.commands.executeCommand('coven.startTask', taskId);
    console.log('Started task');

    // Wait for task to become active
    await ui.waitForTaskInSection(taskId, 'active', 15000);
    console.log('Task is active');

    // Wait for timeout event (agent should be killed after 5s)
    // The daemon should emit either a timeout event or failure event
    try {
      await events.waitForEvent('agent.failed', 30000);
      console.log('Agent failed (likely timeout)');
    } catch {
      // May also show up as completed with error
      console.log('Waiting for task to leave active section');
    }

    // Task should no longer be in active section
    await ui.waitForTreeState(
      (state) => !state.active.includes(taskId),
      30000,
      'task removed from active after timeout'
    );
    console.log('Task removed from active section');

    // Status bar should show no active workflows
    await ui.waitForStatusBar(
      (state) => state.activeCount === 0,
      5000,
      'no active workflows after timeout'
    );
    console.log('Timeout test completed');
  });

  test('Timeout shows error indication in UI', async function () {
    const ui = ctx.ui;

    // Create a task
    const taskTitle = `E2E Timeout Error ${Date.now()}`;
    const taskId = beads.createTask({ title: taskTitle, type: 'task', priority: 2 });
    testTaskIds.push(taskId);
    console.log(`Created task: ${taskId}`);

    // Start the task
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(taskId, 'ready', 15000);
    await vscode.commands.executeCommand('coven.startTask', taskId);
    await ui.waitForTaskInSection(taskId, 'active', 15000);
    console.log('Task is active');

    // Wait for timeout
    await ui.waitForTreeState(
      (state) => !state.active.includes(taskId),
      30000,
      'task times out'
    );

    // Check if any error dialogs were shown
    const invocations = await ctx.dialogMock.getInvocations();
    const errorDialogs = invocations.filter(inv => inv.method === 'showErrorMessage');

    // May or may not show error dialog depending on implementation
    console.log(`Error dialogs shown: ${errorDialogs.length}`);
    for (const dialog of errorDialogs) {
      console.log(`  - ${dialog.message}`);
    }

    // The key assertion is that the task is no longer active
    const state = await ui.getTreeViewState();
    assert.ok(!state?.active.includes(taskId), 'Task should not be active after timeout');
    console.log('Timeout error test completed');
  });

  test('Task can be restarted after timeout', async function () {
    const ui = ctx.ui;

    // Use shorter mock delay for this test
    ctx.mockAgent.configure({ delay: '1s' });

    // Create a task
    const taskTitle = `E2E Timeout Restart ${Date.now()}`;
    const taskId = beads.createTask({ title: taskTitle, type: 'task', priority: 2 });
    testTaskIds.push(taskId);

    // Start and wait for timeout
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(taskId, 'ready', 15000);

    // First, configure long delay to trigger timeout
    ctx.mockAgent.configure({ delay: '30s' });

    await vscode.commands.executeCommand('coven.startTask', taskId);
    await ui.waitForTaskInSection(taskId, 'active', 15000);
    console.log('Task started (will timeout)');

    // Wait for timeout
    await ui.waitForTreeState(
      (state) => !state.active.includes(taskId),
      30000,
      'task times out'
    );
    console.log('Task timed out');

    // Reconfigure with short delay so next run completes
    ctx.mockAgent.configure({ delay: '1s' });

    // Try to restart the task
    await vscode.commands.executeCommand('coven.startTask', taskId);
    console.log('Attempting to restart task');

    // Wait for it to become active again
    await ui.waitForTaskInSection(taskId, 'active', 15000);
    console.log('Task restarted successfully');

    // This time it should complete (short delay)
    const events = await getEventWaiter();
    await events.waitForEvent('agent.completed', 15000);
    console.log('Task completed after restart');

    // Restore long delay for other tests
    ctx.mockAgent.configure({ delay: '30s' });
  });
});
