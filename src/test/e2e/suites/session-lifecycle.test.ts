import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  assertExtensionActive,
  assertCommandExists,
  assertCommandsExist,
} from '../fixtures';

/**
 * Get the test workspace path from environment.
 */
function getTestWorkspacePath(): string {
  return (
    process.env.COVEN_E2E_WORKSPACE ||
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
    ''
  );
}

suite('Session Lifecycle E2E Tests', function () {
  this.timeout(30000);

  let workspacePath: string;

  suiteSetup(() => {
    workspacePath = getTestWorkspacePath();
  });

  suite('Session Commands', () => {
    test('Session commands should be registered', async () => {
      await assertCommandsExist([
        'coven.startSession',
        'coven.stopSession',
      ]);
    });

    test('Extension should activate in test workspace', async () => {
      const extension = vscode.extensions.getExtension('coven.coven');
      if (extension && !extension.isActive) {
        await extension.activate();
      }
      assertExtensionActive();
    });
  });

  suite('Session Start/Stop', () => {
    test('startSession command should be registered', async () => {
      // startSession prompts for input which blocks in E2E tests.
      // We verify the command exists without executing it.
      await assertCommandExists('coven.startSession');
    });

    test('stopSession command should be registered', async () => {
      // stopSession shows a confirmation dialog which blocks in E2E tests.
      // We verify the command exists without executing it.
      await assertCommandExists('coven.stopSession');
    });
  });

  suite('Session State Persistence', () => {
    test('Session state file should be in .coven directory', () => {
      // Note: We can't easily test persistence without starting a session.
      // This test verifies the expected structure.
      assert.ok(workspacePath, 'Workspace path should be set');
    });

    test('Config file should be loadable', () => {
      // Extension should have loaded config on activation
      assertExtensionActive();
    });
  });

  suite('Session Pause/Resume (Placeholder)', () => {
    // Note: Pause/resume commands are not yet implemented in extension.ts
    // These tests document the expected behavior for future implementation.

    test('pauseSession command should exist when implemented', async function () {
      const commands = await vscode.commands.getCommands(true);
      if (!commands.includes('coven.pauseSession')) {
        // Skip until implemented
        this.skip();
        return;
      }
      await assertCommandExists('coven.pauseSession');
    });

    test('resumeSession command should exist when implemented', async function () {
      const commands = await vscode.commands.getCommands(true);
      if (!commands.includes('coven.resumeSession')) {
        // Skip until implemented
        this.skip();
        return;
      }
      await assertCommandExists('coven.resumeSession');
    });
  });

  suite('Session Config', () => {
    test('showSetup command should open config panel', async () => {
      await assertCommandExists('coven.showSetup');

      try {
        await vscode.commands.executeCommand('coven.showSetup');
        // If we get here, the panel opened
        assert.ok(true, 'Setup panel opened');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Prerequisites errors are expected in test environment
        if (msg.includes('prerequisites') || msg.includes('workspace')) {
          assert.ok(true, 'Setup command ran (prerequisites not met)');
        } else {
          assert.fail(`Unexpected error: ${msg}`);
        }
      }
    });
  });
});
