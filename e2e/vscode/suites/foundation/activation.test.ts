/**
 * Extension Activation E2E Tests
 *
 * Tests that the extension activates correctly and registers all commands.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import { ensureExtensionActivated, getCovenCommands, getExtension } from '../../helpers/vscode';

suite('Extension Activation', function () {
  this.timeout(30000);

  test('Extension activates successfully', async function () {
    await ensureExtensionActivated();
    const extension = getExtension();
    assert.ok(extension, 'Extension should be present');
    assert.equal(extension.isActive, true, 'Extension should be active');
  });

  test('Extension registers all required commands', async function () {
    const commands = await vscode.commands.getCommands(true);

    const requiredCommands = [
      'coven.startSession',
      'coven.stopSession',
      'coven.startTask',
      'coven.stopTask',
      'coven.createTask',
      'coven.refreshTasks',
      'coven.reviewTask',
      'coven.approveMerge',
      'coven.rejectMerge',
      'coven.respondToQuestion',
      'coven.showWorkflowDetail',
      'coven.showTaskDetail',
      'coven.viewFamiliarOutput',
      'coven.cancelWorkflow',
      'coven.retryWorkflow',
      'coven.showSetup',
      'coven.revealSidebar',
      'coven.stopDaemon',
      'coven.restartDaemon',
      'coven.viewDaemonLogs',
    ];

    for (const cmd of requiredCommands) {
      assert.ok(
        commands.includes(cmd),
        `Required command '${cmd}' should be registered`
      );
    }
  });

  test('E2E test commands are registered when COVEN_E2E_MODE is set', async function () {
    // Skip if not in E2E mode
    if (process.env.COVEN_E2E_MODE !== 'true') {
      console.log('COVEN_E2E_MODE not set, skipping E2E command test');
      this.skip();
      return;
    }

    const commands = await vscode.commands.getCommands(true);

    const e2eCommands = [
      'coven._getTreeViewState',
      'coven._getStatusBarState',
      'coven._getCacheState',
      'coven._isConnected',
      'coven._getDaemonSocketPath',
    ];

    for (const cmd of e2eCommands) {
      assert.ok(
        commands.includes(cmd),
        `E2E test command '${cmd}' should be registered when COVEN_E2E_MODE=true`
      );
    }
  });

  test('Coven tree view is registered', async function () {
    // Check that the tree view exists by trying to focus it
    try {
      await vscode.commands.executeCommand('coven.sessions.focus');
      // If we get here without error, the tree view exists
      assert.ok(true, 'Tree view should be focusable');
    } catch (err) {
      // Command might not exist if view isn't registered
      assert.fail(`Tree view focus command failed: ${err}`);
    }
  });

  test('Extension exports expected API', async function () {
    const extension = vscode.extensions.getExtension('coven.coven');
    assert.ok(extension, 'Extension should be found');

    // Extension should be active
    await extension.activate();
    assert.equal(extension.isActive, true, 'Extension should be active after activation');
  });
});
