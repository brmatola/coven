/**
 * Agent Failure E2E Tests
 *
 * Tests that agent failures are properly reflected in the UI.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  TestContext,
  initTestContextWithMockAgent,
  cleanupTestContext,
  getEventWaiter,
  clearEvents,
} from '../setup';
import { BeadsClient, isBeadsAvailable } from '../../helpers/beads-client';

suite('Agent Failure Handling', function () {
  this.timeout(60000);

  let ctx: TestContext;
  let beads: BeadsClient;

  suiteSetup(async function () {
    if (!isBeadsAvailable()) {
      console.log('Beads CLI not available, skipping agent failure tests');
      this.skip();
      return;
    }

    try {
      // Initialize with mock agent configured to fail
      ctx = await initTestContextWithMockAgent({ fail: true, delay: '100ms' });
      beads = new BeadsClient(ctx.workspacePath);

      if (!beads.isInitialized()) {
        beads.initialize();
      }

      beads.cleanupTestTasks('E2E Failure');
    } catch (err) {
      console.error('Suite setup failed:', err);
      throw err;
    }
  });

  suiteTeardown(async function () {
    await cleanupTestContext();
  });

  setup(function () {
    clearEvents();
  });

  test('Failed agent shows error in UI', async function () {
    const ui = ctx.ui;
    const events = await getEventWaiter();

    // Create a task
    const taskTitle = `E2E Failure Test ${Date.now()}`;
    const taskId = beads.createTask({
      title: taskTitle,
      type: 'task',
      priority: 2,
    });

    try {
      // Start task
      await vscode.commands.executeCommand('coven.refreshTasks');
      await ui.waitForTaskInSection(taskId, 'ready', 10000);
      await vscode.commands.executeCommand('coven.startTask', taskId);

      // Wait for task to become active
      await ui.waitForTaskInSection(taskId, 'active', 5000);
      console.log('Task is active');

      // Wait for agent.failed event (mock agent with -fail flag fails)
      const failedEvent = await events.waitForEvent('agent.failed', 30000);
      console.log('Received agent.failed event:', failedEvent);

      // Verify task is no longer active
      await ui.waitForTreeState(
        (state) => !state.active.includes(taskId),
        10000,
        'task removed from active after failure'
      );
      console.log('Task removed from active section');

      // Verify status bar shows no active tasks
      await ui.waitForStatusBar(
        (state) => state.activeCount === 0,
        5000,
        'no active workflows after failure'
      );
    } finally {
      try {
        beads.closeTask(taskId, 'E2E test cleanup');
      } catch {
        // Ignore
      }
    }
  });

  test('Failed agent does not leave orphaned state', async function () {
    const ui = ctx.ui;
    const events = await getEventWaiter();

    // Create and run a task that will fail
    const taskTitle = `E2E Orphan Test ${Date.now()}`;
    const taskId = beads.createTask({
      title: taskTitle,
      type: 'task',
      priority: 2,
    });

    try {
      await vscode.commands.executeCommand('coven.refreshTasks');
      await ui.waitForTaskInSection(taskId, 'ready', 10000);
      await vscode.commands.executeCommand('coven.startTask', taskId);

      // Wait for failure
      await events.waitForEvent('agent.failed', 30000);

      // Wait for cache to process the event (race condition fix)
      // The event waiter receives the SSE event, but the cache update is async
      const waitForAgentNotRunning = async (timeoutMs: number): Promise<void> => {
        const endTime = Date.now() + timeoutMs;
        while (Date.now() < endTime) {
          const cacheState = await ui.getCacheState();
          const agents = cacheState?.agents as Array<{ task_id: string; status: string }> | undefined;
          const runningAgents = agents?.filter(
            (a) => a.task_id === taskId && a.status === 'running'
          );
          if ((runningAgents?.length ?? 0) === 0) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('Agent still in running state after timeout');
      };

      await waitForAgentNotRunning(5000);

      // Get cache state to verify no orphaned agents
      const cacheState = await ui.getCacheState();
      const agents = cacheState?.agents as Array<{ task_id: string; status: string }> | undefined;

      // Agent should not be in running state
      const runningAgents = agents?.filter(
        (a) => a.task_id === taskId && a.status === 'running'
      );
      assert.equal(
        runningAgents?.length ?? 0,
        0,
        'No running agents should exist after failure'
      );
    } finally {
      try {
        beads.closeTask(taskId, 'E2E test cleanup');
      } catch {
        // Ignore
      }
    }
  });
});
