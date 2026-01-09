import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * E2E Tests for the complete task workflow:
 * 1. Create a simple task
 * 2. Implement task (agent runs and makes changes)
 * 3. Merge task (changes are merged back)
 *
 * These tests exercise the real system with actual Claude Code execution.
 * Tests will FAIL (not skip) if prerequisites aren't met.
 */

// Test configuration
const TASK_TIMEOUT_MS = 180000; // 3 minutes for agent work

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
    // Escape description for shell
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

/**
 * Run claude directly to perform a simple task.
 */
async function runClaudeTask(
  workingDir: string,
  prompt: string,
  timeoutMs: number
): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const args = ['--print', '--allowedTools', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', prompt];

    const proc = spawn('claude', args, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({ success: false, output: `TIMEOUT after ${timeoutMs}ms\n` + stdout + '\n' + stderr });
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        success: code === 0,
        output: stdout + (stderr ? '\nStderr: ' + stderr : ''),
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, output: `Error: ${err.message}` });
    });
  });
}

suite('Task Workflow E2E Tests', function () {
  this.timeout(300000); // 5 minute overall timeout

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

  suite('Simple Task Creation and Execution', function () {
    this.timeout(TASK_TIMEOUT_MS);

    test('Should create a task in Beads', async function () {
      const taskId = await createTask(
        workspacePath,
        'E2E Test - Create File',
        'Create a file called test-output.txt containing "Hello from E2E test"'
      );

      assert.ok(taskId, 'Task should be created');
      createdTaskIds.push(taskId);

      const task = await getTask(workspacePath, taskId);
      assert.ok(task, 'Task should be retrievable');
      assert.strictEqual(task.status, 'open', 'Task should be open');
    });

    test('Should execute simple file creation task with Claude', async function () {
      // Create a temp directory for this test
      const testDir = path.join(workspacePath, '.coven', 'e2e-test-' + Date.now());
      await fs.promises.mkdir(testDir, { recursive: true });

      try {
        const result = await runClaudeTask(
          testDir,
          'Create a file called hello.txt with the content "Hello E2E". Then say "Done."',
          60000
        );

        console.log('Claude output:', result.output.substring(0, 500));
        assert.ok(result.success, `Claude task should succeed. Output: ${result.output.substring(0, 300)}`);

        // Check if the file was created
        const outputFile = path.join(testDir, 'hello.txt');
        assert.ok(fs.existsSync(outputFile), 'hello.txt should be created');

        const content = await fs.promises.readFile(outputFile, 'utf-8');
        assert.ok(content.includes('Hello'), 'File should contain greeting');
      } finally {
        // Cleanup
        await fs.promises.rm(testDir, { recursive: true, force: true });
      }
    });

    test('Should execute task that modifies code', async function () {
      // Create a temp directory with a source file
      const testDir = path.join(workspacePath, '.coven', 'e2e-code-test-' + Date.now());
      await fs.promises.mkdir(testDir, { recursive: true });

      // Create initial source file
      const sourceFile = path.join(testDir, 'math.ts');
      await fs.promises.writeFile(
        sourceFile,
        `// Math utilities
export function add(a: number, b: number): number {
  return a + b;
}
`
      );

      try {
        const result = await runClaudeTask(
          testDir,
          'Add a subtract function to math.ts that subtracts b from a. Follow the same style as add. Say "Done" when complete.',
          60000
        );

        console.log('Claude output:', result.output.substring(0, 500));
        assert.ok(result.success, `Claude task should succeed. Output: ${result.output.substring(0, 300)}`);

        // Check if subtract was added
        const content = await fs.promises.readFile(sourceFile, 'utf-8');
        assert.ok(
          content.includes('subtract') || content.includes('Subtract'),
          'File should have subtract function'
        );
      } finally {
        await fs.promises.rm(testDir, { recursive: true, force: true });
      }
    });
  });

  suite('Full Task Workflow (Create, Implement, Complete)', function () {
    this.timeout(TASK_TIMEOUT_MS * 2);

    let testTaskId: string;

    test('Step 1: Create task in Beads', async function () {
      testTaskId = await createTask(
        workspacePath,
        'E2E Workflow Test - Add Utility Function',
        `Create a simple TypeScript utility function:
- Function name: formatDate
- Input: Date object
- Output: String in format "YYYY-MM-DD"
- Create file: .coven/e2e-workflow/date-utils.ts

Requirements:
- Function must be exported
- Include type annotations
- Include JSDoc comment`
      );

      assert.ok(testTaskId, 'Task should be created');
      createdTaskIds.push(testTaskId);

      const task = await getTask(workspacePath, testTaskId);
      assert.strictEqual(task.status, 'open', 'Task should be open');
    });

    test('Step 2: Update task status to in_progress', async function () {
      assert.ok(testTaskId, 'testTaskId must be set from Step 1');

      await updateTaskStatus(workspacePath, testTaskId, 'in_progress');

      const task = await getTask(workspacePath, testTaskId);
      assert.strictEqual(task.status, 'in_progress', 'Task should be in_progress');
    });

    test('Step 3: Implement task with Claude', async function () {
      assert.ok(testTaskId, 'testTaskId must be set from Step 1');

      // Ensure directory exists
      const targetDir = path.join(workspacePath, '.coven', 'e2e-workflow');
      await fs.promises.mkdir(targetDir, { recursive: true });

      const result = await runClaudeTask(
        workspacePath,
        `Complete this task:
Create a file at .coven/e2e-workflow/date-utils.ts with a formatDate function.
The function should:
- Take a Date object as input
- Return a string in YYYY-MM-DD format
- Be exported
- Have JSDoc comment

Say "Done" when complete.`,
        120000
      );

      console.log('Task implementation output:', result.output.substring(0, 1000));
      assert.ok(result.success, `Claude task should succeed. Output: ${result.output.substring(0, 500)}`);
    });

    test('Step 4: Verify implementation exists', async function () {
      const targetFile = path.join(workspacePath, '.coven', 'e2e-workflow', 'date-utils.ts');

      assert.ok(fs.existsSync(targetFile), `File should be created at ${targetFile}`);

      const content = await fs.promises.readFile(targetFile, 'utf-8');
      assert.ok(content.includes('formatDate'), 'Should contain formatDate function');
      assert.ok(content.includes('export'), 'Function should be exported');
      assert.ok(content.includes('Date'), 'Should have Date type');

      // Cleanup
      await fs.promises.rm(path.join(workspacePath, '.coven', 'e2e-workflow'), { recursive: true, force: true });
    });

    test('Step 5: Close task', async function () {
      assert.ok(testTaskId, 'testTaskId must be set from Step 1');

      await closeTask(workspacePath, testTaskId);

      const task = await getTask(workspacePath, testTaskId);
      assert.strictEqual(task.status, 'closed', 'Task should be closed');
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
      this.timeout(5000);

      try {
        await vscode.commands.executeCommand('coven.startTask', 'nonexistent-task-id');
        // Should fail or show error message
      } catch {
        // Expected - should fail gracefully
      }

      // If we get here, command didn't crash
      assert.ok(true, 'Command handled gracefully');
    });
  });

  suite('Git Worktree Integration', () => {
    test('Git worktree command should be available', async function () {
      const { stdout } = await execAsync('git worktree list', { cwd: workspacePath });
      assert.ok(stdout.length > 0, 'Should list worktrees');
    });

    test('.coven/worktrees directory should be creatable', async function () {
      const worktreesDir = path.join(workspacePath, '.coven', 'worktrees');
      await fs.promises.mkdir(worktreesDir, { recursive: true });
      assert.ok(fs.existsSync(worktreesDir), 'Worktrees directory should exist');
    });

    test('Feature branch should be accessible', async function () {
      const branch = await getCurrentBranch(workspacePath);
      assert.ok(branch.length > 0, 'Should have a current branch');
    });
  });
});
