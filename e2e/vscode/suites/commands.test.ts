/**
 * Command Registration E2E Tests.
 *
 * Verifies all user-facing commands are properly registered
 * and available in VS Code's command palette.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import { initTestContext, clearEvents } from './setup';

suite('Command Registration', function () {
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

  test('All core commands are registered', async function () {
    const commands = await vscode.commands.getCommands(true);

    const requiredCommands = [
      'coven.startSession',
      'coven.stopSession',
      'coven.startTask',
      'coven.stopTask',
      'coven.revealSidebar',
      'coven.refreshTasks',
      'coven.showWorkflowDetail',
    ];

    const missing = requiredCommands.filter(cmd => !commands.includes(cmd));
    assert.strictEqual(
      missing.length,
      0,
      `Missing commands: ${missing.join(', ')}`
    );
  });

  test('Daemon control commands are registered', async function () {
    const commands = await vscode.commands.getCommands(true);

    const daemonCommands = [
      'coven.stopDaemon',
      'coven.restartDaemon',
      'coven.viewDaemonLogs',
    ];

    const available = daemonCommands.filter(cmd => commands.includes(cmd));
    assert.ok(
      available.length > 0,
      'At least one daemon control command should be registered'
    );
  });

  test('Task action commands are registered', async function () {
    const commands = await vscode.commands.getCommands(true);

    const taskCommands = commands.filter(cmd =>
      cmd.includes('coven.') && (
        cmd.includes('Task') ||
        cmd.includes('task') ||
        cmd.includes('start') ||
        cmd.includes('stop')
      )
    );

    assert.ok(
      taskCommands.length >= 2,
      `Should have at least 2 task commands, found: ${taskCommands.join(', ')}`
    );
  });

  test('Initialize commands are registered', async function () {
    const commands = await vscode.commands.getCommands(true);

    const expectedInitCommands = [
      'coven.initGit',
      'coven.initBeads',
      'coven.initCoven',
      'coven.initOpenspec',
      'coven.initializeWorkspace',
    ];

    const foundInitCommands = expectedInitCommands.filter(cmd =>
      commands.includes(cmd)
    );

    const allInitCommands = commands.filter(cmd =>
      cmd.startsWith('coven.init')
    );

    // Debug output
    const allCovenCommands = commands.filter(cmd =>
      cmd.startsWith('coven.')
    );
    console.log(`All coven commands: ${allCovenCommands.join(', ')}`);

    assert.ok(
      foundInitCommands.length > 0 || allInitCommands.length > 0,
      `Should have init commands. Expected: ${expectedInitCommands.join(', ')}. Found: ${allInitCommands.join(', ')}`
    );
  });

  test('Review commands are registered', async function () {
    const commands = await vscode.commands.getCommands(true);

    const reviewCommands = commands.filter(cmd =>
      cmd.includes('coven.') && (
        cmd.includes('review') ||
        cmd.includes('Review') ||
        cmd.includes('approve') ||
        cmd.includes('reject') ||
        cmd.includes('merge')
      )
    );

    assert.ok(
      reviewCommands.length >= 1,
      `Should have review commands, found: ${reviewCommands.join(', ')}`
    );
  });
});
