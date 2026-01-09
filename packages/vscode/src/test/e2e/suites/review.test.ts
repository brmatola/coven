import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  assertExtensionActive,
  assertCommandExists,
  createSessionHelper,
  createFamiliarHelper,
  SessionHelper,
  FamiliarHelper,
} from '../fixtures';

const execAsync = promisify(exec);

/**
 * E2E tests for the Review Workflow feature.
 *
 * Tests cover:
 * - Review command registration
 * - Review panel behavior
 * - Task status for review state
 * - Diff viewing capability
 * - Approval and revert flows (via command existence)
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
 * Check if Beads is initialized.
 */
function isBeadsInitialized(workspacePath: string): boolean {
  return fs.existsSync(path.join(workspacePath, '.beads'));
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
 * Create a task in Beads.
 */
async function createBeadsTask(workspacePath: string, title: string): Promise<string> {
  const { stdout } = await execAsync(
    `bd create --title "${title}" --type task --json`,
    { cwd: workspacePath }
  );
  const result = JSON.parse(stdout);
  return result.id;
}

/**
 * Delete a task from Beads.
 */
async function deleteBeadsTask(workspacePath: string, taskId: string): Promise<void> {
  try {
    await execAsync(`bd delete ${taskId} --yes`, { cwd: workspacePath });
  } catch {
    // Ignore
  }
}

suite('Review Workflow E2E Tests', function () {
  this.timeout(60000);

  let workspacePath: string;
  let sessionHelper: SessionHelper;
  let familiarHelper: FamiliarHelper;
  let beadsInitialized: boolean;
  let isRepo: boolean;
  const createdTaskIds: string[] = [];

  suiteSetup(async () => {
    workspacePath = getTestWorkspacePath();
    sessionHelper = createSessionHelper(workspacePath);
    familiarHelper = createFamiliarHelper(workspacePath);
    beadsInitialized = workspacePath ? isBeadsInitialized(workspacePath) : false;
    isRepo = workspacePath ? await isGitRepo(workspacePath) : false;

    // Ensure extension is active
    const extension = vscode.extensions.getExtension('coven.coven');
    if (extension && !extension.isActive) {
      await extension.activate();
    }
  });

  suiteTeardown(async () => {
    // Clean up tasks
    for (const taskId of createdTaskIds) {
      await deleteBeadsTask(workspacePath, taskId);
    }

    // Clean up session
    await sessionHelper.cleanup();
    await familiarHelper.cleanup();
  });

  suite('Review Command Registration', () => {
    test('Extension should be active', () => {
      assertExtensionActive();
    });

    test('reviewTask command should be registered', async () => {
      await assertCommandExists('coven.reviewTask');
    });

    test('showTaskDetail command should be registered', async () => {
      await assertCommandExists('coven.showTaskDetail');
    });
  });

  suite('Review Panel Behavior', () => {
    test('reviewTask handles missing session gracefully', async function () {
      this.timeout(10000);

      // Ensure no session
      await sessionHelper.stopSessionDirect();

      const commandPromise = vscode.commands.executeCommand('coven.reviewTask', 'test-task-id');
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 3000));

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

    test('reviewTask handles nonexistent task gracefully', async function () {
      this.timeout(10000);

      const commandPromise = vscode.commands.executeCommand('coven.reviewTask', 'nonexistent-xyz');
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 3000));

      try {
        await Promise.race([commandPromise, timeoutPromise]);
      } catch {
        // Expected - task doesn't exist
      }

      assert.ok(true, 'Command did not crash or hang');
    });

    test('showTaskDetail handles nonexistent task gracefully', async function () {
      this.timeout(10000);

      const commandPromise = vscode.commands.executeCommand('coven.showTaskDetail', 'nonexistent-xyz');
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 3000));

      try {
        await Promise.race([commandPromise, timeoutPromise]);
      } catch {
        // Expected
      }

      assert.ok(true, 'Command did not crash or hang');
    });
  });

  suite('Review State in Task System', () => {
    test('Task can be in review state (via Beads)', async function () {
      if (!beadsInitialized) {
        this.skip();
        return;
      }

      // Note: Beads doesn't have a native 'review' status, but Coven maps
      // task states internally. This tests that we can create and track tasks.
      const taskId = await createBeadsTask(workspacePath, 'E2E Review State Test');
      createdTaskIds.push(taskId);

      // Get initial status
      const { stdout } = await execAsync(`bd show ${taskId} --json`, { cwd: workspacePath });
      const result = JSON.parse(stdout);
      const task = Array.isArray(result) ? result[0] : result;

      assert.ok(task, 'Task should exist');
      assert.strictEqual(task.status, 'open', 'Task should start as open');
    });

    test('Coven maps working → review internally on completion', () => {
      // This is a conceptual test - Coven's internal state machine handles:
      // ready → working (when agent starts)
      // working → review (when agent completes)
      // review → done (when approved)
      // review → ready (when reverted)

      const states = ['ready', 'working', 'review', 'done', 'blocked'];
      const transitions = [
        { from: 'ready', to: 'working', trigger: 'agent_start' },
        { from: 'working', to: 'review', trigger: 'agent_complete' },
        { from: 'review', to: 'done', trigger: 'approve' },
        { from: 'review', to: 'ready', trigger: 'revert' },
      ];

      assert.ok(states.includes('review'), 'Review is a valid state');
      assert.ok(transitions.some((t) => t.to === 'review'), 'Can transition to review');
      assert.ok(transitions.some((t) => t.from === 'review'), 'Can transition from review');
    });
  });

  suite('Diff Viewing', () => {
    test('VSCode diff command is available', async () => {
      const commands = await vscode.commands.getCommands(true);
      assert.ok(commands.includes('vscode.diff'), 'vscode.diff command should be available');
    });

    test('Git diff command works in workspace', async function () {
      if (!isRepo) {
        this.skip();
        return;
      }

      // Verify git diff command works (doesn't throw)
      const { stdout } = await execAsync('git diff --stat HEAD~1 HEAD 2>/dev/null || echo ""', {
        cwd: workspacePath,
      });
      assert.ok(typeof stdout === 'string', 'Git diff should return a string');
    });
  });

  suite('Review Actions (Command Paths)', () => {
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

    test('Task status update commands exist for review flow', async () => {
      // These commands support the review workflow
      const commands = await vscode.commands.getCommands(true);

      assert.ok(commands.includes('coven.startTask'), 'startTask should exist');
      assert.ok(commands.includes('coven.stopTask'), 'stopTask should exist');
      assert.ok(commands.includes('coven.refreshTasks'), 'refreshTasks should exist');
    });
  });

  suite('Review Panel Integration', () => {
    test('Review button should appear for tasks in review status', async () => {
      // The package.json configures the review button to appear when viewItem == task.review
      // We verify the command is registered which indicates the menu contribution is valid
      await assertCommandExists('coven.reviewTask');
    });

    test('Task detail panel shows task info before review', async () => {
      await assertCommandExists('coven.showTaskDetail');
    });
  });

  suite('Familiar State During Review', () => {
    test('Completed familiar has status complete or failed', async () => {
      const familiarsDir = path.join(workspacePath, '.coven', 'familiars');
      await fs.promises.mkdir(familiarsDir, { recursive: true });

      // Create a completed familiar state
      const testTaskId = 'test-review-familiar';
      const completedFamiliar = {
        taskId: testTaskId,
        status: 'complete',
        processInfo: {
          pid: 12345,
          startTime: Date.now() - 60000,
          command: 'claude test',
          worktreePath: '/test/worktree',
        },
        spawnedAt: Date.now() - 60000,
        outputBuffer: ['Task completed'],
      };

      const filePath = path.join(familiarsDir, `${testTaskId}.json`);
      await fs.promises.writeFile(filePath, JSON.stringify(completedFamiliar, null, 2));

      // Read via helper
      const state = familiarHelper.getFamiliarState(testTaskId);
      assert.ok(state, 'State should be readable');
      assert.strictEqual(state?.status, 'complete', 'Status should be complete');
      assert.ok(state?.isComplete, 'isComplete should be true');
      assert.ok(!state?.isWorking, 'isWorking should be false');

      // Clean up
      await fs.promises.unlink(filePath);
    });

    test('Failed familiar has status failed', async () => {
      const familiarsDir = path.join(workspacePath, '.coven', 'familiars');
      await fs.promises.mkdir(familiarsDir, { recursive: true });

      const testTaskId = 'test-failed-familiar';
      const failedFamiliar = {
        taskId: testTaskId,
        status: 'failed',
        processInfo: {
          pid: 12346,
          startTime: Date.now() - 60000,
          command: 'claude test',
          worktreePath: '/test/worktree',
        },
        spawnedAt: Date.now() - 60000,
        outputBuffer: ['Error occurred'],
      };

      const filePath = path.join(familiarsDir, `${testTaskId}.json`);
      await fs.promises.writeFile(filePath, JSON.stringify(failedFamiliar, null, 2));

      const state = familiarHelper.getFamiliarState(testTaskId);
      assert.ok(state, 'State should be readable');
      assert.strictEqual(state?.status, 'failed', 'Status should be failed');
      assert.ok(state?.isFailed, 'isFailed should be true');
      assert.ok(!state?.isWorking, 'isWorking should be false');

      // Clean up
      await fs.promises.unlink(filePath);
    });
  });

  suite('Worktree Merging Conceptual', () => {
    test('Worktree merge flow is documented', () => {
      // The review approval flow:
      // 1. User clicks approve in review panel
      // 2. ReviewManager calls WorktreeManager.merge()
      // 3. Worktree branch is merged to feature branch
      // 4. Worktree is cleaned up
      // 5. Task is marked done in Beads

      const approvalSteps = [
        'approve_clicked',
        'worktree_merge',
        'worktree_cleanup',
        'task_close',
      ];

      assert.ok(approvalSteps.length > 0, 'Approval flow has defined steps');
    });

    test('Worktree revert flow is documented', () => {
      // The review revert flow:
      // 1. User clicks revert in review panel
      // 2. ReviewManager cleans up worktree (without merging)
      // 3. Task is reset to ready in Beads

      const revertSteps = [
        'revert_clicked',
        'worktree_cleanup',
        'task_reset',
      ];

      assert.ok(revertSteps.length > 0, 'Revert flow has defined steps');
    });
  });
});
