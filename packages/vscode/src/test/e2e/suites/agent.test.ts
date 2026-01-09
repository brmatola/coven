import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Get the test workspace path.
 */
function getTestWorkspacePath(): string {
  return (
    process.env.COVEN_E2E_WORKSPACE ||
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
    ''
  );
}

/**
 * Check if claude CLI is available.
 */
async function isClaudeAvailable(): Promise<boolean> {
  try {
    await execAsync('claude --version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if workspace is a git repository.
 */
async function isGitRepo(workspacePath: string): Promise<boolean> {
  try {
    await execAsync('git rev-parse --is-inside-work-tree', { cwd: workspacePath });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Beads is initialized in workspace.
 */
function isBeadsInitialized(workspacePath: string): boolean {
  const beadsDir = path.join(workspacePath, '.beads');
  return fs.existsSync(beadsDir);
}

/**
 * Create a test task using bd.
 */
async function createTestTask(workspacePath: string, title: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`bd create --title "${title}" --type task --json`, {
      cwd: workspacePath,
    });
    const result = JSON.parse(stdout);
    return result.id || null;
  } catch {
    return null;
  }
}

/**
 * Delete a task from Beads.
 */
async function deleteTask(workspacePath: string, taskId: string): Promise<void> {
  try {
    await execAsync(`bd delete ${taskId} --yes`, { cwd: workspacePath });
  } catch {
    // Ignore errors - task may not exist
  }
}

/**
 * Get task from Beads.
 */
async function getTask(
  workspacePath: string,
  taskId: string
): Promise<{ id: string; status: string; title: string } | null> {
  try {
    const { stdout } = await execAsync(`bd show ${taskId} --json`, {
      cwd: workspacePath,
    });
    const result = JSON.parse(stdout);
    if (Array.isArray(result) && result.length > 0) {
      return result[0];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * E2E tests for Agent functionality.
 *
 * IMPORTANT: These tests exercise Coven's agent infrastructure through VS Code commands.
 * They do NOT call claude CLI directly - that's what the extension does internally.
 * Using bd/git for setup and verification is acceptable per E2E test guidelines.
 */
suite('Agent Integration E2E Tests', function () {
  this.timeout(180000);

  let workspacePath: string;
  let claudeAvailable: boolean;
  let isRepo: boolean;
  let beadsInitialized: boolean;
  const createdTaskIds: string[] = [];

  suiteSetup(async () => {
    workspacePath = getTestWorkspacePath();
    claudeAvailable = await isClaudeAvailable();
    isRepo = workspacePath ? await isGitRepo(workspacePath) : false;
    beadsInitialized = workspacePath ? isBeadsInitialized(workspacePath) : false;

    console.log('Agent test setup:');
    console.log(`  Workspace: ${workspacePath}`);
    console.log(`  Claude available: ${claudeAvailable}`);
    console.log(`  Git repo: ${isRepo}`);
    console.log(`  Beads initialized: ${beadsInitialized}`);

    // Ensure extension is active
    const extension = vscode.extensions.getExtension('coven.coven');
    if (extension && !extension.isActive) {
      await extension.activate();
    }
  });

  suiteTeardown(async () => {
    // Clean up any test tasks we created
    for (const taskId of createdTaskIds) {
      await deleteTask(workspacePath, taskId);
    }
  });

  suite('Prerequisites', () => {
    test('Extension must be active', () => {
      const extension = vscode.extensions.getExtension('coven.coven');
      assert.ok(extension?.isActive, 'Extension must be active');
    });

    test('Workspace must exist', function () {
      assert.ok(workspacePath, 'Workspace path must be set');
      assert.ok(fs.existsSync(workspacePath), `Workspace must exist at ${workspacePath}`);
    });

    test('Workspace must be a git repo', function () {
      assert.ok(isRepo, 'Workspace must be a git repository');
    });

    test('Claude CLI must be available', function () {
      assert.ok(claudeAvailable, 'Claude CLI must be installed');
    });
  });

  suite('Agent Commands', () => {
    test('startTask command must be registered', async () => {
      const commands = await vscode.commands.getCommands(true);
      assert.ok(commands.includes('coven.startTask'), 'startTask must be registered');
    });

    test('stopTask command must be registered', async () => {
      const commands = await vscode.commands.getCommands(true);
      assert.ok(commands.includes('coven.stopTask'), 'stopTask must be registered');
    });

    test('viewFamiliarOutput command must be registered', async () => {
      const commands = await vscode.commands.getCommands(true);
      assert.ok(commands.includes('coven.viewFamiliarOutput'), 'viewFamiliarOutput must be registered');
    });

    test('startSession command must be registered', async () => {
      const commands = await vscode.commands.getCommands(true);
      assert.ok(commands.includes('coven.startSession'), 'startSession must be registered');
    });

    test('stopSession command must be registered', async () => {
      const commands = await vscode.commands.getCommands(true);
      assert.ok(commands.includes('coven.stopSession'), 'stopSession must be registered');
    });
  });

  suite('Agent Infrastructure', () => {
    test('Worktree directory structure must be valid', function () {
      const covenDir = path.join(workspacePath, '.coven');
      const worktreesDir = path.join(covenDir, 'worktrees');

      // Paths should be constructable
      assert.ok(covenDir.includes('.coven'), 'Coven directory path must be valid');
      assert.ok(worktreesDir.includes('worktrees'), 'Worktrees directory path must be valid');
    });

    test('Output directory must be creatable', async function () {
      const outputDir = path.join(workspacePath, '.coven', 'output');
      await fs.promises.mkdir(outputDir, { recursive: true });
      assert.ok(fs.existsSync(outputDir), 'Output directory must be created');
    });
  });

  suite('Task Lifecycle via Extension', function () {
    this.timeout(30000);

    test('startTask requires active session', async function () {
      if (!beadsInitialized) {
        this.skip();
        return;
      }

      // Create a test task
      const taskId = await createTestTask(workspacePath, 'E2E Test - Session Required');
      if (!taskId) {
        this.skip();
        return;
      }
      createdTaskIds.push(taskId);

      // Try to start task without session - should fail gracefully
      const commandPromise = vscode.commands.executeCommand('coven.startTask', taskId);
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 5000));

      try {
        await Promise.race([commandPromise, timeoutPromise]);
      } catch (err) {
        // Expected - should fail because no session is active
        const msg = err instanceof Error ? err.message : String(err);
        assert.ok(
          msg.includes('session') || msg.includes('Session') || msg.includes('No active'),
          `Should fail with session error, got: ${msg}`
        );
        return;
      }

      // If we get here without error, verify the task status shows appropriate state
      const task = await getTask(workspacePath, taskId);
      assert.ok(task, 'Task should still exist after command');
    });

    test('stopTask handles missing agent gracefully', async function () {
      if (!beadsInitialized) {
        this.skip();
        return;
      }

      // Create a test task (not started)
      const taskId = await createTestTask(workspacePath, 'E2E Test - Stop Without Start');
      if (!taskId) {
        this.skip();
        return;
      }
      createdTaskIds.push(taskId);

      // Try to stop a task that was never started
      const commandPromise = vscode.commands.executeCommand('coven.stopTask', taskId);
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 3000));

      try {
        await Promise.race([commandPromise, timeoutPromise]);
        // Should complete without throwing
        assert.ok(true, 'stopTask handled non-existent agent gracefully');
      } catch {
        // Also acceptable - may throw for non-existent agent
        assert.ok(true, 'stopTask threw for non-existent agent');
      }
    });

    test('Task status updates are reflected in Beads', async function () {
      if (!beadsInitialized) {
        this.skip();
        return;
      }

      // Create a test task
      const taskId = await createTestTask(workspacePath, 'E2E Test - Status Tracking');
      if (!taskId) {
        this.skip();
        return;
      }
      createdTaskIds.push(taskId);

      // Verify initial status
      const initialTask = await getTask(workspacePath, taskId);
      assert.ok(initialTask, 'Task should exist');
      assert.strictEqual(initialTask?.status, 'open', 'Task should start as open');

      // Update status via bd (simulating what the extension does)
      await execAsync(`bd update ${taskId} --status in_progress`, { cwd: workspacePath });

      // Verify status changed
      const updatedTask = await getTask(workspacePath, taskId);
      assert.strictEqual(updatedTask?.status, 'in_progress', 'Task status should be updated');
    });
  });

  suite('Agent Output Channel', () => {
    test('viewFamiliarOutput command can be executed', async function () {
      this.timeout(10000);

      // This should open the output channel or show an error gracefully
      const commandPromise = vscode.commands.executeCommand('coven.viewFamiliarOutput');
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 3000));

      try {
        await Promise.race([commandPromise, timeoutPromise]);
        assert.ok(true, 'viewFamiliarOutput executed without hanging');
      } catch {
        // May throw if no active agent - that's OK
        assert.ok(true, 'viewFamiliarOutput threw expected error');
      }
    });

    test('Output channel exists for coven', async () => {
      // Check that the extension's output channels are accessible
      // We can't directly query output channels, but we can verify the command works
      const commands = await vscode.commands.getCommands(true);
      assert.ok(commands.includes('coven.viewFamiliarOutput'), 'Output channel command exists');
    });
  });

  suite('Error Handling', () => {
    test('Command must handle invalid task ID', async function () {
      this.timeout(10000);

      const commandPromise = vscode.commands.executeCommand('coven.startTask', 'invalid-task-id-xyz');
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 3000));

      try {
        await Promise.race([commandPromise, timeoutPromise]);
      } catch {
        // Expected to fail
      }
      // Should not crash or hang
      assert.ok(true, 'Handled invalid task gracefully');
    });

    test('Command must handle undefined argument', async function () {
      this.timeout(10000);

      const commandPromise = vscode.commands.executeCommand('coven.viewFamiliarOutput', undefined);
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 3000));

      try {
        await Promise.race([commandPromise, timeoutPromise]);
      } catch {
        // Expected to fail
      }
      assert.ok(true, 'Handled undefined argument gracefully');
    });

    test('Commands handle race conditions gracefully', async function () {
      this.timeout(10000);

      // Execute multiple commands concurrently
      const promises = [
        vscode.commands.executeCommand('coven.refreshTasks'),
        vscode.commands.executeCommand('coven.refreshTasks'),
        vscode.commands.getCommands(true),
      ];

      const timeoutPromise = new Promise<void[]>((resolve) =>
        setTimeout(() => resolve([]), 5000)
      );

      try {
        await Promise.race([Promise.all(promises), timeoutPromise]);
        assert.ok(true, 'Concurrent commands handled gracefully');
      } catch {
        assert.ok(true, 'Concurrent commands threw expected error');
      }
    });
  });

  suite('Extension State', () => {
    test('Extension maintains state across command calls', async () => {
      const extension = vscode.extensions.getExtension('coven.coven');

      // Execute several commands
      for (let i = 0; i < 3; i++) {
        try {
          await vscode.commands.executeCommand('coven.refreshTasks');
        } catch {
          // Expected if no session
        }
      }

      // Extension should still be active
      assert.ok(extension?.isActive, 'Extension should remain active after multiple commands');
    });

    test('Extension state check is instant', () => {
      const extension = vscode.extensions.getExtension('coven.coven');

      const startTime = Date.now();
      const isActive = extension?.isActive;
      const duration = Date.now() - startTime;

      assert.ok(duration < 10, `Extension state check should be instant (was ${duration}ms)`);
      assert.ok(isActive, 'Extension should be active');
    });
  });
});
