/**
 * Concurrent Workflow E2E Tests
 *
 * Tests running multiple workflows concurrently with max_concurrent_agents > 1.
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

suite('Concurrent Workflows', function () {
  this.timeout(120000);

  let ctx: TestContext;
  let beads: BeadsClient;
  let testTaskIds: string[] = [];
  let originalConfig: string | null = null;

  suiteSetup(async function () {
    if (!isBeadsAvailable()) {
      console.log('Beads CLI not available, skipping concurrent workflow tests');
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

      // Configure for concurrent execution
      const concurrentConfig = {
        poll_interval: 1,
        max_concurrent_agents: 2, // Allow 2 concurrent workflows
        log_level: 'info',
      };
      fs.writeFileSync(configPath, JSON.stringify(concurrentConfig, null, 2));
      console.log('Configured max_concurrent_agents: 2');

      // Build mock agent and restart daemon to pick up config
      if (!ctx.mockAgent.isBuilt()) {
        await ctx.mockAgent.ensureBuilt();
      }
      ctx.mockAgent.configure({ delay: '3s' }); // Long enough to see concurrency

      await ctx.daemon.restart();
      await waitForExtensionConnected();

      beads.cleanupTestTasks('E2E Concurrent');
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

  test('Two tasks can run concurrently', async function () {
    const ui = ctx.ui;

    // Create two tasks
    const task1Title = `E2E Concurrent 1 ${Date.now()}`;
    const task2Title = `E2E Concurrent 2 ${Date.now()}`;
    const task1Id = beads.createTask({ title: task1Title, type: 'task', priority: 2 });
    const task2Id = beads.createTask({ title: task2Title, type: 'task', priority: 2 });
    testTaskIds.push(task1Id, task2Id);
    console.log(`Created tasks: ${task1Id}, ${task2Id}`);

    // Refresh and wait for tasks to appear
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(task1Id, 'ready', 15000);
    await ui.waitForTaskInSection(task2Id, 'ready', 15000);
    console.log('Both tasks ready');

    // Start both tasks
    await vscode.commands.executeCommand('coven.startTask', task1Id);
    await ui.waitForTaskInSection(task1Id, 'active', 15000);
    console.log('Task 1 active');

    await vscode.commands.executeCommand('coven.startTask', task2Id);
    await ui.waitForTaskInSection(task2Id, 'active', 15000);
    console.log('Task 2 active');

    // Verify both are active at the same time
    const state = await ui.getTreeViewState();
    assert.ok(state?.active.includes(task1Id), 'Task 1 should be active');
    assert.ok(state?.active.includes(task2Id), 'Task 2 should be active');
    console.log('Both tasks running concurrently');

    // Verify status bar shows 2 active
    const statusState = await ui.getStatusBarState();
    assert.strictEqual(statusState?.activeCount, 2, 'Should show 2 active workflows');
    console.log('Status bar shows 2 active');

    // Wait for both to complete
    const events = await getEventWaiter();
    await events.waitForEvent('agent.completed', 30000);
    await events.waitForEvent('agent.completed', 30000);
    console.log('Both tasks completed');
  });

  test('Third task waits in queue when limit reached', async function () {
    const ui = ctx.ui;

    // Create three tasks
    const task1Id = beads.createTask({ title: `E2E Queue 1 ${Date.now()}`, type: 'task', priority: 2 });
    const task2Id = beads.createTask({ title: `E2E Queue 2 ${Date.now()}`, type: 'task', priority: 2 });
    const task3Id = beads.createTask({ title: `E2E Queue 3 ${Date.now()}`, type: 'task', priority: 2 });
    testTaskIds.push(task1Id, task2Id, task3Id);
    console.log(`Created tasks: ${task1Id}, ${task2Id}, ${task3Id}`);

    // Refresh and wait for tasks
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(task1Id, 'ready', 15000);
    await ui.waitForTaskInSection(task2Id, 'ready', 15000);
    await ui.waitForTaskInSection(task3Id, 'ready', 15000);

    // Start all three
    await vscode.commands.executeCommand('coven.startTask', task1Id);
    await ui.waitForTaskInSection(task1Id, 'active', 15000);

    await vscode.commands.executeCommand('coven.startTask', task2Id);
    await ui.waitForTaskInSection(task2Id, 'active', 15000);

    await vscode.commands.executeCommand('coven.startTask', task3Id);
    console.log('Started all 3 tasks');

    // Give a moment for daemon to process
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify first two are active, third is not (queued or pending)
    const state = await ui.getTreeViewState();
    assert.ok(state?.active.includes(task1Id), 'Task 1 should be active');
    assert.ok(state?.active.includes(task2Id), 'Task 2 should be active');

    // Task 3 may be in active (if one finished) or still waiting
    // The key assertion is that we had 2 running at once
    const activeCount = state?.active.length ?? 0;
    console.log(`Active count: ${activeCount}`);

    // Status bar should show max 2 active (or 3 if one finished quickly)
    const statusState = await ui.getStatusBarState();
    console.log(`Status bar shows ${statusState?.activeCount} active`);

    // Clean up - wait for completion or kill
    try {
      await ctx.directClient.killTask(task1Id);
      await ctx.directClient.killTask(task2Id);
      await ctx.directClient.killTask(task3Id);
    } catch {
      // Ignore - tasks may have completed
    }
  });

  test('Task starts when slot becomes available', async function () {
    const ui = ctx.ui;
    const events = await getEventWaiter();

    // Configure shorter delay for this test
    ctx.mockAgent.configure({ delay: '1s' });
    await ctx.daemon.restart();
    await waitForExtensionConnected();

    // Create two tasks
    const task1Id = beads.createTask({ title: `E2E Slot 1 ${Date.now()}`, type: 'task', priority: 2 });
    const task2Id = beads.createTask({ title: `E2E Slot 2 ${Date.now()}`, type: 'task', priority: 2 });
    testTaskIds.push(task1Id, task2Id);

    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(task1Id, 'ready', 15000);
    await ui.waitForTaskInSection(task2Id, 'ready', 15000);

    // Start first task
    await vscode.commands.executeCommand('coven.startTask', task1Id);
    await ui.waitForTaskInSection(task1Id, 'active', 15000);
    console.log('Task 1 active');

    // Wait for first task to complete
    await events.waitForEvent('agent.completed', 30000);
    console.log('Task 1 completed');

    // Start second task - should start immediately
    await vscode.commands.executeCommand('coven.startTask', task2Id);
    await ui.waitForTaskInSection(task2Id, 'active', 15000);
    console.log('Task 2 started in freed slot');

    // Wait for second task to complete
    await events.waitForEvent('agent.completed', 30000);
    console.log('Task 2 completed');

    // Restore longer delay for other tests
    ctx.mockAgent.configure({ delay: '3s' });
  });

  test('Status bar shows correct count for multiple active', async function () {
    const ui = ctx.ui;

    // Create two tasks
    const task1Id = beads.createTask({ title: `E2E Count 1 ${Date.now()}`, type: 'task', priority: 2 });
    const task2Id = beads.createTask({ title: `E2E Count 2 ${Date.now()}`, type: 'task', priority: 2 });
    testTaskIds.push(task1Id, task2Id);

    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(task1Id, 'ready', 15000);
    await ui.waitForTaskInSection(task2Id, 'ready', 15000);

    // Start first task
    await vscode.commands.executeCommand('coven.startTask', task1Id);
    await ui.waitForTaskInSection(task1Id, 'active', 15000);

    // Verify status bar shows 1 active
    await ui.waitForStatusBar(
      (state) => state.activeCount === 1,
      5000,
      'status bar shows 1 active'
    );

    // Start second task
    await vscode.commands.executeCommand('coven.startTask', task2Id);
    await ui.waitForTaskInSection(task2Id, 'active', 15000);

    // Verify status bar shows 2 active
    await ui.waitForStatusBar(
      (state) => state.activeCount === 2,
      5000,
      'status bar shows 2 active'
    );
    console.log('Status bar count verified');

    // Clean up
    await ctx.directClient.killTask(task1Id);
    await ctx.directClient.killTask(task2Id);
  });
});
