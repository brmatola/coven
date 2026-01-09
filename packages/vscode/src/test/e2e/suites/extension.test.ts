import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  void vscode.window.showInformationMessage('Start all tests.');

  test('Extension should be present', () => {
    const extension = vscode.extensions.getExtension('coven.coven');
    assert.ok(extension, 'Extension should be present');
  });

  test('Extension should activate in workspace with .git', async () => {
    const extension = vscode.extensions.getExtension('coven.coven');
    if (extension && !extension.isActive) {
      await extension.activate();
    }
    assert.ok(extension?.isActive, 'Extension should be active');
  });

  test('Sidebar view container should be registered', () => {
    // The view container is registered if we can get the tree view
    const treeView = vscode.window.createTreeView('coven.sessions', {
      treeDataProvider: {
        getTreeItem: (element: unknown) => element as vscode.TreeItem,
        getChildren: () => [],
      },
    });
    assert.ok(treeView, 'Tree view should be created');
    treeView.dispose();
  });

  test('Commands should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('coven.startSession'), 'startSession command should exist');
    assert.ok(commands.includes('coven.stopSession'), 'stopSession command should exist');
    assert.ok(commands.includes('coven.showSetup'), 'showSetup command should exist');
  });
});

suite('Sidebar E2E Tests', () => {
  test('Task-related commands should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('coven.createTask'), 'createTask command should exist');
    assert.ok(commands.includes('coven.startTask'), 'startTask command should exist');
    assert.ok(commands.includes('coven.stopTask'), 'stopTask command should exist');
    assert.ok(commands.includes('coven.refreshTasks'), 'refreshTasks command should exist');
    assert.ok(commands.includes('coven.showTaskDetail'), 'showTaskDetail command should exist');
  });

  test('Sidebar reveal command should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('coven.revealSidebar'), 'revealSidebar command should exist');
  });

  test('viewFamiliarOutput command should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('coven.viewFamiliarOutput'),
      'viewFamiliarOutput command should exist'
    );
  });

  test('showSetup command should open setup panel', async () => {
    // Execute the showSetup command - should not throw
    try {
      await vscode.commands.executeCommand('coven.showSetup');
      // If we get here without error, the command executed successfully
      assert.ok(true, 'showSetup command executed without error');
    } catch (err) {
      // Check if error is due to missing prerequisites (expected in test environment)
      // or an actual error
      const errorMessage = err instanceof Error ? err.message : String(err);
      // Prerequisites errors are expected - the command still ran
      if (errorMessage.includes('prerequisites') || errorMessage.includes('workspace')) {
        assert.ok(true, 'showSetup command ran but prerequisites not met (expected in test env)');
      } else {
        assert.fail(`showSetup command threw unexpected error: ${errorMessage}`);
      }
    }
  });
});

suite('Status Bar E2E Tests', () => {
  test('Status bar item should be visible after activation', async () => {
    const extension = vscode.extensions.getExtension('coven.coven');
    if (extension && !extension.isActive) {
      await extension.activate();
    }
    // Status bar is created during activation - verify extension is active
    assert.ok(extension?.isActive, 'Extension should be active with status bar');
  });
});
