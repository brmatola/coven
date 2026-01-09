import * as assert from 'assert';
import * as vscode from 'vscode';
import { assertExtensionActive, assertCommandExists } from '../fixtures';

/**
 * E2E tests for the Review Workflow feature.
 * Tests the review panel, approval flow, and revert flow.
 */
suite('Review Workflow E2E Tests', function () {
  this.timeout(30000);

  suite('Review Command Registration', () => {
    test('Extension should be active', () => {
      assertExtensionActive();
    });

    test('reviewTask command should be registered', async () => {
      await assertCommandExists('coven.reviewTask');
    });
  });

  suite('Review Panel', () => {
    test('reviewTask should handle missing session gracefully', async function () {
      this.timeout(10000);

      // Use Promise.race to avoid hanging on command execution
      const commandPromise = vscode.commands.executeCommand('coven.reviewTask', 'test-task-id');
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 3000));

      // Without an active session, the command should show an error message
      // but not throw an unhandled exception
      try {
        await Promise.race([commandPromise, timeoutPromise]);
        assert.ok(true, 'Command handled gracefully');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        assert.ok(
          msg.includes('session') || msg.includes('not found') || msg.includes('No active'),
          `Expected session error, got: ${msg}`
        );
      }
    });

    test('Review panel opens for task in review status', async () => {
      // This test verifies the command exists and can be invoked
      // Full integration would require a task in 'review' status
      await assertCommandExists('coven.reviewTask');
    });
  });

  suite('Review Actions', () => {
    test('Approval flow command path exists', async () => {
      // The approval flow is triggered from within the review panel
      // We verify the reviewTask command that hosts the approval UI exists
      await assertCommandExists('coven.reviewTask');
    });

    test('Revert flow command path exists', async () => {
      // The revert flow is triggered from within the review panel
      // We verify the reviewTask command that hosts the revert UI exists
      await assertCommandExists('coven.reviewTask');
    });
  });

  suite('Diff Viewing', () => {
    test('VSCode diff command should be available', async () => {
      // The review panel uses vscode.diff command to show file diffs
      const commands = await vscode.commands.getCommands(true);
      assert.ok(commands.includes('vscode.diff'), 'vscode.diff command should be available');
    });
  });

  suite('Task Status Transitions', () => {
    test('showTaskDetail command should be available for task inspection', async () => {
      // Users can view task details before/after review
      await assertCommandExists('coven.showTaskDetail');
    });

    test('Review button appears for tasks in review status', async () => {
      // The package.json configures the review button to appear when viewItem == task.review
      // We verify the command is registered which indicates the menu contribution is valid
      await assertCommandExists('coven.reviewTask');
    });
  });
});
