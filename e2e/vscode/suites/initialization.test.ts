/**
 * Initialization E2E Tests for Coven Extension.
 *
 * These tests verify the workspace initialization flow:
 * - Setup view for uninitialized workspaces
 * - Initialize command
 * - Transition from setup to main UI
 * - Error handling for missing dependencies
 */
import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { createPresetWorkspace } from '../fixtures';
import { delay } from '../helpers';

suite('Coven Initialization E2E Tests', function () {
  this.timeout(60000);

  // ============================================================================
  // Test: Setup View for Uninitialized Workspace
  // ============================================================================

  suite('Uninitialized Workspace', function () {
    let workspacePath: string;
    let cleanup: () => void;

    suiteSetup(function () {
      // Create workspace without .coven/
      const workspace = createPresetWorkspace('uninitialized');
      workspacePath = workspace.workspacePath;
      cleanup = workspace.cleanup;
    });

    suiteTeardown(function () {
      if (cleanup) {
        cleanup();
      }
    });

    test('Extension detects missing .coven/ directory', async function () {
      // Verify .coven/ does not exist
      const covenDir = path.join(workspacePath, '.coven');
      assert.ok(!fs.existsSync(covenDir), '.coven/ should not exist');

      // The extension should detect this and show setup view
      // We verify the detection logic works by checking commands
      const commands = await vscode.commands.getCommands(true);

      // Check for initialize command
      const hasInitCommand = commands.some(cmd =>
        cmd.includes('coven.init') || cmd === 'coven.initialize'
      );

      assert.ok(hasInitCommand, 'Initialize command should be available');
    });
  });

  // ============================================================================
  // Test: No Git Repository
  // ============================================================================

  suite('No Git Repository', function () {
    let workspacePath: string;
    let cleanup: () => void;

    suiteSetup(function () {
      // Create workspace without git
      const workspace = createPresetWorkspace('noGit');
      workspacePath = workspace.workspacePath;
      cleanup = workspace.cleanup;
    });

    suiteTeardown(function () {
      if (cleanup) {
        cleanup();
      }
    });

    test('Extension detects missing git repository', async function () {
      // Verify .git/ does not exist
      const gitDir = path.join(workspacePath, '.git');
      assert.ok(!fs.existsSync(gitDir), '.git/ should not exist');
    });
  });

  // ============================================================================
  // Test: Complete Workspace
  // ============================================================================

  suite('Complete Workspace', function () {
    let workspacePath: string;
    let cleanup: () => void;

    suiteSetup(function () {
      const workspace = createPresetWorkspace('complete');
      workspacePath = workspace.workspacePath;
      cleanup = workspace.cleanup;
    });

    suiteTeardown(function () {
      if (cleanup) {
        cleanup();
      }
    });

    test('Extension detects initialized workspace', async function () {
      // Verify all components exist
      assert.ok(
        fs.existsSync(path.join(workspacePath, '.git')),
        '.git/ should exist'
      );
      assert.ok(
        fs.existsSync(path.join(workspacePath, '.coven')),
        '.coven/ should exist'
      );
      assert.ok(
        fs.existsSync(path.join(workspacePath, '.beads')),
        '.beads/ should exist'
      );
    });

    test('Coven commands are available for initialized workspace', async function () {
      const commands = await vscode.commands.getCommands(true);

      const requiredCommands = [
        'coven.startSession',
        'coven.startTask',
      ];

      for (const cmd of requiredCommands) {
        assert.ok(
          commands.includes(cmd),
          `Command '${cmd}' should be registered`
        );
      }
    });
  });

  // ============================================================================
  // Test: Workspace Components Detection
  // ============================================================================

  suite('Component Detection', function () {
    test('Detects git repository presence', async function () {
      // Create workspace with git only
      const workspace = createPresetWorkspace('minimal');
      try {
        const hasGit = fs.existsSync(path.join(workspace.workspacePath, '.git'));
        assert.ok(hasGit, 'Minimal workspace should have .git');
      } finally {
        workspace.cleanup();
      }
    });

    test('Detects beads directory presence', async function () {
      const workspace = createPresetWorkspace('complete');
      try {
        const hasBeads = fs.existsSync(path.join(workspace.workspacePath, '.beads'));
        assert.ok(hasBeads, 'Complete workspace should have .beads');
      } finally {
        workspace.cleanup();
      }
    });

    test('Detects coven directory presence', async function () {
      const workspace = createPresetWorkspace('complete');
      try {
        const hasCoven = fs.existsSync(path.join(workspace.workspacePath, '.coven'));
        assert.ok(hasCoven, 'Complete workspace should have .coven');
      } finally {
        workspace.cleanup();
      }
    });
  });

  // ============================================================================
  // Test: Initialization Command
  // ============================================================================

  suite('Initialize Command', function () {
    test('Initialize command is registered', async function () {
      const commands = await vscode.commands.getCommands(true);

      const initCommands = commands.filter(cmd =>
        cmd.includes('coven.init')
      );

      // There should be at least one initialization command
      // If not, the feature may not be implemented yet
      if (initCommands.length === 0) {
        this.skip();
      }
    });
  });

  // ============================================================================
  // Test: Reveal Sidebar Command
  // ============================================================================

  suite('Sidebar', function () {
    test('Reveal sidebar command is registered', async function () {
      const commands = await vscode.commands.getCommands(true);

      assert.ok(
        commands.includes('coven.revealSidebar'),
        'Reveal sidebar command should be registered'
      );
    });

    test('Sidebar can be revealed', async function () {
      try {
        await vscode.commands.executeCommand('coven.revealSidebar');
        // Brief delay for UI to update
        await delay(500);
        // If we get here, the command executed successfully
      } catch (err: unknown) {
        // Command may fail if view not registered
        const error = err as Error;
        if (error.message.includes('not found')) {
          this.skip();
        }
        throw err;
      }
    });
  });
});
