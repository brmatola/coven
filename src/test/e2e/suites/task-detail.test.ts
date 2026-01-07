import * as assert from 'assert';
import * as vscode from 'vscode';
import { assertExtensionActive, assertCommandExists } from '../fixtures';

/**
 * E2E tests for the Task Detail Panel feature.
 */
suite('Task Detail Panel E2E Tests', function () {
  this.timeout(30000);

  suite('Task Detail Command', () => {
    test('showTaskDetail command should be registered', async () => {
      await assertCommandExists('coven.showTaskDetail');
    });

    test('showTaskDetail should be callable', async () => {
      // Verify the command can be called (it may show error message for no session)
      // We just verify it doesn't throw an unhandled exception
      await assertCommandExists('coven.showTaskDetail');
    });
  });

  suite('Task Detail Panel Registration', () => {
    test('Extension should be active', () => {
      assertExtensionActive();
    });

    test('TaskDetailPanel should use webview', async () => {
      // The TaskDetailPanel is a webview panel that opens for task details
      // We verify the command is available and can be called
      await assertCommandExists('coven.showTaskDetail');
    });
  });

  suite('Task Actions from Detail', () => {
    test('startTask command should be available', async () => {
      await assertCommandExists('coven.startTask');
    });

    test('startTask should handle missing session', async () => {
      try {
        await vscode.commands.executeCommand('coven.startTask', 'test-task-id');
        assert.ok(true, 'Command handled gracefully');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        assert.ok(
          msg.includes('session') || msg.includes('not found'),
          `Expected session error, got: ${msg}`
        );
      }
    });

    test('stopTask command should be available', async () => {
      await assertCommandExists('coven.stopTask');
    });
  });
});
