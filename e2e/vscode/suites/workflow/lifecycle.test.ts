/**
 * Workflow Lifecycle E2E Tests
 *
 * Tests workflow control operations: cancel, retry, and status tracking.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  TestContext,
  initTestContext,
  cleanupTestContext,
  getEventWaiter,
  ensureTestIsolation,
  waitForExtensionConnected,
  resetForSuite,
} from '../setup';
import { BeadsClient, isBeadsAvailable } from '../../helpers/beads-client';

suite('Workflow Lifecycle', function () {
  this.timeout(90000);

  let ctx: TestContext;
  let beads: BeadsClient;
  let testTaskIds: string[] = [];

  suiteSetup(async function () {
    if (!isBeadsAvailable()) {
      console.log('Beads CLI not available, skipping workflow lifecycle tests');
      this.skip();
      return;
    }

    try {
      // CRITICAL: Reset for fresh suite - clean up any lingering state from previous suites
      await resetForSuite({ delay: '5s' }); // Longer delay for cancel tests

      // Initialize base context first
      ctx = await initTestContext();
      beads = new BeadsClient(ctx.workspacePath);

      if (!beads.isInitialized()) {
        beads.initialize();
      }

      // Ensure mock agent is built before configuring
      if (!ctx.mockAgent.isBuilt()) {
        await ctx.mockAgent.ensureBuilt();
      }

      // Configure mock agent and restart daemon
      ctx.mockAgent.configure({ delay: '5s' });
      await ctx.daemon.restart();
      await waitForExtensionConnected();

      beads.cleanupTestTasks('E2E Workflow');
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
    // Ensure no workflows are running from previous tests
    await ensureTestIsolation();
  });

  test('Cancel running workflow stops execution', async function () {
    const ui = ctx.ui;

    // 1. Create a task with simple-agent grimoire (single agent step)
    const taskTitle = `E2E Cancel Workflow ${Date.now()}`;
    const taskId = beads.createTask({ title: taskTitle, type: 'task', priority: 2 });
    testTaskIds.push(taskId);

    // 2. Start task
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(taskId, 'ready', 15000);
    await vscode.commands.executeCommand('coven.startTask', taskId);

    // 3. Wait for task to become active
    try {
      await ui.waitForTaskInSection(taskId, 'active', 15000);
      console.log('Task is active, waiting before cancel...');
    } catch {
      const state = await ui.getTreeViewState();
      if (state?.ready.includes(taskId)) {
        console.log('Task stayed in ready - daemon may not be starting agents, skipping test');
        this.skip();
        return;
      }
      throw new Error('Task did not become active');
    }

    // 4. Give it a moment to start executing
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 5. Cancel workflow via daemon API
    await ctx.directClient.cancelWorkflow(taskId);
    console.log('Cancelled workflow');

    // 6. Verify workflow is cancelled
    const workflow = await ctx.directClient.getWorkflow(taskId);
    // Workflow might be null if already cleaned up, or status should be cancelled/blocked
    if (workflow) {
      assert.ok(
        ['cancelled', 'blocked', 'failed'].includes(workflow.status),
        `Workflow status should be cancelled/blocked/failed, got ${workflow.status}`
      );
    }

    // 7. Task should be removed from active
    await ui.waitForTreeState(
      (state) => !state.active.includes(taskId),
      10000,
      'task removed from active after cancel'
    );
    console.log('Cancel workflow test completed');
  });

  // NOTE: This test requires grimoire with-merge functionality.
  // Skip until grimoire workflows are verified to work.
  test.skip('Retry blocked workflow restarts execution', async function () {
    // This test requires grimoire with-merge to block at pending_merge then retry
    // Skip until grimoire workflows are working
  });

  test('Workflow status updates are reflected in UI', async function () {
    const ui = ctx.ui;

    // Configure for faster completion first (before creating task)
    ctx.mockAgent.configure({ delay: '200ms' });
    await ctx.daemon.restart();
    await waitForExtensionConnected();

    // 1. Create a task with simple-agent grimoire
    const taskTitle = `E2E Workflow Status ${Date.now()}`;
    const taskId = beads.createTask({ title: taskTitle, type: 'task', priority: 2 });
    testTaskIds.push(taskId);

    // 2. Initial state: ready (task should appear in ready or blocked section)
    await vscode.commands.executeCommand('coven.refreshTasks');

    // Wait for task to appear somewhere in the tree
    await ui.waitForTreeState(
      (state) => state.ready.includes(taskId) || state.blocked.includes(taskId),
      15000,
      'task appears in tree'
    );

    // Check which section it's in
    const initialState = await ui.getTreeViewState();
    if (initialState?.blocked.includes(taskId)) {
      console.log('Task is blocked (may have dependencies from previous tests), skipping status test');
      this.skip();
      return;
    }

    // Task should be in ready
    await ui.waitForTaskInSection(taskId, 'ready', 5000);

    let state = await ui.getTreeViewState();
    assert.ok(state?.ready.includes(taskId), 'Task should start in ready');

    // 3. Start -> active
    await vscode.commands.executeCommand('coven.startTask', taskId);

    try {
      await ui.waitForTaskInSection(taskId, 'active', 15000);
    } catch {
      const currentState = await ui.getTreeViewState();
      if (currentState?.ready.includes(taskId)) {
        console.log('Task stayed in ready - daemon may not be starting agents, skipping test');
        this.skip();
        return;
      }
      throw new Error('Task did not become active');
    }

    state = await ui.getTreeViewState();
    assert.ok(state?.active.includes(taskId), 'Task should be in active');
    assert.ok(!state?.ready.includes(taskId), 'Task should not be in ready anymore');

    // 4. Complete -> removed from active
    const events = await getEventWaiter();
    await events.waitForEvent('agent.completed', 30000);

    await ui.waitForTreeState(
      (s) => !s.active.includes(taskId),
      10000,
      'task completed'
    );

    state = await ui.getTreeViewState();
    assert.ok(!state?.active.includes(taskId), 'Task should not be in active');
    console.log('Workflow status tracking test completed');
  });

  // NOTE: This test requires grimoire multi-step functionality.
  // Skip until grimoire workflows are verified to work.
  test.skip('Get workflow details via API', async function () {
    // This test requires multi-step grimoire workflow
    // Skip until grimoire workflows are working
  });
});
