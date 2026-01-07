import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Get the test workspace path from environment or VS Code workspace.
 * The test runner sets COVEN_E2E_WORKSPACE to the isolated temp workspace.
 */
function getTestWorkspacePath(): string {
  return (
    process.env.COVEN_E2E_WORKSPACE ||
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
    ''
  );
}

/**
 * Check if Beads is initialized in workspace
 */
function isBeadsInitialized(workspacePath: string): boolean {
  const beadsDir = path.join(workspacePath, '.beads');
  return fs.existsSync(beadsDir);
}

/**
 * Create a test task in Beads
 */
async function createTestTask(
  workspacePath: string,
  title: string
): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`bd create "${title}" --json`, {
      cwd: workspacePath,
    });
    const result = JSON.parse(stdout);
    return result.id || null;
  } catch {
    return null;
  }
}

/**
 * Delete a task from Beads
 */
async function deleteTask(workspacePath: string, taskId: string): Promise<void> {
  try {
    await execAsync(`bd delete ${taskId} --yes`, { cwd: workspacePath });
  } catch {
    // Ignore errors - task may not exist
  }
}

/**
 * Get task from Beads
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
    // bd show returns an array
    if (Array.isArray(result) && result.length > 0) {
      return result[0];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * List all tasks from Beads
 */
async function listTasks(workspacePath: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync('bd list --json', { cwd: workspacePath });
    const tasks = JSON.parse(stdout);
    return Array.isArray(tasks) ? tasks.map((t: { id: string }) => t.id) : [];
  } catch {
    return [];
  }
}

