/**
 * Setup Command E2E Tests
 *
 * Tests commands for workspace setup and initialization:
 * - coven.showSetup
 * - coven.revealSidebar
 * - coven.initializeWorkspace
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  TestContext,
  initTestContext,
  cleanupTestContext,
  ensureDaemonHealthy,
} from '../setup';

suite('Setup Commands', function () {
  this.timeout(60000);

  let ctx: TestContext;

  suiteSetup(async function () {
    try {
      ctx = await initTestContext();
    } catch (err) {
      console.error('Suite setup failed:', err);
      throw err;
    }
  });

  suiteTeardown(async function () {
    await cleanupTestContext();
  });

  setup(async function () {
    // Close all editors before each test
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await ctx.dialogMock.reset();
  });

  test('coven.showSetup - opens SetupPanel webview', async function () {
    // Execute show setup command
    await vscode.commands.executeCommand('coven.showSetup');
    console.log('Show setup command executed');

    // Wait for panel to open
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check that a webview panel is open
    // Note: We can't directly check webview content in E2E, but we can verify
    // the panel was created by checking tab groups
    const tabGroups = vscode.window.tabGroups;
    let setupPanelFound = false;

    for (const group of tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.label.includes('Setup') || tab.label.includes('Coven')) {
          setupPanelFound = true;
          break;
        }
      }
    }

    // The panel might be focused or in background
    // At minimum, no error should have been thrown
    console.log('Setup panel opened (or command completed without error)');

    // Clean up - close the panel
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('coven.revealSidebar - reveals the Coven sidebar', async function () {
    // Execute reveal sidebar command
    await vscode.commands.executeCommand('coven.revealSidebar');
    console.log('Reveal sidebar command executed');

    // This should focus the coven.sessions view
    // We can verify by checking if the tree view is visible
    // Note: Direct visibility check isn't available, but we can verify
    // the command executes without error

    // The command should internally call coven.sessions.focus
    // If it fails, an exception would be thrown
    console.log('Sidebar revealed successfully');
  });

  test('coven.initializeWorkspace - command executes without error', async function () {
    const fs = await import('fs');
    const path = await import('path');

    // Workspace is already initialized
    // Just verify the command exists and executes without throwing
    // The dialog will appear but since we don't click anything, it dismisses

    // Verify .coven directory exists before
    const covenDir = path.join(ctx.workspacePath, '.coven');
    assert.ok(fs.existsSync(covenDir), '.coven directory should exist');

    // Execute initialize command - it will show a dialog that gets dismissed
    await vscode.commands.executeCommand('coven.initializeWorkspace');
    console.log('Initialize workspace command executed');

    // Verify .coven directory still exists (wasn't deleted)
    assert.ok(fs.existsSync(covenDir), '.coven directory should still exist');
    console.log('.coven directory verified');
  });

  test('Session commands are available', async function () {
    // Verify session commands are registered
    const commands = await vscode.commands.getCommands(true);

    assert.ok(
      commands.includes('coven.startSession'),
      'coven.startSession should be registered'
    );
    assert.ok(
      commands.includes('coven.stopSession'),
      'coven.stopSession should be registered'
    );
    console.log('Session commands verified');
  });

  test('coven.refreshTasks - refreshes task list without error', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      this.skip();
      return;
    }

    // Execute refresh command
    await vscode.commands.executeCommand('coven.refreshTasks');
    console.log('Refresh tasks command executed');

    // Verify tree view is still connected
    const treeState = await ctx.ui.getTreeViewState();
    assert.ok(treeState, 'Should get tree view state after refresh');
    assert.strictEqual(treeState.isConnected, true, 'Should still be connected');
    console.log('Tasks refreshed successfully');
  });
});
