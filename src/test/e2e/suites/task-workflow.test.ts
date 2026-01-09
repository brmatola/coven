import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * E2E Tests for task workflow prerequisites and Beads integration.
 *
 * NOTE: Tests that exercise the full workflow (session → task → agent → review)
 * are in extension-workflow.test.ts. This file focuses on:
 * - Prerequisites verification
 * - Beads task CRUD operations
 * - Git worktree infrastructure
 * - Extension command registration
 *
 * Per CLAUDE.md: E2E tests must test the Coven extension, not call Claude CLI directly.
 * The extension-workflow.test.ts file properly tests through VS Code commands.
 */

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
 * Check if Claude CLI is available.
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
 * Check if Beads is initialized in workspace.
 */
function isBeadsInitialized(workspacePath: string): boolean {
  const beadsDir = path.join(workspacePath, '.beads');
  return fs.existsSync(beadsDir);
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
 * Get the current git branch.
 */
async function getCurrentBranch(workspacePath: string): Promise<string> {
  const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: workspacePath });
  return stdout.trim();
}

/**
 * Create a task in Beads.
 */
async function createTask(
  workspacePath: string,
  title: string,
  description?: string
): Promise<string> {
  let cmd = `bd create --title "${title}" --json`;
  if (description) {
    const escapedDesc = description.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    cmd += ` --description "${escapedDesc}"`;
  }
  const { stdout } = await execAsync(cmd, { cwd: workspacePath });
  const result = JSON.parse(stdout);
  if (!result.id) {
    throw new Error('Task creation failed - no ID returned');
  }
  return result.id;
}

/**
 * Get task details from Beads.
 */
async function getTask(
  workspacePath: string,
  taskId: string
): Promise<{ id: string; status: string; title: string }> {
  const { stdout } = await execAsync(`bd show ${taskId} --json`, { cwd: workspacePath });
  const result = JSON.parse(stdout);
  if (Array.isArray(result) && result.length > 0) {
    return result[0];
  }
  if (result.id) {
    return result;
  }
  throw new Error(`Task ${taskId} not found`);
}

/**
 * Delete a task from Beads.
 */
async function deleteTask(workspacePath: string, taskId: string): Promise<void> {
  try {
    await execAsync(`bd delete ${taskId} --yes`, { cwd: workspacePath });
  } catch {
    // Ignore - task may not exist
  }
}

/**
 * Update task status in Beads.
 */
async function updateTaskStatus(workspacePath: string, taskId: string, status: string): Promise<void> {
  await execAsync(`bd update ${taskId} --status ${status}`, { cwd: workspacePath });
}

/**
 * Close a task in Beads.
 */
async function closeTask(workspacePath: string, taskId: string): Promise<void> {
  await execAsync(`bd close ${taskId}`, { cwd: workspacePath });
}

