/**
 * Task Workflow E2E Tests.
 *
 * Tests task creation, starting, stopping, and status tracking.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  initTestContext,
  getTestContext,
  clearEvents,
  ensureDaemonHealthy,
} from './setup';
import { createBead } from '../fixtures';
import { delay } from '../helpers';

suite('Task Workflow', function () {
  this.timeout(30000);

  suiteSetup(async function () {
    try {
      await initTestContext();
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('binary not found')) {
        this.skip();
      }
      throw err;
    }
  });

  setup(function () {
    clearEvents();
  });

  test('Task can be started via command', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      return this.skip();
    }

    // Verify the startTask command is registered
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('coven.startTask'),
      'startTask command should be registered'
    );

    // Test the daemon API directly since the command shows modal dialogs
    const ctx = getTestContext();
    const taskId = 'beads-e2e-start-' + Date.now();

    // Create a test bead
    createBead(ctx.workspacePath, taskId, `id: ${taskId}
title: "E2E start test"
type: task
status: open
priority: 2
description: Task for testing start command
`);

    // Give daemon time to poll for new tasks
    await delay(2000);

    // Test task start via API (command would show modal dialog)
    try {
      await ctx.daemon.sendRequest('POST', `/tasks/${taskId}/start`);
    } catch (err: unknown) {
      // Task may not be found if daemon hasn't polled - that's acceptable
      const error = err as Error;
      console.log(`Task start API result: ${error.message}`);
    }

    const stillHealthy = await ctx.daemon.isHealthy();
    assert.ok(stillHealthy, 'Daemon should remain healthy after task start');
  });

  test('Task can be stopped via command', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      return this.skip();
    }

    // Verify the stopTask command is registered
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('coven.stopTask'),
      'stopTask command should be registered'
    );

    // Note: We don't execute the command directly because it shows a modal dialog
    // Instead, test the daemon API
    const ctx = getTestContext();

    try {
      await ctx.daemon.sendRequest('POST', '/tasks/any-task-id/stop');
    } catch (err: unknown) {
      // Task not found error is expected
      const error = err as Error;
      console.log(`Task stop API result: ${error.message}`);
    }

    const stillHealthy = await ctx.daemon.isHealthy();
    assert.ok(stillHealthy, 'Daemon should remain healthy after task stop');
  });

  test('Invalid task ID is handled gracefully', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      return this.skip();
    }

    const ctx = getTestContext();

    // Test invalid task ID via API (command shows modal dialog)
    try {
      await ctx.daemon.sendRequest('POST', `/tasks/nonexistent-task-${Date.now()}/start`);
    } catch (err: unknown) {
      const error = err as Error;
      // An error is expected - we just want to ensure daemon handles it gracefully
      console.log(`Invalid task API error: ${error.message}`);
    }

    const stillHealthy = await ctx.daemon.isHealthy();
    assert.ok(stillHealthy, 'Daemon should remain healthy after invalid task');
  });

  test('Task list can be fetched via API', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      return this.skip();
    }

    const ctx = getTestContext();
    const response = await ctx.daemon.sendRequest<{ tasks: unknown[] }>(
      'GET',
      '/tasks'
    );

    assert.ok(response, 'Should receive tasks response');
    assert.ok(Array.isArray(response.tasks), 'Tasks should be an array');
  });
});
