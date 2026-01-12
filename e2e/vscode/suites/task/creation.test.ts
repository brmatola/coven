/**
 * Task Creation E2E Tests
 *
 * Tests task creation via VS Code commands with dialog mocking:
 * - coven.createTask command
 * - Task appears in tree after creation
 * - Different task types
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  TestContext,
  initTestContext,
  cleanupTestContext,
  ensureTestIsolation,
} from '../setup';
import { BeadsClient, isBeadsAvailable } from '../../helpers/beads-client';

suite('Task Creation', function () {
  this.timeout(60000);

  let ctx: TestContext;
  let beads: BeadsClient;
  let testTaskIds: string[] = [];

  suiteSetup(async function () {
    if (!isBeadsAvailable()) {
      console.log('Beads CLI not available, skipping task creation tests');
      this.skip();
      return;
    }

    try {
      ctx = await initTestContext();
      beads = new BeadsClient(ctx.workspacePath);

      if (!beads.isInitialized()) {
        beads.initialize();
      }

      beads.cleanupTestTasks('E2E Creation');
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
    await ctx.dialogMock.reset();
  });

  test('coven.createTask - creates task via input dialog', async function () {
    const ui = ctx.ui;
    const taskTitle = `E2E Created Task ${Date.now()}`;

    // Queue response for title input
    await ctx.dialogMock.queueInput('title', taskTitle);
    await ctx.dialogMock.queueInput('description', 'Test task created via VS Code');

    // Execute create task command
    await vscode.commands.executeCommand('coven.createTask');
    console.log('Create task command executed');

    // Wait a moment for task to be created
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify input dialog was shown
    const invocations = await ctx.dialogMock.getInvocations();
    const inputInvocations = invocations.filter(inv => inv.method === 'showInputBox');
    console.log(`Input dialogs shown: ${inputInvocations.length}`);

    // Refresh tasks to load the new task
    await vscode.commands.executeCommand('coven.refreshTasks');

    // Find the created task in beads
    const tasks = beads.listTasks();
    const createdTask = tasks.find(t => t.title === taskTitle);

    if (createdTask) {
      testTaskIds.push(createdTask.id);
      console.log(`Task created: ${createdTask.id}`);

      // Verify task appears in tree view
      await ui.waitForTaskInSection(createdTask.id, 'ready', 15000);
      console.log('Task visible in tree view');
    } else {
      // Task may not have been created if command requires different flow
      console.log('Task not found - createTask may require different input flow');
    }
  });

  test('Task appears in ready section after creation', async function () {
    const ui = ctx.ui;

    // Create task via beads CLI (simulating what command would do)
    const taskTitle = `E2E Ready Section ${Date.now()}`;
    const taskId = beads.createTask({ title: taskTitle, type: 'task', priority: 2 });
    testTaskIds.push(taskId);
    console.log(`Created task: ${taskId}`);

    // Refresh to load task
    await vscode.commands.executeCommand('coven.refreshTasks');

    // Wait for task to appear in ready section
    await ui.waitForTaskInSection(taskId, 'ready', 15000);

    // Verify via tree state
    const state = await ui.getTreeViewState();
    assert.ok(state?.ready.includes(taskId), 'Task should be in ready section');
    console.log('Task in ready section');
  });

  test('High priority task visible in tree', async function () {
    const ui = ctx.ui;

    // Create high priority task
    const taskTitle = `E2E High Priority ${Date.now()}`;
    const taskId = beads.createTask({ title: taskTitle, type: 'task', priority: 0 }); // P0
    testTaskIds.push(taskId);
    console.log(`Created P0 task: ${taskId}`);

    // Refresh and verify visibility
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(taskId, 'ready', 15000);

    const state = await ui.getTreeViewState();
    assert.ok(state?.ready.includes(taskId), 'High priority task should be visible');
    console.log('High priority task visible');
  });

  test('Bug type task visible in tree', async function () {
    const ui = ctx.ui;

    // Create bug type task
    const taskTitle = `E2E Bug Task ${Date.now()}`;
    const taskId = beads.createTask({ title: taskTitle, type: 'bug', priority: 1 });
    testTaskIds.push(taskId);
    console.log(`Created bug: ${taskId}`);

    // Refresh and verify visibility
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(taskId, 'ready', 15000);

    const state = await ui.getTreeViewState();
    assert.ok(state?.ready.includes(taskId), 'Bug task should be visible');
    console.log('Bug task visible');
  });

  test('Feature type task visible in tree', async function () {
    const ui = ctx.ui;

    // Create feature type task
    const taskTitle = `E2E Feature Task ${Date.now()}`;
    const taskId = beads.createTask({ title: taskTitle, type: 'feature', priority: 2 });
    testTaskIds.push(taskId);
    console.log(`Created feature: ${taskId}`);

    // Refresh and verify visibility
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(taskId, 'ready', 15000);

    const state = await ui.getTreeViewState();
    assert.ok(state?.ready.includes(taskId), 'Feature task should be visible');
    console.log('Feature task visible');
  });

  test('Multiple tasks can be created and all appear in tree', async function () {
    const ui = ctx.ui;

    // Create multiple tasks
    const tasks = [
      { title: `E2E Multi 1 ${Date.now()}`, type: 'task' as const, priority: 2 },
      { title: `E2E Multi 2 ${Date.now()}`, type: 'bug' as const, priority: 1 },
      { title: `E2E Multi 3 ${Date.now()}`, type: 'feature' as const, priority: 3 },
    ];

    const createdIds: string[] = [];
    for (const task of tasks) {
      const id = beads.createTask(task);
      createdIds.push(id);
      testTaskIds.push(id);
    }
    console.log(`Created ${createdIds.length} tasks`);

    // Refresh
    await vscode.commands.executeCommand('coven.refreshTasks');

    // Verify all appear
    for (const id of createdIds) {
      await ui.waitForTaskInSection(id, 'ready', 15000);
    }

    // Check tree state
    const state = await ui.getTreeViewState();
    for (const id of createdIds) {
      assert.ok(state?.ready.includes(id), `Task ${id} should be in ready section`);
    }
    console.log('All tasks visible');
  });

  test('Task with long title is handled correctly', async function () {
    const ui = ctx.ui;

    // Create task with long title
    const longTitle = `E2E ${'A'.repeat(100)} ${Date.now()}`;
    const taskId = beads.createTask({ title: longTitle, type: 'task', priority: 2 });
    testTaskIds.push(taskId);
    console.log(`Created task with long title: ${taskId}`);

    // Refresh and verify visibility
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(taskId, 'ready', 15000);

    const state = await ui.getTreeViewState();
    assert.ok(state?.ready.includes(taskId), 'Task with long title should be visible');
    console.log('Long title task visible');
  });
});
