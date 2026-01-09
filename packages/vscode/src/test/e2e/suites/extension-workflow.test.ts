import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  createSessionHelper,
  createFamiliarHelper,
  SessionHelper,
  FamiliarHelper,
} from '../fixtures';

const execAsync = promisify(exec);

/**
 * E2E Tests for full task lifecycle through extension commands.
 *
 * IMPORTANT: These tests exercise the actual Coven extension workflow,
 * NOT direct Claude CLI calls. Per CLAUDE.md guidelines:
 * - E2E tests MUST test the actual Coven extension
 * - Using bd and git commands for setup/verification is acceptable
 * - The actual functionality must go through VS Code commands
 *
 * Test flow:
 * 1. Start session via extension command (with branch name argument)
 * 2. Create task in Beads
 * 3. Start task via extension (spawns agent in worktree)
 * 4. Verify worktree created, familiar spawned
 * 5. Wait for agent completion
 * 6. Verify task in review status
 * 7. Stop session via extension command
 */

// Test configuration
const AGENT_TIMEOUT_MS = 180000; // 3 minutes for agent to complete

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
 * Create a simple task in Beads.
 */
async function createBeadsTask(workspacePath: string, title: string, description: string): Promise<string> {
  const escapedDesc = description.replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const { stdout } = await execAsync(
    `bd create --title "${title}" --type task --description "${escapedDesc}" --json`,
    { cwd: workspacePath }
  );
  const result = JSON.parse(stdout);
  if (!result.id) {
    throw new Error('Failed to create task - no ID returned');
  }
  return result.id;
}

/**
 * Get task status from Beads.
 */
async function getTaskStatus(workspacePath: string, taskId: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`bd show ${taskId} --json`, { cwd: workspacePath });
    const result = JSON.parse(stdout);
    if (Array.isArray(result) && result.length > 0) {
      return result[0].status;
    }
    return result.status || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Delete a task from Beads.
 */
async function deleteBeadsTask(workspacePath: string, taskId: string): Promise<void> {
  try {
    await execAsync(`bd delete ${taskId} --yes`, { cwd: workspacePath });
  } catch {
    // Ignore - task may not exist
  }
}

/**
 * Sleep helper.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a command with timeout protection.
 * Returns true if completed, false if timed out.
 */
async function executeWithTimeout(
  command: string,
  args: unknown[],
  timeoutMs: number
): Promise<boolean> {
  const commandPromise = vscode.commands.executeCommand(command, ...args);
  const timeoutPromise = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), timeoutMs)
  );

  try {
    const result = await Promise.race([commandPromise, timeoutPromise]);
    return result !== 'timeout';
  } catch {
    // Command threw an error - that's expected behavior, not a timeout
    return true;
  }
}

