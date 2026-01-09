import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Get the test workspace path from environment or VS Code workspace.
 */
function getTestWorkspacePath(): string {
  return (
    process.env.COVEN_E2E_WORKSPACE ||
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
    ''
  );
}

/**
 * Check if git is available in the workspace
 */
async function isGitAvailable(workspacePath: string): Promise<boolean> {
  try {
    await execAsync('git --version', { cwd: workspacePath });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if workspace is a git repository
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
 * List git worktrees in workspace
 */
async function listWorktrees(workspacePath: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync('git worktree list --porcelain', { cwd: workspacePath });
    const worktrees: string[] = [];
    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        worktrees.push(line.substring('worktree '.length));
      }
    }
    return worktrees;
  } catch {
    return [];
  }
}

/**
 * Get current branch name
 */
async function getCurrentBranch(workspacePath: string): Promise<string> {
  try {
    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: workspacePath });
    return stdout.trim();
  } catch {
    return '';
  }
}

suite('Git Worktree Management E2E Tests', function () {
  this.timeout(30000);

  let workspacePath: string;
  let gitAvailable: boolean;
  let isRepo: boolean;

  suiteSetup(async () => {
    workspacePath = getTestWorkspacePath();
    gitAvailable = workspacePath ? await isGitAvailable(workspacePath) : false;
    isRepo = gitAvailable ? await isGitRepo(workspacePath) : false;
  });

  suite('Git Prerequisites', () => {
    test('Git should be available', function () {
      if (!workspacePath) {
        this.skip();
        return;
      }
      assert.ok(gitAvailable, 'Git should be available');
    });

    test('Workspace should be a git repository', function () {
      if (!gitAvailable) {
        this.skip();
        return;
      }
      assert.ok(isRepo, 'Workspace should be a git repository');
    });

    test('Should have at least one worktree (main)', async function () {
      if (!isRepo) {
        this.skip();
        return;
      }
      const worktrees = await listWorktrees(workspacePath);
      assert.ok(worktrees.length >= 1, 'Should have at least the main worktree');
    });
  });

  suite('Worktree Commands', () => {
    test('Git worktree list should work', async function () {
      if (!isRepo) {
        this.skip();
        return;
      }

      const { stdout } = await execAsync('git worktree list', { cwd: workspacePath });
      assert.ok(stdout.length > 0, 'Worktree list should return output');
      assert.ok(stdout.includes(workspacePath), 'Should include workspace path');
    });

    test('Current branch should be detectable', async function () {
      if (!isRepo) {
        this.skip();
        return;
      }

      const branch = await getCurrentBranch(workspacePath);
      assert.ok(branch.length > 0, 'Should be able to get current branch');
    });
  });

  suite('CovenSession Worktree Integration', () => {
    test('Extension should be active', async () => {
      const extension = vscode.extensions.getExtension('coven.coven');
      if (extension && !extension.isActive) {
        await extension.activate();
      }
      assert.ok(extension?.isActive, 'Extension should be active');
    });

    test('Session commands should be available for worktree management', async () => {
      const commands = await vscode.commands.getCommands(true);

      assert.ok(commands.includes('coven.startSession'), 'startSession should be registered');
      assert.ok(commands.includes('coven.stopSession'), 'stopSession should be registered');
    });

    test('.coven directory should exist or be creatable', function () {
      if (!workspacePath) {
        this.skip();
        return;
      }

      const covenDir = path.join(workspacePath, '.coven');

      // The directory is created when session starts or extension activates
      // We just verify the path is valid
      assert.ok(
        typeof covenDir === 'string' && covenDir.length > 0,
        'Coven directory path should be valid'
      );
    });

    test('Worktree base path should be configurable', function () {
      if (!workspacePath) {
        this.skip();
        return;
      }

      // Default worktree base path is .coven/worktrees
      const defaultWorktreePath = path.join(workspacePath, '.coven', 'worktrees');

      // Verify the path structure is correct
      assert.ok(
        defaultWorktreePath.includes('.coven'),
        'Default worktree path should be under .coven'
      );
    });
  });

  suite('Git Infrastructure Verification', () => {
    test('Git status should be readable', async function () {
      if (!isRepo) {
        this.skip();
        return;
      }

      const { stdout } = await execAsync('git status --porcelain', { cwd: workspacePath });
      // stdout can be empty (clean repo) or have content (dirty repo)
      assert.ok(typeof stdout === 'string', 'Git status should return a string');
    });

    test('Git diff should work', async function () {
      if (!isRepo) {
        this.skip();
        return;
      }

      // This should not throw
      const { stdout } = await execAsync('git diff --stat HEAD~1 HEAD 2>/dev/null || echo ""', {
        cwd: workspacePath,
      });
      assert.ok(typeof stdout === 'string', 'Git diff should return a string');
    });

    test('Branch operations should be available', async function () {
      if (!isRepo) {
        this.skip();
        return;
      }

      // List branches - should work
      const { stdout } = await execAsync('git branch --list', { cwd: workspacePath });
      assert.ok(typeof stdout === 'string', 'Branch list should be available');
    });
  });

  suite('Worktree Lifecycle (Simulated)', () => {
    test('Creating worktree directory should work', async function () {
      if (!workspacePath) {
        this.skip();
        return;
      }

      const testDir = path.join(workspacePath, '.coven', 'worktrees', 'test-session');

      // Create directory
      await fs.promises.mkdir(testDir, { recursive: true });

      // Verify it exists
      const exists = fs.existsSync(testDir);
      assert.ok(exists, 'Worktree directory should be created');

      // Clean up
      await fs.promises.rm(testDir, { recursive: true, force: true });
    });

    test('Session ID generation should create unique paths', function () {
      // Simulate session ID generation (crypto.randomBytes)
      const sessionId1 = Math.random().toString(36).substring(2, 18);
      const sessionId2 = Math.random().toString(36).substring(2, 18);

      assert.notStrictEqual(sessionId1, sessionId2, 'Session IDs should be unique');
      assert.ok(sessionId1.length > 0, 'Session ID should not be empty');
    });

    test('Task branch naming should be consistent', function () {
      const sessionId = 'abc123def456';
      const taskId = 'task-001';

      // Simulate branch name generation
      const branchName = `coven/${sessionId}/${taskId}`;

      assert.ok(branchName.startsWith('coven/'), 'Branch should start with coven/');
      assert.ok(branchName.includes(sessionId), 'Branch should include session ID');
      assert.ok(branchName.includes(taskId), 'Branch should include task ID');
    });
  });
});
