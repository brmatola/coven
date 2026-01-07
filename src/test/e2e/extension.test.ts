import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

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
  });
});