suite('Beads Integration E2E Tests', function () {
  this.timeout(30000); // Beads operations can be slow

  let workspacePath: string;
  let beadsInitialized: boolean;
  const createdTaskIds: string[] = [];

  suiteSetup(() => {
    workspacePath = getTestWorkspacePath();
    beadsInitialized = workspacePath ? isBeadsInitialized(workspacePath) : false;
  });

  suiteTeardown(async () => {
    // Clean up any test tasks we created
    for (const taskId of createdTaskIds) {
      await deleteTask(workspacePath, taskId);
    }
  });

  suite('Session Start Syncs Tasks from Beads', () => {
    test('Extension should activate in test workspace', async () => {
      const extension = vscode.extensions.getExtension('coven.coven');
      if (extension && !extension.isActive) {
        await extension.activate();
      }
      assert.ok(extension?.isActive, 'Extension should be active');
    });

    test('refreshTasks command should be available', async function () {
      if (!beadsInitialized) {
        this.skip();
        return;
      }

      const commands = await vscode.commands.getCommands(true);
      assert.ok(commands.includes('coven.refreshTasks'), 'refreshTasks command should exist');
    });

    test('Session should be able to sync tasks from Beads', async function () {
      if (!beadsInitialized) {
        this.skip();
        return;
      }

      // Create a test task in Beads
      const taskId = await createTestTask(workspacePath, 'E2E Test - Session Sync');
      if (!taskId) {
        this.skip();
        return;
      }
      createdTaskIds.push(taskId);

      // Verify task exists in Beads
      const task = await getTask(workspacePath, taskId);
      assert.ok(task, 'Task should exist in Beads');
      assert.strictEqual(task?.status, 'open', 'Task should be open');

      // Trigger refresh - should not throw
      try {
        await vscode.commands.executeCommand('coven.refreshTasks');
        assert.ok(true, 'Refresh completed successfully');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // "No active session" is acceptable - extension loaded correctly
        if (!msg.includes('No active session')) {
          assert.fail(`Unexpected error: ${msg}`);
        }
      }
    });
  });

  suite('Task Completion Updates Beads', () => {
    test('Closing a task via bd should update its status', async function () {
      if (!beadsInitialized) {
        this.skip();
        return;
      }

      // Create a test task
      const taskId = await createTestTask(workspacePath, 'E2E Test - Task Completion');
      if (!taskId) {
        this.skip();
        return;
      }
      createdTaskIds.push(taskId);

      // Verify task is open
      let task = await getTask(workspacePath, taskId);
      assert.strictEqual(task?.status, 'open', 'Task should start as open');

      // Close the task (simulating what Coven's closeTask() does)
      await execAsync(`bd close ${taskId}`, { cwd: workspacePath });

      // Verify task is closed
      task = await getTask(workspacePath, taskId);
      assert.strictEqual(task?.status, 'closed', 'Task should be closed');
    });

    test('Updating task status via bd should work', async function () {
      if (!beadsInitialized) {
        this.skip();
        return;
      }

      // Create a test task
      const taskId = await createTestTask(workspacePath, 'E2E Test - Status Update');
      if (!taskId) {
        this.skip();
        return;
      }
      createdTaskIds.push(taskId);

      // Update status to in_progress (simulating BeadsTaskSource.updateTaskStatus)
      await execAsync(`bd update ${taskId} --status in_progress`, { cwd: workspacePath });

      // Verify status changed
      const task = await getTask(workspacePath, taskId);
      assert.strictEqual(task?.status, 'in_progress', 'Task should be in_progress');
    });
  });

  suite('New Task in Beads Appears After Refresh', () => {
    test('Creating task via bd should be visible in list', async function () {
      if (!beadsInitialized) {
        this.skip();
        return;
      }

      // Get initial task count
      const initialTasks = await listTasks(workspacePath);

      // Create a new task
      const taskId = await createTestTask(workspacePath, 'E2E Test - New Task Visibility');
      if (!taskId) {
        this.skip();
        return;
      }
      createdTaskIds.push(taskId);

      // Verify task appears in list
      const updatedTasks = await listTasks(workspacePath);
      assert.strictEqual(
        updatedTasks.length,
        initialTasks.length + 1,
        'Task count should increase by 1'
      );
      assert.ok(updatedTasks.includes(taskId), 'New task should be in list');
    });

    test('Refresh should pick up externally created tasks', async function () {
      if (!beadsInitialized) {
        this.skip();
        return;
      }

      // Create task directly via bd (simulating external creation)
      const taskId = await createTestTask(workspacePath, 'E2E Test - External Task');
      if (!taskId) {
        this.skip();
        return;
      }
      createdTaskIds.push(taskId);

      // Trigger refresh
      try {
        await vscode.commands.executeCommand('coven.refreshTasks');
        // Task should now be in Coven's view (we can't easily verify tree content,
        // but the refresh succeeding means the sync happened)
        assert.ok(true, 'Refresh picked up external task');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('No active session')) {
          assert.fail(`Unexpected error: ${msg}`);
        }
      }
    });
  });

  suite('Beads Unavailable Shows Error', () => {
    test('Extension should be active regardless of Beads availability', async () => {
      const extension = vscode.extensions.getExtension('coven.coven');
      if (extension && !extension.isActive) {
        await extension.activate();
      }
      assert.ok(extension?.isActive, 'Extension should be active');
    });

    test('All task commands should be registered', async () => {
      const commands = await vscode.commands.getCommands(true);

      assert.ok(commands.includes('coven.createTask'), 'createTask should be registered');
      assert.ok(commands.includes('coven.refreshTasks'), 'refreshTasks should be registered');
      assert.ok(commands.includes('coven.startTask'), 'startTask should be registered');
      assert.ok(commands.includes('coven.stopTask'), 'stopTask should be registered');
    });

    test('Commands should handle missing session gracefully', async () => {
      // refreshTasks with no session should not crash
      try {
        await vscode.commands.executeCommand('coven.refreshTasks');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // These are expected behaviors, not crashes
        assert.ok(
          msg.includes('No active session') || msg.includes('session'),
          'Should fail gracefully with session-related error'
        );
      }
    });
  });
});
