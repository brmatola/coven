import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Coven Extension E2E Smoke Tests', () => {
  test('Extension should be present', async () => {
    const extension = vscode.extensions.getExtension('coven.coven');
    assert.ok(extension, 'Coven extension should be installed');
  });

  test('Extension should activate', async () => {
    const extension = vscode.extensions.getExtension('coven.coven');
    if (extension && !extension.isActive) {
      await extension.activate();
    }
    assert.ok(extension?.isActive, 'Coven extension should be active');
  });

  test('Coven commands should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);

    const expectedCommands = [
      'coven.startSession',
      'coven.stopSession',
      'coven.revealSidebar',
      'coven.startTask',
      'coven.stopTask',
    ];

    for (const cmd of expectedCommands) {
      assert.ok(
        commands.includes(cmd),
        `Command ${cmd} should be registered`
      );
    }
  });
});
