/**
 * Integration E2E Tests - Happy Path
 *
 * Tests the complete user journey from task creation through
 * agent execution, review, and merge.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  TestContext,
  initTestContext,
  cleanupTestContext,
  getEventWaiter,
  ensureTestIsolation,
  resetForSuite,
  waitForExtensionConnected,
} from '../setup';
import { BeadsClient, isBeadsAvailable } from '../../helpers/beads-client';

suite('Integration - Happy Path', function () {
  this.timeout(120000); // 2 minute timeout for full journey

  let ctx: TestContext;
  let beads: BeadsClient;
  let testTaskIds: string[] = [];

  suiteSetup(async function () {
    if (!isBeadsAvailable()) {
      console.log('Beads CLI not available, skipping integration tests');
      this.skip();
      return;
    }

    try {
      // CRITICAL: Reset for fresh suite - clean up any lingering state from previous suites
      await resetForSuite({ delay: '200ms' });

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
      ctx.mockAgent.configure({ delay: '200ms' });
      await ctx.daemon.restart();
      await waitForExtensionConnected();

      // Clean up any stale test tasks
      beads.cleanupTestTasks('E2E Integration');
    } catch (err) {
      console.error('Suite setup failed:', err);
      throw err;
    }
  });

  suiteTeardown(async function () {
    // Clean up all test tasks
    for (const taskId of testTaskIds) {
      try {
        beads.closeTask(taskId, 'E2E test cleanup');
      } catch {
        // Ignore cleanup errors
      }
    }
    await cleanupTestContext();
  });

  setup(async function () {
    // Ensure no workflows are running from previous tests
    await ensureTestIsolation();
  });

  test('Full journey: create -> start -> complete -> verify', async function () {
    const ui = ctx.ui;

    // 1. Create a task (uses default workflow which works with mock agent)
    const taskTitle = `E2E Integration Full Journey ${Date.now()}`;
    const taskId = beads.createTask({ title: taskTitle, type: 'task', priority: 2 });
    testTaskIds.push(taskId);
    console.log(`Created task: ${taskId}`);

    // 2. Refresh tasks and wait for task to appear in Ready section
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(taskId, 'ready', 15000);
    console.log('Task appeared in Ready section');

    // 3. Verify initial status bar state
    const initialStatus = await ui.getStatusBarState();
    assert.ok(initialStatus, 'Should get status bar state');
    assert.equal(initialStatus.isConnected, true, 'Should be connected');

    // 4. Start task via VS Code command
    await vscode.commands.executeCommand('coven.startTask', taskId);
    console.log('Started task via command');

    // 5. Wait for task to become active
    try {
      await ui.waitForTaskInSection(taskId, 'active', 15000);
      console.log('Task moved to Active section');
    } catch {
      // Check what state the task ended up in for better error messages
      const state = await ui.getTreeViewState();
      if (state?.ready.includes(taskId)) {
        assert.fail('Task stayed in ready section - daemon did not start the workflow. Check daemon logs.');
      }
      if (state?.blocked.includes(taskId)) {
        assert.fail('Task moved to blocked section - possible dependency issue or workflow failure.');
      }
      assert.fail('Task not found in any expected section (ready, active, blocked). Check daemon logs.');
    }

    // 6. Verify status bar shows active workflow
    await ui.waitForStatusBar(
      (state) => state.activeCount >= 1,
      5000,
      'active workflow count'
    );

    // 7. Wait for SSE events: agent.spawned -> agent.completed
    const events = await getEventWaiter();
    await events.waitForEvent('agent.completed', 30000);
    console.log('Received agent.completed event');

    // 8. Verify task removed from active
    await ui.waitForTreeState(
      (state) => !state.active.includes(taskId),
      10000,
      'task removed from active'
    );
    console.log('Task removed from Active section');

    // 9. Verify status bar shows no active tasks
    await ui.waitForStatusBar(
      (state) => state.activeCount === 0,
      5000,
      'no active workflows'
    );
    console.log('Integration happy path completed successfully');
  });

  // Tests for grimoire workflow functionality with merge steps.

  test('Full journey with auto-merge: create -> start -> auto-merge -> complete', async function () {
    const ui = ctx.ui;
    const events = await getEventWaiter();

    // Grimoires are pre-installed in workspace, no need to install/restart

    // Create task with grimoire label
    const taskTitle = `E2E Auto Merge ${Date.now()}`;
    const taskId = beads.createTask({
      title: taskTitle,
      type: 'task',
      priority: 2,
      labels: ['grimoire:auto-merge'],
    });
    testTaskIds.push(taskId);
    console.log(`Created task with auto-merge grimoire: ${taskId}`);

    // Refresh and wait for task
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(taskId, 'ready', 15000);

    // Start task
    await vscode.commands.executeCommand('coven.startTask', taskId);
    console.log('Started task');

    // Wait for workflow to complete (auto-merge means no review needed)
    await events.waitForEvent('workflow.completed', 60000);
    console.log('Workflow completed');

    // Verify workflow completed via API
    const { workflows } = await ctx.directClient.getWorkflows();
    const workflow = workflows.find(w => w.task_id === taskId);
    // Workflow may be cleaned up after completion, so check if it exists
    if (workflow) {
      assert.ok(['completed', 'merged'].includes(workflow.status), `Workflow should be completed, got ${workflow.status}`);
    }
    console.log('Auto-merge test passed');
  });

  test('Workflow with pending merge blocks for review', async function () {
    const ui = ctx.ui;
    const events = await getEventWaiter();

    // Grimoires are pre-installed in workspace, no need to install/restart

    // Create task with grimoire label
    const taskTitle = `E2E Pending Merge ${Date.now()}`;
    const taskId = beads.createTask({
      title: taskTitle,
      type: 'task',
      priority: 2,
      labels: ['grimoire:with-merge'],
    });
    testTaskIds.push(taskId);
    console.log(`Created task with with-merge grimoire: ${taskId}`);

    // Refresh and wait for task
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(taskId, 'ready', 15000);

    // Start task
    await vscode.commands.executeCommand('coven.startTask', taskId);
    console.log('Started task');

    // Wait for workflow to reach merge_pending state
    await events.waitForEvent('workflow.merge_pending', 60000);
    console.log('Workflow reached pending merge state');

    // Verify workflow is pending_merge via API
    const { workflows } = await ctx.directClient.getWorkflows();
    const workflow = workflows.find(w => w.task_id === taskId);
    assert.ok(workflow, 'Should find workflow for task');
    assert.equal(workflow.status, 'pending_merge', `Workflow should be pending_merge, got ${workflow.status}`);
    console.log('Pending merge test passed');
  });

  test('Approve merge completes workflow', async function () {
    const ui = ctx.ui;
    const events = await getEventWaiter();

    // Grimoires are pre-installed in workspace, no need to install/restart

    // Create task with grimoire label
    const taskTitle = `E2E Approve Merge ${Date.now()}`;
    const taskId = beads.createTask({
      title: taskTitle,
      type: 'task',
      priority: 2,
      labels: ['grimoire:with-merge'],
    });
    testTaskIds.push(taskId);
    console.log(`Created task: ${taskId}`);

    // Refresh and wait for task
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(taskId, 'ready', 15000);

    // Start task
    await vscode.commands.executeCommand('coven.startTask', taskId);
    console.log('Started task');

    // Wait for merge_pending
    await events.waitForEvent('workflow.merge_pending', 60000);
    console.log('Workflow pending merge');

    // Get workflow for approval (workflow can be identified by task_id)
    const { workflows } = await ctx.directClient.getWorkflows();
    const workflow = workflows.find(w => w.task_id === taskId);
    assert.ok(workflow, 'Should find workflow for task');
    assert.equal(workflow.status, 'pending_merge', 'Workflow should be pending merge');

    // Approve the merge (use workflow_id if available, otherwise task_id)
    const workflowId = workflow.workflow_id || workflow.task_id;
    await vscode.commands.executeCommand('coven.approveMerge', workflowId);
    console.log('Approved merge');

    // Wait for completion
    await events.waitForEvent('workflow.completed', 30000);
    console.log('Workflow completed');

    // Verify workflow completed via API (workflow may be cleaned up after completion)
    const { workflows: finalWorkflows } = await ctx.directClient.getWorkflows();
    const finalWorkflow = finalWorkflows.find(w => w.task_id === taskId);
    if (finalWorkflow) {
      assert.ok(['completed', 'merged'].includes(finalWorkflow.status), `Workflow should be completed/merged, got ${finalWorkflow.status}`);
    }
    console.log('Approve merge test passed');
  });

  test('Reject merge blocks workflow', async function () {
    const ui = ctx.ui;
    const events = await getEventWaiter();

    // Grimoires are pre-installed in workspace, no need to install/restart

    // Create task with grimoire label
    const taskTitle = `E2E Reject Merge ${Date.now()}`;
    const taskId = beads.createTask({
      title: taskTitle,
      type: 'task',
      priority: 2,
      labels: ['grimoire:with-merge'],
    });
    testTaskIds.push(taskId);
    console.log(`Created task: ${taskId}`);

    // Refresh and wait for task
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(taskId, 'ready', 15000);

    // Start task
    await vscode.commands.executeCommand('coven.startTask', taskId);
    console.log('Started task');

    // Wait for merge_pending
    await events.waitForEvent('workflow.merge_pending', 60000);
    console.log('Workflow pending merge');

    // Get workflow for rejection (workflow can be identified by task_id)
    const { workflows } = await ctx.directClient.getWorkflows();
    const workflow = workflows.find(w => w.task_id === taskId);
    assert.ok(workflow, 'Should find workflow for task');

    // Reject the merge (use workflow_id if available, otherwise task_id)
    const workflowId = workflow.workflow_id || workflow.task_id;
    await vscode.commands.executeCommand('coven.rejectMerge', workflowId);
    console.log('Rejected merge');

    // Wait for blocked event
    await events.waitForEvent('workflow.blocked', 30000);
    console.log('Workflow blocked');

    // Verify workflow is blocked via API
    const { workflows: finalWorkflows } = await ctx.directClient.getWorkflows();
    const finalWorkflow = finalWorkflows.find(w => w.task_id === taskId);
    assert.ok(finalWorkflow, 'Should find workflow for task');
    assert.equal(finalWorkflow.status, 'blocked', `Workflow should be blocked, got ${finalWorkflow.status}`);
    console.log('Reject merge test passed');
  });
});