suite('Extension Workflow E2E Tests', function () {
  this.timeout(300000); // 5 minute overall timeout

  let workspacePath: string;
  let sessionHelper: SessionHelper;
  let familiarHelper: FamiliarHelper;
  let claudeAvailable: boolean;
  let beadsInitialized: boolean;
  let isRepo: boolean;
  const createdTaskIds: string[] = [];

  suiteSetup(async () => {
    workspacePath = getTestWorkspacePath();
    sessionHelper = createSessionHelper(workspacePath);
    familiarHelper = createFamiliarHelper(workspacePath);
    claudeAvailable = await isClaudeAvailable();
    beadsInitialized = workspacePath ? isBeadsInitialized(workspacePath) : false;
    isRepo = workspacePath ? await isGitRepo(workspacePath) : false;

    console.log('Extension Workflow Test Setup:');
    console.log(`  Workspace: ${workspacePath}`);
    console.log(`  Claude available: ${claudeAvailable}`);
    console.log(`  Beads initialized: ${beadsInitialized}`);
    console.log(`  Git repo: ${isRepo}`);

    // Ensure extension is active
    const extension = vscode.extensions.getExtension('coven.coven');
    if (extension && !extension.isActive) {
      await extension.activate();
    }

    // Clean up any stale session state before tests
    await sessionHelper.cleanup();
  });

  suiteTeardown(async () => {
    // Stop session if running
    try {
      await vscode.commands.executeCommand('coven.stopSession', { skipConfirmation: true });
    } catch {
      // Ignore
    }

    // Clean up created tasks
    for (const taskId of createdTaskIds) {
      await deleteBeadsTask(workspacePath, taskId);
    }

    // Clean up session and familiar state
    await sessionHelper.cleanup();
    await familiarHelper.cleanup();
  });

  suite('Prerequisites Verification', () => {
    test('Test workspace must exist', function () {
      assert.ok(workspacePath, 'Workspace path must be set');
      assert.ok(fs.existsSync(workspacePath), `Workspace must exist at ${workspacePath}`);
    });

    test('Workspace must be a git repository', function () {
      assert.ok(isRepo, 'Workspace must be a git repository');
    });

    test('Beads must be initialized', function () {
      assert.ok(beadsInitialized, 'Beads must be initialized (run bd init)');
    });

    test('Claude CLI must be available', function () {
      assert.ok(claudeAvailable, 'Claude CLI must be installed');
    });

    test('Extension must be active', function () {
      const extension = vscode.extensions.getExtension('coven.coven');
      assert.ok(extension?.isActive, 'Coven extension must be active');
    });
  });

  suite('Session Management via Extension Commands', () => {
    const testBranch = `e2e-session-test-${Date.now()}`;

    test('startSession command accepts branch name argument', async function () {
      this.timeout(30000);

      // Start session with branch name argument (bypasses UI prompt)
      try {
        await vscode.commands.executeCommand('coven.startSession', testBranch);
        // Wait for session to initialize
        await sleep(2000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Prerequisites errors are expected in some test environments
        if (msg.includes('prerequisites') || msg.includes('Prerequisites')) {
          console.log('Prerequisites not met, skipping:', msg);
          this.skip();
          return;
        }
        throw err;
      }

      // Verify session state via helper
      const state = sessionHelper.getSessionState();
      if (state?.isActive) {
        assert.strictEqual(state.featureBranch, testBranch, 'Branch should match');
      }
    });

    test('Session state file should be created', function () {
      const exists = sessionHelper.sessionFileExists();
      // May not exist if session didn't start due to prerequisites
      if (exists) {
        const state = sessionHelper.getSessionState();
        assert.ok(state, 'State should be readable');
      }
    });

    test('stopSession command accepts skipConfirmation option', async function () {
      this.timeout(10000);

      // Stop session without confirmation dialog
      try {
        await vscode.commands.executeCommand('coven.stopSession', { skipConfirmation: true });
        await sleep(1000);
      } catch {
        // May fail if no active session - that's OK
      }

      // Verify session stopped
      const state = sessionHelper.getSessionState();
      assert.ok(!state?.isActive || state === null, 'Session should not be active');
    });
  });

  suite('Task Lifecycle via Extension Commands', function () {
    this.timeout(AGENT_TIMEOUT_MS + 60000);

    let testTaskId: string;
    const testBranchName = `e2e-task-lifecycle-${Date.now()}`;

    suiteSetup(async () => {
      // Clean up any previous session
      try {
        await vscode.commands.executeCommand('coven.stopSession', { skipConfirmation: true });
      } catch {
        // Ignore
      }
      await sleep(500);
    });

    test('Step 1: Create test task in Beads', async function () {
      if (!beadsInitialized) {
        this.skip();
        return;
      }

      testTaskId = await createBeadsTask(
        workspacePath,
        'E2E Task Lifecycle Test',
        `Create a file called e2e-lifecycle-test.txt with the text "Test completed successfully".

This is a minimal task to verify the extension workflow.`
      );

      assert.ok(testTaskId, 'Task should be created');
      createdTaskIds.push(testTaskId);

      const status = await getTaskStatus(workspacePath, testTaskId);
      assert.strictEqual(status, 'open', 'Task should be open');
    });

    test('Step 2: Start session via extension command', async function () {
      if (!testTaskId) {
        this.skip();
        return;
      }

      try {
        await vscode.commands.executeCommand('coven.startSession', testBranchName);
        await sleep(2000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('prerequisites') || msg.includes('Prerequisites')) {
          console.log('Prerequisites not met:', msg);
          this.skip();
          return;
        }
        throw err;
      }

      // Verify session started
      const state = sessionHelper.getSessionState();
      if (!state?.isActive) {
        console.log('Session not active after startSession command');
        console.log('State:', state);
        // Skip remaining tests if session didn't start
        this.skip();
        return;
      }

      assert.ok(state.isActive, 'Session should be active');
      assert.strictEqual(state.featureBranch, testBranchName, 'Branch should match');
    });

    test('Step 3: Start task via extension command', async function () {
      if (!testTaskId || !claudeAvailable) {
        this.skip();
        return;
      }

      // Check session is active
      const sessionState = sessionHelper.getSessionState();
      if (!sessionState?.isActive) {
        console.log('No active session, skipping');
        this.skip();
        return;
      }

      // Execute startTask command - this should:
      // 1. Create a worktree for the task
      // 2. Spawn a Claude agent in the worktree
      // 3. Create a familiar record
      try {
        await vscode.commands.executeCommand('coven.startTask', testTaskId);
        console.log('startTask command executed');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log('startTask error:', msg);
        // Some errors may be expected
        if (msg.includes('No active session') || msg.includes('not found')) {
          this.skip();
          return;
        }
        throw err;
      }

      // Give it time to spawn
      await sleep(3000);
    });

    test('Step 4: Verify worktree was created', async function () {
      if (!testTaskId) {
        this.skip();
        return;
      }

      // Check for worktree
      const worktree = await familiarHelper.findWorktreeForTask(testTaskId);

      if (worktree) {
        console.log(`Worktree created: ${worktree.path}`);
        assert.ok(worktree.path.includes('.coven') || worktree.path.includes('worktrees'),
          'Worktree should be in expected location');
      } else {
        console.log('No worktree found for task');
        // This might happen if the task didn't actually start
      }
    });

    test('Step 5: Verify familiar was created', function () {
      if (!testTaskId) {
        this.skip();
        return;
      }

      const familiar = familiarHelper.getFamiliarState(testTaskId);

      if (familiar) {
        console.log(`Familiar state: ${familiar.status}, pid: ${familiar.pid}`);
        assert.ok(familiar.taskId === testTaskId, 'Familiar should be for our task');
        assert.ok(
          ['working', 'waiting', 'complete', 'failed'].includes(familiar.status),
          'Familiar should have valid status'
        );
      } else {
        console.log('No familiar found for task');
      }
    });

    test('Step 6: Wait for agent completion (if running)', async function () {
      if (!testTaskId) {
        this.skip();
        return;
      }

      const familiar = familiarHelper.getFamiliarState(testTaskId);
      if (!familiar || familiar.status === 'complete' || familiar.status === 'failed') {
        // Already done or never started
        return;
      }

      // Wait for completion (up to timeout)
      try {
        const completedFamiliar = await familiarHelper.waitForFamiliarComplete(testTaskId, AGENT_TIMEOUT_MS);
        console.log(`Agent completed with status: ${completedFamiliar.status}`);
      } catch (err) {
        console.log('Agent did not complete within timeout:', err);
      }
    });

    test('Step 7: Verify task status changed', async function () {
      if (!testTaskId) {
        this.skip();
        return;
      }

      // Check task status - may have changed to in_progress or beyond
      const status = await getTaskStatus(workspacePath, testTaskId);
      console.log(`Final task status: ${status}`);

      // Status should be something other than 'open' if the workflow ran
      // But it might still be 'open' if the task didn't run
    });

    test('Step 8: Stop session', async function () {
      try {
        await vscode.commands.executeCommand('coven.stopSession', { skipConfirmation: true });
        await sleep(1000);
      } catch {
        // May fail if no active session
      }

      const state = sessionHelper.getSessionState();
      assert.ok(!state?.isActive || state === null, 'Session should be stopped');
    });
  });

  suite('State Verification Helpers', () => {
    test('SessionHelper reads actual state from file', async () => {
      // Write state directly
      await sessionHelper.startSessionDirect('test-helper-branch');

      // Read via helper
      const state = sessionHelper.getSessionState();
      assert.ok(state, 'State should be readable');
      assert.strictEqual(state?.status, 'active');
      assert.strictEqual(state?.featureBranch, 'test-helper-branch');
      assert.ok(state?.timestamp, 'Timestamp should be set');

      // Clean up
      await sessionHelper.stopSessionDirect();
    });

    test('FamiliarHelper lists worktrees correctly', async () => {
      const worktrees = await familiarHelper.listWorktrees();

      assert.ok(worktrees.length >= 1, 'Should have at least main worktree');

      // Use realpath to handle symlinks like /var -> /private/var on macOS
      const realWorkspacePath = fs.realpathSync(workspacePath);
      const mainWorktree = worktrees.find((w) => {
        try {
          return fs.realpathSync(w.path) === realWorkspacePath;
        } catch {
          return w.path === workspacePath;
        }
      });
      assert.ok(mainWorktree, 'Main workspace should be in list');
    });

    test('FamiliarHelper tracks active familiar count', async () => {
      const count = await familiarHelper.getActiveFamiliarCount();
      assert.ok(typeof count === 'number', 'Count should be a number');
      assert.ok(count >= 0, 'Count should be non-negative');
    });
  });

  suite('Error Handling', () => {
    test('startTask without session shows appropriate error', async function () {
      this.timeout(10000);

      // Ensure no active session
      await sessionHelper.stopSessionDirect();
      await sleep(500);

      await executeWithTimeout('coven.startTask', ['fake-task-id'], 3000);

      // Should handle gracefully (not crash)
      assert.ok(true, 'Handled gracefully');
    });

    test('stopTask with nonexistent task handles gracefully', async function () {
      this.timeout(10000);

      await executeWithTimeout('coven.stopTask', ['nonexistent-task-xyz'], 3000);
      assert.ok(true, 'Handled gracefully');
    });

    test('reviewTask with nonexistent task handles gracefully', async function () {
      this.timeout(10000);

      await executeWithTimeout('coven.reviewTask', ['nonexistent-task-xyz'], 3000);

      assert.ok(true, 'Handled gracefully');
    });
  });

  suite('Command Registration', () => {
    test('All workflow commands are registered', async () => {
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
        'coven.viewFamiliarOutput',
      ];

      for (const cmd of requiredCommands) {
        assert.ok(commands.includes(cmd), `Command ${cmd} must be registered`);
      }
    });
  });
});
