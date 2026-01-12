/**
 * Session Force Stop E2E Tests
 *
 * Tests the force stop session functionality which immediately
 * kills all running agents.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  TestContext,
  initTestContextWithMockAgent,
  cleanupTestContext,
  getEventWaiter,
  ensureTestIsolation,
  waitForExtensionConnected,
} from '../setup';
import { BeadsClient, isBeadsAvailable } from '../../helpers/beads-client';

suite('Session Force Stop', function () {
  this.timeout(90000);

  let ctx: TestContext;
  let beads: BeadsClient;
  let testTaskIds: string[] = [];

  suiteSetup(async function () {
    if (!isBeadsAvailable()) {
      console.log('Beads CLI not available, skipping force stop tests');
      this.skip();
      return;
    }

    try {
      // Use longer delay so we have time to force stop
      ctx = await initTestContextWithMockAgent({ delay: '10s' });
      beads = new BeadsClient(ctx.workspacePath);

      if (!beads.isInitialized()) {
        beads.initialize();
      }

      beads.cleanupTestTasks('E2E ForceStop');
    } catch (err) {
      console.error('Suite setup failed:', err);
      throw err;
    }
  });

  suiteTeardown(async function () {
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

  test('Force stop session kills all running agents immediately', async function () {
    const ui = ctx.ui;
    const events = await getEventWaiter();

    // Create and start a task
    const taskTitle = `E2E Force Stop Test ${Date.now()}`;
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

    // Configure dialog mock to confirm force stop
    await ctx.dialogMock.queueConfirm('Force stop', 'Force Stop');

    // Execute force stop session command
    await vscode.commands.executeCommand('coven.daemon.forceStopSession');
    console.log('Force stop session command executed');

    // Verify force stop dialog was shown
    await ctx.dialogMock.assertDialogShown('Force stop');

    // Wait for task to be removed from active
    await ui.waitForTreeState(
      (state) => !state.active.includes(taskId),
      15000,
      'task removed after force stop'
    );
    console.log('Task removed from active section');

    // Status bar should show no active workflows
    await ui.waitForStatusBar(
      (state) => state.activeCount === 0,
      5000,
      'no active workflows after force stop'
    );
    console.log('Force stop test completed');
  });

  test('Force stop clears all active tasks from tree view', async function () {
    const ui = ctx.ui;

    // Create multiple tasks
    const task1Title = `E2E Force Stop Multi 1 ${Date.now()}`;
    const task2Title = `E2E Force Stop Multi 2 ${Date.now()}`;
    const task1Id = beads.createTask({ title: task1Title, type: 'task', priority: 2 });
    const task2Id = beads.createTask({ title: task2Title, type: 'task', priority: 2 });
    testTaskIds.push(task1Id, task2Id);
    console.log(`Created tasks: ${task1Id}, ${task2Id}`);

    // Start first task
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(task1Id, 'ready', 15000);
    await vscode.commands.executeCommand('coven.startTask', task1Id);
    await ui.waitForTaskInSection(task1Id, 'active', 15000);
    console.log('First task is active');

    // Configure dialog mock to confirm force stop
    await ctx.dialogMock.queueConfirm('Force stop', 'Force Stop');

    // Force stop
    await vscode.commands.executeCommand('coven.daemon.forceStopSession');
    console.log('Force stop executed');

    // All tasks should be cleared from active
    await ui.waitForTreeState(
      (state) => state.active.length === 0,
      15000,
      'all tasks cleared from active'
    );

    // Verify status bar shows no active
    const status = await ui.getStatusBarState();
    assert.strictEqual(status?.activeCount, 0, 'Active count should be 0');
    console.log('All tasks cleared');
  });

  test('Force stop allows new session to start', async function () {
    const ui = ctx.ui;

    // Create a task
    const taskTitle = `E2E Force Stop Restart ${Date.now()}`;
    const taskId = beads.createTask({ title: taskTitle, type: 'task', priority: 2 });
    testTaskIds.push(taskId);

    // Start the task
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(taskId, 'ready', 15000);
    await vscode.commands.executeCommand('coven.startTask', taskId);
    await ui.waitForTaskInSection(taskId, 'active', 15000);

    // Force stop
    await ctx.dialogMock.queueConfirm('Force stop', 'Force Stop');
    await vscode.commands.executeCommand('coven.daemon.forceStopSession');

    await ui.waitForTreeState(
      (state) => state.active.length === 0,
      15000,
      'all tasks cleared'
    );

    // Create a new task and verify we can start it
    const newTaskTitle = `E2E Force Stop New ${Date.now()}`;
    const newTaskId = beads.createTask({ title: newTaskTitle, type: 'task', priority: 2 });
    testTaskIds.push(newTaskId);

    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(newTaskId, 'ready', 15000);

    // Start new task
    await vscode.commands.executeCommand('coven.startTask', newTaskId);
    await ui.waitForTaskInSection(newTaskId, 'active', 15000);
    console.log('New task started successfully after force stop');

    // Clean up
    await ctx.directClient.killTask(newTaskId);
  });
});
