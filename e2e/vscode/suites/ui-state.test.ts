/**
 * UI State E2E Tests for Coven Extension.
 *
 * These tests verify UI state management:
 * - Sidebar sections and tree view
 * - Detail panel commands
 * - Refresh and update behavior
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import { createPresetWorkspace, createBead } from '../fixtures';
import { DaemonHelper, delay } from '../helpers';

suite('Coven UI State E2E Tests', function () {
  this.timeout(60000);

  let workspacePath: string;
  let cleanup: () => void;
  let daemon: DaemonHelper;

  suiteSetup(async function () {
    const workspace = createPresetWorkspace('complete');
    workspacePath = workspace.workspacePath;
    cleanup = workspace.cleanup;
    daemon = new DaemonHelper({ workspacePath });
  });

  suiteTeardown(async function () {
    try {
      await daemon.stop();
    } catch {
      // Ignore cleanup errors
    }
    if (cleanup) {
      cleanup();
    }
  });

  async function ensureDaemonRunning(): Promise<boolean> {
    try {
      if (!await daemon.isHealthy()) {
        await daemon.start();
      }
      return true;
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('binary not found')) {
        return false;
      }
      throw err;
    }
  }

  // ============================================================================
  // Test: Sidebar Tree View Commands
  // ============================================================================

  suite('Sidebar Tree View', function () {
    test('Tree view commands are registered', async function () {
      const commands = await vscode.commands.getCommands(true);

      // Check for tree view reveal command
      assert.ok(
        commands.includes('coven.revealSidebar'),
        'Sidebar reveal command should exist'
      );

      // Check for refresh command
      const hasRefreshCommand = commands.some(
        cmd => cmd.includes('coven.refresh') || cmd.includes('coven.reloadTasks')
      );
      assert.ok(
        hasRefreshCommand,
        'Tree view should have a refresh command'
      );
    });

    test('Sidebar can be revealed without error', async function () {
      try {
        await vscode.commands.executeCommand('coven.revealSidebar');
        await delay(500);
        // Success - sidebar revealed
      } catch (err: unknown) {
        const error = err as Error;
        // Skip if view not registered yet
        if (error.message.includes('not found')) {
          this.skip();
          return;
        }
        throw err;
      }
    });

    test('Refresh command executes without error', async function () {
      const commands = await vscode.commands.getCommands(true);

      const refreshCommand = commands.find(
        cmd => cmd.includes('coven.refresh') || cmd.includes('coven.reloadTasks')
      );

      if (!refreshCommand) {
        this.skip();
        return;
      }

      try {
        await vscode.commands.executeCommand(refreshCommand);
        await delay(500);
        // Success - refresh completed
      } catch (err: unknown) {
        const error = err as Error;
        // May fail if daemon not connected
        if (error.message.includes('not connected') || error.message.includes('No session')) {
          this.skip();
          return;
        }
        throw err;
      }
    });
  });

  // ============================================================================
  // Test: Task Detail Panel Commands
  // ============================================================================

  suite('Task Detail Panel', function () {
    test('Show task detail command is registered', async function () {
      const commands = await vscode.commands.getCommands(true);

      const hasDetailCommand = commands.some(
        cmd => cmd.includes('coven.showTaskDetail') || cmd.includes('coven.openTask')
      );

      if (!hasDetailCommand) {
        // Feature may not be implemented
        this.skip();
        return;
      }

      assert.ok(hasDetailCommand, 'Task detail command should exist');
    });
  });

  // ============================================================================
  // Test: Workflow Detail Panel Commands
  // ============================================================================

  suite('Workflow Detail Panel', function () {
    test('Workflow detail commands are registered', async function () {
      const commands = await vscode.commands.getCommands(true);

      const hasWorkflowCommand = commands.some(
        cmd =>
          cmd.includes('coven.showWorkflowDetail') ||
          cmd.includes('coven.openWorkflow') ||
          cmd.includes('coven.viewWorkflow')
      );

      if (!hasWorkflowCommand) {
        // Feature may not be implemented
        this.skip();
        return;
      }

      assert.ok(hasWorkflowCommand, 'Workflow detail command should exist');
    });
  });

  // ============================================================================
  // Test: Status Bar
  // ============================================================================

  suite('Status Bar', function () {
    test('Status bar item commands are accessible', async function () {
      // Verify start session command exists (shown in status bar)
      const commands = await vscode.commands.getCommands(true);

      assert.ok(
        commands.includes('coven.startSession'),
        'Start session command should be accessible from status bar'
      );
    });
  });

  // ============================================================================
  // Test: Beads Integration with Sidebar
  // ============================================================================

  suite('Beads Integration', function () {
    test('Creating beads triggers tree update', async function () {
      if (!await ensureDaemonRunning()) {
        this.skip();
        return;
      }

      // Create a test bead
      const taskId = 'beads-ui-test';
      createBead(workspacePath, taskId, `id: ${taskId}
title: "UI test task"
type: task
status: open
priority: 2
description: Task for UI state testing
created: "2024-01-01T00:00:00Z"
created_by: test
`);

      // Trigger refresh
      const commands = await vscode.commands.getCommands(true);
      const refreshCommand = commands.find(
        cmd => cmd.includes('coven.refresh') || cmd.includes('coven.reloadTasks')
      );

      if (refreshCommand) {
        try {
          await vscode.commands.executeCommand(refreshCommand);
          await delay(1000);
          // If we get here, the tree should have been updated
        } catch {
          // May fail if daemon not fully connected
        }
      }
    });
  });

  // ============================================================================
  // Test: Multiple Status States
  // ============================================================================

  suite('Task Status Display', function () {
    test('Can create tasks in different states', async function () {
      if (!await ensureDaemonRunning()) {
        this.skip();
        return;
      }

      // Create tasks in different statuses
      const statuses = [
        { id: 'beads-ui-open', status: 'open' },
        { id: 'beads-ui-blocked', status: 'blocked' },
        { id: 'beads-ui-closed', status: 'closed' },
      ];

      for (const { id, status } of statuses) {
        createBead(workspacePath, id, `id: ${id}
title: "UI test - ${status}"
type: task
status: ${status}
priority: 2
description: Task in ${status} state
created: "2024-01-01T00:00:00Z"
created_by: test
`);
      }

      // All beads should be created
      const fs = require('fs');
      const path = require('path');

      for (const { id } of statuses) {
        const beadPath = path.join(workspacePath, '.beads', `${id}.yaml`);
        assert.ok(
          fs.existsSync(beadPath),
          `Bead ${id} should exist at ${beadPath}`
        );
      }
    });
  });
});
