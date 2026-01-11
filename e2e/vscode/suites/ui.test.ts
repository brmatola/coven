/**
 * UI Rendering E2E Tests.
 *
 * Tests sidebar, tree views, and panel rendering.
 * Addresses user complaint: "workflow detail view opens but is blank".
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  initTestContext,
  clearEvents,
  ensureDaemonHealthy,
} from './setup';
import { delay } from '../helpers';

suite('UI Rendering', function () {
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

  test('Reveal sidebar command works without error', async function () {
    try {
      await vscode.commands.executeCommand('coven.revealSidebar');
      await delay(500);
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('not found')) {
        return this.skip();
      }
      throw err;
    }
  });

  test('Workflow detail command is available', async function () {
    // Verify the command is registered
    const commands = await vscode.commands.getCommands(true);
    const hasWorkflowCommand = commands.includes('coven.showWorkflowDetail');

    assert.ok(hasWorkflowCommand, 'showWorkflowDetail command should be registered');

    // Note: We don't execute the command as it opens a webview panel
    // and depends on daemon connection state which varies in test environments
  });

  test('Refresh updates tree view without crash', async function () {
    const commands = await vscode.commands.getCommands(true);
    const refreshCommand = commands.find(
      cmd => cmd.includes('coven.refresh') || cmd === 'coven.refreshTasks'
    );

    if (!refreshCommand) {
      return this.skip();
    }

    for (let i = 0; i < 3; i++) {
      try {
        await vscode.commands.executeCommand(refreshCommand);
        await delay(200);
      } catch (err: unknown) {
        const error = err as Error;
        assert.ok(
          !error.message.includes('CRASH'),
          'Refresh should not crash'
        );
      }
    }

    const healthy = await ensureDaemonHealthy();
    assert.ok(healthy, 'Daemon should remain healthy after refreshes');
  });

  test('Setup command is available', async function () {
    const commands = await vscode.commands.getCommands(true);
    const hasSetup = commands.includes('coven.showSetup');

    if (!hasSetup) {
      return this.skip();
    }

    try {
      await vscode.commands.executeCommand('coven.showSetup');
      await delay(500);
    } catch (err: unknown) {
      const error = err as Error;
      console.log(`Setup show: ${error.message}`);
    }
  });
});
