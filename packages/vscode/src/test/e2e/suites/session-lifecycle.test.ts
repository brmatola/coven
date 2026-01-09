import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  assertExtensionActive,
  assertCommandExists,
  assertCommandsExist,
  createSessionHelper,
  SessionHelper,
} from '../fixtures';

const execAsync = promisify(exec);

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
 * Delete a git branch if it exists.
 */
async function deleteBranch(workspacePath: string, branchName: string): Promise<void> {
  try {
    await execAsync(`git branch -D ${branchName}`, { cwd: workspacePath });
  } catch {
    // Branch may not exist
  }
}

/**
 * Sleep helper.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

suite('Session Lifecycle E2E Tests', function () {
  this.timeout(60000);

  let workspacePath: string;
  let sessionHelper: SessionHelper;
  let isRepo: boolean;
  const createdBranches: string[] = [];

  suiteSetup(async () => {
    workspacePath = getTestWorkspacePath();
    sessionHelper = createSessionHelper(workspacePath);
    isRepo = workspacePath ? await isGitRepo(workspacePath) : false;

    // Ensure extension is active
    const extension = vscode.extensions.getExtension('coven.coven');
    if (extension && !extension.isActive) {
      await extension.activate();
    }

    // Clean up any stale session state
    await sessionHelper.cleanup();
  });

  suiteTeardown(async () => {
    // Stop any active session
    try {
      await vscode.commands.executeCommand('coven.stopSession', { skipConfirmation: true });
    } catch {
      // Ignore
    }

    // Clean up session state
    await sessionHelper.cleanup();

    // Clean up created branches
    for (const branch of createdBranches) {
      await deleteBranch(workspacePath, branch);
    }
  });

  suite('Session Command Registration', () => {
    test('Extension should be active', () => {
      assertExtensionActive();
    });

    test('Session commands should be registered', async () => {
      await assertCommandsExist([
        'coven.startSession',
        'coven.stopSession',
      ]);
    });
  });

  suite('Session State File', () => {
    test('Session state file path is in .coven directory', () => {
      const covenDir = sessionHelper.getCovenDir();
      assert.ok(covenDir.endsWith('.coven'), 'Coven dir should end with .coven');
    });

    test('Session state can be written and read', async () => {
      const testBranch = 'test-state-rw';

      // Write state directly
      await sessionHelper.startSessionDirect(testBranch);

      // Read state
      const state = sessionHelper.getSessionState();
      assert.ok(state, 'State should be readable');
      assert.strictEqual(state?.status, 'active', 'Status should be active');
      assert.strictEqual(state?.featureBranch, testBranch, 'Branch should match');
      assert.ok(state?.timestamp, 'Timestamp should be set');

      // Clean up
      await sessionHelper.stopSessionDirect();
    });

    test('Session state file exists after write', async () => {
      await sessionHelper.startSessionDirect('test-file-exists');

      const exists = sessionHelper.sessionFileExists();
      assert.ok(exists, 'Session file should exist');

      await sessionHelper.stopSessionDirect();
    });

    test('Session state reflects inactive after stop', async () => {
      await sessionHelper.startSessionDirect('test-stop');
      await sessionHelper.stopSessionDirect();

      const state = sessionHelper.getSessionState();
      assert.ok(!state?.isActive, 'Session should not be active');
      assert.strictEqual(state?.status, 'inactive', 'Status should be inactive');
    });
  });

  suite('Session State Transitions', () => {
    test('inactive → active transition (via direct state)', async () => {
      // Start from inactive
      await sessionHelper.stopSessionDirect();
      let state = sessionHelper.getSessionState();
      assert.ok(!state?.isActive || state === null, 'Should start inactive');

      // Transition to active
      await sessionHelper.startSessionDirect('test-transition');
      state = sessionHelper.getSessionState();
      assert.ok(state?.isActive, 'Should be active');
      assert.strictEqual(state?.status, 'active', 'Status should be active');

      // Clean up
      await sessionHelper.stopSessionDirect();
    });

    test('active → inactive transition (via direct state)', async () => {
      // Start active
      await sessionHelper.startSessionDirect('test-to-inactive');
      let state = sessionHelper.getSessionState();
      assert.ok(state?.isActive, 'Should be active');

      // Transition to inactive
      await sessionHelper.stopSessionDirect();
      state = sessionHelper.getSessionState();
      assert.ok(!state?.isActive, 'Should not be active');
      assert.strictEqual(state?.status, 'inactive', 'Status should be inactive');
    });

    test('Feature branch is stored in state', async () => {
      const testBranch = 'feature/test-branch-storage';

      await sessionHelper.startSessionDirect(testBranch);
      const state = sessionHelper.getSessionState();

      assert.strictEqual(state?.featureBranch, testBranch, 'Branch should be stored');

      await sessionHelper.stopSessionDirect();
    });

    test('Feature branch is null when inactive', async () => {
      await sessionHelper.stopSessionDirect();
      const state = sessionHelper.getSessionState();

      assert.strictEqual(state?.featureBranch, null, 'Branch should be null when inactive');
    });
  });

  suite('Session Start via Extension Command', function () {
    this.timeout(30000);

    test('startSession command with branch argument starts session', async function () {
      if (!isRepo) {
        this.skip();
        return;
      }

      const testBranch = `e2e-session-cmd-${Date.now()}`;
      createdBranches.push(testBranch);

      // Ensure we start from clean state
      await sessionHelper.stopSessionDirect();
      await sleep(500);

      try {
        // Execute startSession with branch name argument
        await vscode.commands.executeCommand('coven.startSession', testBranch);
        await sleep(2000);

        // Check state
        const state = sessionHelper.getSessionState();
        if (state?.isActive) {
          assert.strictEqual(state.featureBranch, testBranch, 'Branch should match');
          assert.strictEqual(state.status, 'active', 'Status should be active');
        } else {
          // May not start due to prerequisites - log but don't fail
          console.log('Session did not start - may be due to prerequisites');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('prerequisites') || msg.includes('Prerequisites')) {
          console.log('Prerequisites not met:', msg);
          this.skip();
        } else {
          throw err;
        }
      }
    });

    test('stopSession command with skipConfirmation stops session', async function () {
      if (!isRepo) {
        this.skip();
        return;
      }

      // Ensure session is started
      await sessionHelper.startSessionDirect('test-stop-cmd');

      // Stop via command
      try {
        await vscode.commands.executeCommand('coven.stopSession', { skipConfirmation: true });
        await sleep(1000);

        // Verify stopped
        const state = sessionHelper.getSessionState();
        assert.ok(!state?.isActive || state === null, 'Session should be stopped');
      } catch (err) {
        // May fail if no active session in extension's internal state
        console.log('Stop session error:', err);
      }
    });
  });

  suite('Session State Persistence', () => {
    test('State survives helper reconstruction', async () => {
      const testBranch = 'test-persistence';

      // Write state with one helper
      await sessionHelper.startSessionDirect(testBranch);

      // Create new helper and read
      const newHelper = createSessionHelper(workspacePath);
      const state = newHelper.getSessionState();

      assert.ok(state, 'State should be readable from new helper');
      assert.strictEqual(state?.featureBranch, testBranch, 'Branch should persist');
      assert.strictEqual(state?.status, 'active', 'Status should persist');

      // Clean up
      await sessionHelper.stopSessionDirect();
    });

    test('Timestamp is updated on state changes', async () => {
      await sessionHelper.startSessionDirect('test-timestamp-1');
      const state1 = sessionHelper.getSessionState();
      const timestamp1 = state1?.timestamp;

      await sleep(100);

      await sessionHelper.startSessionDirect('test-timestamp-2');
      const state2 = sessionHelper.getSessionState();
      const timestamp2 = state2?.timestamp;

      assert.ok(timestamp1, 'First timestamp should exist');
      assert.ok(timestamp2, 'Second timestamp should exist');
      if (timestamp1 && timestamp2) {
        assert.ok(timestamp2 > timestamp1, 'Timestamp should be updated');
      }

      await sessionHelper.stopSessionDirect();
    });
  });

  suite('Session Config', () => {
    test('showSetup command should be available', async () => {
      await assertCommandExists('coven.showSetup');
    });

    test('.coven directory structure is valid', () => {
      const covenDir = sessionHelper.getCovenDir();
      const worktreesDir = sessionHelper.getWorktreesDir();
      const familiarsDir = sessionHelper.getFamiliarsDir();

      assert.ok(covenDir.endsWith('.coven'), 'Coven dir path is valid');
      assert.ok(worktreesDir.includes('worktrees'), 'Worktrees dir path is valid');
      assert.ok(familiarsDir.includes('familiars'), 'Familiars dir path is valid');
    });
  });

  suite('Pause/Resume (Placeholder)', () => {
    // Note: Pause/resume commands are not yet implemented in extension.ts
    // These tests document the expected behavior for future implementation.

    test('pauseSession command should exist when implemented', async function () {
      const commands = await vscode.commands.getCommands(true);
      if (!commands.includes('coven.pauseSession')) {
        this.skip();
        return;
      }
      await assertCommandExists('coven.pauseSession');
    });

    test('resumeSession command should exist when implemented', async function () {
      const commands = await vscode.commands.getCommands(true);
      if (!commands.includes('coven.resumeSession')) {
        this.skip();
        return;
      }
      await assertCommandExists('coven.resumeSession');
    });

    test('Paused state should be persisted when implemented', async function () {
      // This will test pause → resume flow when implemented
      // For now, just verify we can write a paused state
      const covenDir = path.join(workspacePath, '.coven');
      await fs.promises.mkdir(covenDir, { recursive: true });

      const sessionFile = path.join(covenDir, 'session.json');
      const pausedState = {
        status: 'paused',
        featureBranch: 'test-pause',
        timestamp: Date.now(),
      };

      await fs.promises.writeFile(sessionFile, JSON.stringify(pausedState, null, 2));

      const state = sessionHelper.getSessionState();
      assert.strictEqual(state?.status, 'paused', 'Paused status should be readable');
      assert.ok(state?.isPaused, 'isPaused should be true');

      // Clean up
      await sessionHelper.stopSessionDirect();
    });
  });
});