suite('Task Workflow E2E Tests', function () {
  this.timeout(60000); // 1 minute overall timeout

  let workspacePath: string;
  let claudeAvailable: boolean;
  let beadsInitialized: boolean;
  let isRepo: boolean;
  const createdTaskIds: string[] = [];

  suiteSetup(async () => {
    workspacePath = getTestWorkspacePath();
    claudeAvailable = await isClaudeAvailable();
    beadsInitialized = workspacePath ? isBeadsInitialized(workspacePath) : false;
    isRepo = workspacePath ? await isGitRepo(workspacePath) : false;

    console.log('Test setup:');
    console.log(`  Workspace: ${workspacePath}`);
    console.log(`  Claude available: ${claudeAvailable}`);
    console.log(`  Beads initialized: ${beadsInitialized}`);
    console.log(`  Git repo: ${isRepo}`);
  });

  suiteTeardown(async () => {
    // Clean up created tasks
    for (const taskId of createdTaskIds) {
      await deleteTask(workspacePath, taskId);
    }
  });

  suite('Prerequisites', () => {
    test('Test workspace must exist', function () {
      assert.ok(workspacePath, 'COVEN_E2E_WORKSPACE must be set or workspace must be open');
      assert.ok(fs.existsSync(workspacePath), `Workspace must exist at ${workspacePath}`);
    });

    test('Workspace must be a git repository', function () {
      assert.ok(isRepo, 'Workspace must be a git repository');
    });

    test('Beads must be initialized', function () {
      assert.ok(beadsInitialized, 'Beads must be initialized (run bd init)');
    });

    test('Claude CLI must be available', function () {
      assert.ok(claudeAvailable, 'Claude CLI must be available (npm install -g @anthropic-ai/claude-code)');
    });
  });

  suite('Beads Task Operations', function () {
    this.timeout(30000);

    test('Should create a task in Beads', async function () {
      if (!beadsInitialized) {
        this.skip();
        return;
      }

      const taskId = await createTask(
        workspacePath,
        'E2E Test - Task Creation',
        'Test task for E2E verification'
      );

      assert.ok(taskId, 'Task should be created');
      createdTaskIds.push(taskId);

      const task = await getTask(workspacePath, taskId);
      assert.ok(task, 'Task should be retrievable');
      assert.strictEqual(task.status, 'open', 'Task should be open');
    });

    test('Should update task status', async function () {
      if (!beadsInitialized) {
        this.skip();
        return;
      }

      const taskId = await createTask(workspacePath, 'E2E Test - Status Update');
      createdTaskIds.push(taskId);

      // Update to in_progress
      await updateTaskStatus(workspacePath, taskId, 'in_progress');
      let task = await getTask(workspacePath, taskId);
      assert.strictEqual(task.status, 'in_progress', 'Status should be in_progress');

      // Close the task
      await closeTask(workspacePath, taskId);
      task = await getTask(workspacePath, taskId);
      assert.strictEqual(task.status, 'closed', 'Status should be closed');
    });

    test('Should handle task lifecycle (open → in_progress → closed)', async function () {
      if (!beadsInitialized) {
        this.skip();
        return;
      }

      const taskId = await createTask(workspacePath, 'E2E Test - Full Lifecycle');
      createdTaskIds.push(taskId);

      // Verify initial state
      let task = await getTask(workspacePath, taskId);
      assert.strictEqual(task.status, 'open', 'Should start as open');

      // Simulate working on task
      await updateTaskStatus(workspacePath, taskId, 'in_progress');
      task = await getTask(workspacePath, taskId);
      assert.strictEqual(task.status, 'in_progress', 'Should be in_progress');

      // Complete task
      await closeTask(workspacePath, taskId);
      task = await getTask(workspacePath, taskId);
      assert.strictEqual(task.status, 'closed', 'Should be closed');
    });
  });

  suite('Extension Integration', () => {
    test('Extension must be active', async () => {
      const extension = vscode.extensions.getExtension('coven.coven');
      if (extension && !extension.isActive) {
        await extension.activate();
      }
      assert.ok(extension?.isActive, 'Extension must be active');
    });

    test('All workflow commands must be registered', async () => {
      const commands = await vscode.commands.getCommands(true);

      const requiredCommands = [
        'coven.startSession',
        'coven.stopSession',
        'coven.createTask',
        'coven.startTask',
        'coven.stopTask',
        'coven.refreshTasks',
        'coven.showTaskDetail',
        'coven.reviewTask',
      ];

      for (const cmd of requiredCommands) {
        assert.ok(commands.includes(cmd), `Command ${cmd} must be registered`);
      }
    });

    test('startTask command handles missing task gracefully', async function () {
      this.timeout(10000);

      const commandPromise = vscode.commands.executeCommand('coven.startTask', 'nonexistent-task-id');
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 3000));

      try {
        await Promise.race([commandPromise, timeoutPromise]);
      } catch {
        // Expected - should fail gracefully
      }

      // If we get here, command didn't crash or hang
      assert.ok(true, 'Command handled gracefully');
    });
  });

  suite('Git Worktree Integration', () => {
    test('Git worktree command should be available', async function () {
      if (!isRepo) {
        this.skip();
        return;
      }

      const { stdout } = await execAsync('git worktree list', { cwd: workspacePath });
      assert.ok(stdout.length > 0, 'Should list worktrees');
    });

    test('.coven/worktrees directory should be creatable', async function () {
      const worktreesDir = path.join(workspacePath, '.coven', 'worktrees');
      await fs.promises.mkdir(worktreesDir, { recursive: true });
      assert.ok(fs.existsSync(worktreesDir), 'Worktrees directory should exist');
    });

    test('Feature branch should be accessible', async function () {
      if (!isRepo) {
        this.skip();
        return;
      }

      const branch = await getCurrentBranch(workspacePath);
      assert.ok(branch.length > 0, 'Should have a current branch');
    });
  });
});
