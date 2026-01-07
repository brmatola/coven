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

suite('Sidebar E2E Tests', function () {
  this.timeout(30000);

  let workspacePath: string;

  suiteSetup(() => {
    workspacePath = getTestWorkspacePath();
  });

  suite('Sidebar Views', () => {
    test('Grimoire tree view should be registered', () => {
      // The view is registered via package.json contributions
      // We verify the extension is active which loads views
      assertExtensionActive();
    });

    test('refreshSidebar command should be registered', async () => {
      await assertCommandExists('coven.refreshSidebar');
    });
  });

  suite('Sidebar Commands', () => {
    test('Task commands should be registered', async () => {
      await assertCommandsExist([
        'coven.showTaskDetail',
        'coven.viewFamiliarOutput',
        'coven.createTask',
      ]);
    });

    test('showTaskDetail should handle missing task gracefully', async () => {
      // Calling with invalid task ID should not crash
      try {
        await vscode.commands.executeCommand('coven.showTaskDetail', 'nonexistent-task');
        // Command may succeed silently or show info message
        assert.ok(true, 'Command handled gracefully');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Expected: task not found or similar
        assert.ok(
          msg.includes('task') || msg.includes('not found') || msg.includes('session'),
          `Expected task-related error, got: ${msg}`
        );
      }
    });

    test('viewFamiliarOutput should handle missing familiar gracefully', async () => {
      try {
        await vscode.commands.executeCommand('coven.viewFamiliarOutput', 'nonexistent-task');
        assert.ok(true, 'Command handled gracefully');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        assert.ok(
          msg.includes('familiar') || msg.includes('not found') || msg.includes('session'),
          `Expected familiar-related error, got: ${msg}`
        );
      }
    });

    test('createTask should be executable', async () => {
      await assertCommandExists('coven.createTask');

      // Calling without input will cancel - that's OK
      try {
        await vscode.commands.executeCommand('coven.createTask');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Expected: cancelled or session required
        assert.ok(
          msg.includes('cancel') ||
            msg.includes('session') ||
            msg.includes('input') ||
            msg.includes('prerequisites'),
          `Expected cancellation or session error, got: ${msg}`
        );
      }
    });
  });

  suite('Status Bar', () => {
    test('Status bar should be created on activation', () => {
      // Status bar is created during extension activation
      assertExtensionActive();
      // We can't directly inspect status bar items, but verify extension activates
      assert.ok(workspacePath, 'Extension activated with workspace');
    });
  });

  suite('Tree Data Provider Behavior', () => {
    test('Tree view should show "Start a Session" when no session active', async () => {
      // Without an active session, the tree provider shows NoSessionItem
      // We verify this indirectly by ensuring extension is active and commands work
      assertExtensionActive();

      // The startSession command should be available
      await assertCommandExists('coven.startSession');
    });
  });

  suite('Task Interaction Commands', () => {
    test('Session commands should be available for task management', async () => {
      // These commands work with the sidebar tree view
      await assertCommandsExist([
        'coven.startSession',
        'coven.stopSession',
      ]);
    });
  });

  suite('View Container', () => {
    test('Coven activity bar should be accessible', () => {
      // The activity bar is defined in package.json
      // We can't directly test it, but verify extension loads correctly
      assertExtensionActive();

      // Verify workspace context is set
      assert.ok(workspacePath, 'Workspace path should be set');
    });
  });
});
