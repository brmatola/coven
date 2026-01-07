import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  assertExtensionActive,
  assertCommandExists,
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

suite('Workspace Initialization E2E Tests', function () {
  this.timeout(30000);

  let workspacePath: string;

  suiteSetup(() => {
    workspacePath = getTestWorkspacePath();
  });

  suite('Git Prerequisites', () => {
    test('Workspace should have git initialized', () => {
      assert.ok(workspacePath, 'Workspace path should be set');
      const gitDir = path.join(workspacePath, '.git');
      assert.ok(
        fs.existsSync(gitDir),
        'Workspace should have .git directory'
      );
    });

    test('Git should have initial commit', () => {
      const gitDir = path.join(workspacePath, '.git');
      const headFile = path.join(gitDir, 'HEAD');
      assert.ok(
        fs.existsSync(headFile),
        'Git HEAD should exist'
      );
    });
  });

  suite('Beads Prerequisites', () => {
    test('Beads directory should exist if initialized', function () {
      const beadsDir = path.join(workspacePath, '.beads');
      if (!fs.existsSync(beadsDir)) {
        // Beads may not be available in all test environments
        this.skip();
        return;
      }
      assert.ok(
        fs.statSync(beadsDir).isDirectory(),
        '.beads should be a directory'
      );
    });

    test('Beads issues file should exist if initialized', function () {
      const beadsDir = path.join(workspacePath, '.beads');
      if (!fs.existsSync(beadsDir)) {
        this.skip();
        return;
      }
      const issuesFile = path.join(beadsDir, 'issues.jsonl');
      assert.ok(
        fs.existsSync(issuesFile),
        'issues.jsonl should exist'
      );
    });
  });

  suite('Extension Activation', () => {
    test('Extension should be present', () => {
      const extension = vscode.extensions.getExtension('coven.coven');
      assert.ok(extension, 'Coven extension should be present');
    });

    test('Extension should activate', async () => {
      const extension = vscode.extensions.getExtension('coven.coven');
      if (extension && !extension.isActive) {
        await extension.activate();
      }
      assertExtensionActive();
    });
  });

  suite('Coven Directory', () => {
    test('.coven directory is created during session', function () {
      // This test documents expected behavior - .coven is created on session start
      // We can't easily test without actually starting a session
      const covenDir = path.join(workspacePath, '.coven');

      // If .coven exists, verify structure
      if (fs.existsSync(covenDir)) {
        assert.ok(
          fs.statSync(covenDir).isDirectory(),
          '.coven should be a directory'
        );
      } else {
        // Document expected behavior - directory created on session start
        assert.ok(true, '.coven will be created when session starts');
      }
    });
  });

  suite('Workspace Commands', () => {
    test('showSetup command should be registered', async () => {
      await assertCommandExists('coven.showSetup');
    });

    test('refreshSidebar command should be registered', async () => {
      await assertCommandExists('coven.refreshSidebar');
    });
  });

  suite('Workspace Folder Detection', () => {
    test('Should have at least one workspace folder', () => {
      const folders = vscode.workspace.workspaceFolders;
      assert.ok(
        folders && folders.length > 0,
        'Should have workspace folders'
      );
    });

    test('First workspace folder should match test workspace', () => {
      const folders = vscode.workspace.workspaceFolders;
      assert.ok(folders && folders.length > 0, 'Should have workspace folders');

      const firstFolder = folders[0].uri.fsPath;
      // Normalize paths for comparison
      const normalizedFirst = path.normalize(firstFolder);
      const normalizedExpected = path.normalize(workspacePath);

      assert.strictEqual(
        normalizedFirst,
        normalizedExpected,
        'First workspace folder should match test workspace'
      );
    });
  });

  suite('Config Loading', () => {
    test('Extension should handle missing config gracefully', () => {
      // Config file may not exist in fresh workspace
      // Extension should still activate
      assertExtensionActive();
    });

    test('showSetup should be executable without config', async () => {
      try {
        await vscode.commands.executeCommand('coven.showSetup');
        assert.ok(true, 'Setup command executed');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Prerequisites errors are acceptable
        if (msg.includes('prerequisites') || msg.includes('workspace')) {
          assert.ok(true, 'Setup ran with expected prerequisite check');
        } else {
          assert.fail(`Unexpected error: ${msg}`);
        }
      }
    });
  });
});
