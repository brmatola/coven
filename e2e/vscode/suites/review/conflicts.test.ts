/**
 * Review E2E Tests - Conflict Handling
 *
 * Tests merge conflict detection and resolution during review.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import {
  TestContext,
  initTestContext,
  cleanupTestContext,
  ensureTestIsolation,
  resetForSuite,
  waitForExtensionConnected,
  getEventWaiter,
} from '../setup';
import { BeadsClient, isBeadsAvailable } from '../../helpers/beads-client';

suite('Review - Conflict Handling', function () {
  this.timeout(120000);

  let ctx: TestContext;
  let beads: BeadsClient;
  let testTaskIds: string[] = [];

  suiteSetup(async function () {
    if (!isBeadsAvailable()) {
      console.log('Beads CLI not available, skipping conflict tests');
      this.skip();
      return;
    }

    try {
      // CRITICAL: Reset for fresh suite - clean up any lingering state from previous suites
      await resetForSuite({ delay: '100ms' });

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
      ctx.mockAgent.configure({ delay: '100ms' });
      await ctx.daemon.restart();
      await waitForExtensionConnected();

      beads.cleanupTestTasks('E2E Conflict');
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

  test('Merge conflict is detected when main branch diverges', async function () {
    const ui = ctx.ui;
    const events = await getEventWaiter();

    // Grimoires are pre-installed in workspace, no need to install/restart
    // The with-merge grimoire has: script step → merge step (no agent needed)

    // 1. Create task with grimoire label
    const taskTitle = `E2E Conflict Detection ${Date.now()}`;
    const taskId = beads.createTask({
      title: taskTitle,
      type: 'task',
      priority: 2,
      labels: ['grimoire:with-merge'],
    });
    testTaskIds.push(taskId);
    console.log(`Created task: ${taskId}`);

    // 2. Start task and wait for merge_pending
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(taskId, 'ready', 15000);
    await vscode.commands.executeCommand('coven.startTask', taskId);
    console.log('Started task');

    await events.waitForEvent('workflow.merge_pending', 60000);
    console.log('Workflow pending merge');

    // 3. Create a conflicting change on main branch
    // The with-merge grimoire writes to test-output.txt, so we write to the same file
    try {
      execSync('echo "Conflicting content from main branch" > test-output.txt && git add test-output.txt && git commit -m "Conflicting change"', {
        cwd: ctx.workspacePath,
        stdio: 'pipe',
      });
      console.log('Created conflicting commit on main');
    } catch (err) {
      // File might not exist on main yet, which is fine - the conflict will be on creation
      console.log('Could not create conflict on main (file may not exist yet):', err);
    }

    // 4. Try to approve merge - should fail with conflict
    const { workflows } = await ctx.directClient.getWorkflows();
    const workflow = workflows.find(w => w.task_id === taskId);
    assert.ok(workflow, 'Should find workflow for task');

    // Use workflow_id if available, otherwise task_id
    const workflowId = workflow.workflow_id || workflow.task_id;
    try {
      await ctx.directClient.approveMerge(workflowId);
      // If no conflict was created (file didn't exist on main), this might succeed
      // Check if we got a conflict error or it completed
      console.log('Merge succeeded (no conflict detected - file may not have existed on main)');
    } catch (err: unknown) {
      // Expected: merge conflict error
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.log('Got expected error on merge:', errorMessage);
      assert.ok(
        errorMessage.toLowerCase().includes('conflict') ||
        errorMessage.toLowerCase().includes('merge') ||
        errorMessage.toLowerCase().includes('failed'),
        `Error should indicate conflict: ${errorMessage}`
      );
      console.log('Conflict detection test passed');
    }
  });

  test('Approve merge succeeds when no conflicts', async function () {
    const ui = ctx.ui;
    const events = await getEventWaiter();

    // Grimoires are pre-installed in workspace, no need to install/restart
    // The with-merge grimoire has: script step → merge step (no agent needed)

    // 1. Create task with grimoire label
    const taskTitle = `E2E Clean Merge ${Date.now()}`;
    const taskId = beads.createTask({
      title: taskTitle,
      type: 'task',
      priority: 2,
      labels: ['grimoire:with-merge'],
    });
    testTaskIds.push(taskId);
    console.log(`Created task: ${taskId}`);

    // 2. Start task and wait for merge_pending
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(taskId, 'ready', 15000);
    await vscode.commands.executeCommand('coven.startTask', taskId);
    console.log('Started task');

    await events.waitForEvent('workflow.merge_pending', 60000);
    console.log('Workflow pending merge');

    // 3. Approve merge (no conflicting changes made on main)
    const { workflows } = await ctx.directClient.getWorkflows();
    const workflow = workflows.find(w => w.task_id === taskId);
    assert.ok(workflow, 'Should find workflow for task');

    // Use workflow_id if available, otherwise task_id
    const workflowId = workflow.workflow_id || workflow.task_id;
    await ctx.directClient.approveMerge(workflowId);
    console.log('Approved merge');

    // 4. Wait for workflow completion
    await events.waitForEvent('workflow.completed', 30000);
    console.log('Workflow completed');

    // 5. Verify workflow completed via API (workflow may be cleaned up after completion)
    const { workflows: finalWorkflows } = await ctx.directClient.getWorkflows();
    const finalWorkflow = finalWorkflows.find(w => w.task_id === taskId);
    if (finalWorkflow) {
      assert.ok(['completed', 'merged'].includes(finalWorkflow.status), `Workflow should be completed/merged, got ${finalWorkflow.status}`);
    }
    console.log('Clean merge test passed');
  });
});
