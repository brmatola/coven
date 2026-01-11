/**
 * Task Lifecycle E2E Tests
 *
 * Tests the complete task workflow from creation through completion.
 * This is the CRITICAL test that validates the entire system works.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  TestContext,
  initTestContextWithMockAgent,
  getTestContext,
  cleanupTestContext,
  getEventWaiter,
  clearEvents,
} from '../setup';
import { BeadsClient, isBeadsAvailable } from '../../helpers/beads-client';

suite('Task Lifecycle', function () {
  this.timeout(60000);

  let ctx: TestContext;
  let beads: BeadsClient;
  let testTaskId: string | null = null;

  suiteSetup(async function () {
    // Skip if beads not available
    if (!isBeadsAvailable()) {
      console.log('Beads CLI not available, skipping task lifecycle tests');
      this.skip();
      return;
    }

    try {
      // Initialize with mock agent for fast, deterministic tests
      ctx = await initTestContextWithMockAgent({ delay: '200ms' });
      beads = new BeadsClient(ctx.workspacePath);

      // Ensure beads is initialized
      if (!beads.isInitialized()) {
        beads.initialize();
      }

      // Clean up any stale test tasks
      beads.cleanupTestTasks('E2E Lifecycle');
    } catch (err) {
      console.error('Suite setup failed:', err);
      throw err;
    }
  });

  suiteTeardown(async function () {
    // Clean up test task
    if (testTaskId && beads) {
      try {
        beads.closeTask(testTaskId, 'E2E test cleanup');
      } catch {
        // Ignore cleanup errors
      }
    }
    await cleanupTestContext();
  });

  setup(function () {
    clearEvents();
  });

  test('Complete workflow: create -> start -> agent runs -> completes', async function () {
    const ui = ctx.ui;

    // 1. Create a task via beads CLI (this is setup, not testing extension)
    const taskTitle = `E2E Lifecycle Test ${Date.now()}`;
    testTaskId = beads.createTask({
      title: taskTitle,
      type: 'task',
      priority: 2,
    });
    console.log(`Created test task: ${testTaskId}`);

    // 2. Wait for task to appear in tree view "Ready" section
    // (daemon polls beads periodically, or we can trigger refresh)
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(testTaskId, 'ready', 10000);
    console.log('Task appeared in Ready section');

    // 3. Start task via VS Code command
    await vscode.commands.executeCommand('coven.startTask', testTaskId);
    console.log('Started task via command');

    // 4. Verify task moves to "Active" section
    await ui.waitForTaskInSection(testTaskId, 'active', 10000);
    console.log('Task moved to Active section');

    // 5. Verify status bar shows active workflow
    await ui.waitForStatusBar(
      (state) => state.activeCount >= 1,
      5000,
      'active workflow count'
    );
    console.log('Status bar shows active workflow');

    // 6. Wait for SSE events: agent.started -> agent.completed
    const events = await getEventWaiter();

    // Wait for agent completion (mock agent completes quickly)
    await events.waitForEvent('agent.completed', 30000);
    console.log('Received agent.completed event');

    // 7. Verify task moves to "Completed" or is removed from "Active"
    // After completion, task status changes in beads
    // The tree view should no longer show it in active
    await ui.waitForTreeState(
      (state) => !state.active.includes(testTaskId!),
      10000,
      'task removed from active'
    );
    console.log('Task removed from Active section');

    // 8. Verify status bar updates to show no active tasks
    await ui.waitForStatusBar(
      (state) => state.activeCount === 0,
      5000,
      'no active workflows'
    );
    console.log('Status bar shows no active workflows');
  });

  test('Task can be stopped mid-execution', async function () {
    const ui = ctx.ui;

    // Configure mock agent with longer delay for this test
    ctx.mockAgent.configure({ delay: '10s' });

    // Create a new task
    const taskTitle = `E2E Stop Test ${Date.now()}`;
    const taskId = beads.createTask({
      title: taskTitle,
      type: 'task',
      priority: 2,
    });

    try {
      // Refresh and start task
      await vscode.commands.executeCommand('coven.refreshTasks');
      await ui.waitForTaskInSection(taskId, 'ready', 10000);
      await vscode.commands.executeCommand('coven.startTask', taskId);

      // Wait for task to become active
      await ui.waitForTaskInSection(taskId, 'active', 5000);

      // Stop the task (directly via daemon API to bypass confirmation dialog)
      await ctx.directClient.killTask(taskId);
      console.log('Killed task via daemon API');

      // Verify task is no longer active
      await ui.waitForTreeState(
        (state) => !state.active.includes(taskId),
        10000,
        'task removed from active after kill'
      );
    } finally {
      // Clean up
      try {
        beads.closeTask(taskId, 'E2E test cleanup');
      } catch {
        // Ignore
      }
      // Reset mock agent config
      ctx.mockAgent.configure({ delay: '200ms' });
    }
  });

  test('Multiple tasks can run sequentially', async function () {
    const ui = ctx.ui;

    // Create two tasks
    const task1Title = `E2E Sequential Test 1 ${Date.now()}`;
    const task2Title = `E2E Sequential Test 2 ${Date.now()}`;

    const task1Id = beads.createTask({ title: task1Title, priority: 3 });
    const task2Id = beads.createTask({ title: task2Title, priority: 2 });

    try {
      await vscode.commands.executeCommand('coven.refreshTasks');
      await ui.waitForTaskInSection(task1Id, 'ready', 10000);
      await ui.waitForTaskInSection(task2Id, 'ready', 5000);

      // Start first task
      await vscode.commands.executeCommand('coven.startTask', task1Id);
      await ui.waitForTaskInSection(task1Id, 'active', 5000);

      // Wait for first task to complete
      const events = await getEventWaiter();
      await events.waitForEvent('agent.completed', 30000);

      await ui.waitForTreeState(
        (state) => !state.active.includes(task1Id),
        10000,
        'task1 completed'
      );

      // Start second task
      clearEvents();
      await vscode.commands.executeCommand('coven.startTask', task2Id);
      await ui.waitForTaskInSection(task2Id, 'active', 5000);

      // Wait for second task to complete
      await events.waitForEvent('agent.completed', 30000);

      await ui.waitForTreeState(
        (state) => !state.active.includes(task2Id),
        10000,
        'task2 completed'
      );
    } finally {
      // Clean up
      for (const taskId of [task1Id, task2Id]) {
        try {
          beads.closeTask(taskId, 'E2E test cleanup');
        } catch {
          // Ignore
        }
      }
    }
  });

  test('Task state is reflected in tree view correctly', async function () {
    const ui = ctx.ui;

    // Get initial state
    const initialState = await ui.getTreeViewState();
    assert.ok(initialState, 'Should get tree view state');
    assert.equal(initialState.isConnected, true, 'Should be connected');

    // Create a task
    const taskTitle = `E2E State Test ${Date.now()}`;
    const taskId = beads.createTask({ title: taskTitle, priority: 2 });

    try {
      // Refresh and verify task appears
      await vscode.commands.executeCommand('coven.refreshTasks');
      await ui.waitForTaskInSection(taskId, 'ready', 10000);

      // Verify state snapshot shows correct section
      const stateWithTask = await ui.getTreeViewState();
      assert.ok(stateWithTask, 'Should get state with task');
      assert.ok(
        stateWithTask.ready.includes(taskId),
        `Task ${taskId} should be in ready section`
      );
    } finally {
      beads.closeTask(taskId, 'E2E test cleanup');
    }
  });
});
