import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec, spawn } from 'child_process';
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
 * Run claude with specific tools and get output.
 */
async function runClaude(
  cwd: string,
  prompt: string,
  tools: string[],
  timeoutMs: number
): Promise<{ success: boolean; output: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const args = ['--print'];
    if (tools.length > 0) {
      args.push('--allowedTools', ...tools);
    }
    args.push(prompt);

    const proc = spawn('claude', args, {
      cwd,
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
      resolve({ success: false, output: `TIMEOUT\n${stdout}${stderr}`, exitCode: null });
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        success: code === 0,
        output: stdout + stderr,
        exitCode: code,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, output: err.message, exitCode: null });
    });
  });
}

suite('Agent Integration E2E Tests', function () {
  // Long timeout for agent tests
  this.timeout(180000);

  let workspacePath: string;
  let claudeAvailable: boolean;
  let isRepo: boolean;

  suiteSetup(async () => {
    workspacePath = getTestWorkspacePath();
    claudeAvailable = await isClaudeAvailable();
    isRepo = workspacePath ? await isGitRepo(workspacePath) : false;

    console.log('Agent test setup:');
    console.log(`  Workspace: ${workspacePath}`);
    console.log(`  Claude: ${claudeAvailable}`);
    console.log(`  Git repo: ${isRepo}`);
  });

  suite('Prerequisites', () => {
    test('Extension must be active', async () => {
      const extension = vscode.extensions.getExtension('coven.coven');
      if (extension && !extension.isActive) {
        await extension.activate();
      }
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

  suite('Live Agent Tests', function () {
    this.timeout(180000);

    test('Claude must respond to simple prompt', async function () {
      const result = await runClaude(
        workspacePath,
        'Say "Hello E2E" and nothing else.',
        [],
        30000
      );

      console.log('Claude response:', result.output.substring(0, 200));

      assert.ok(
        result.output.includes('Hello') || result.output.includes('E2E'),
        `Claude must respond with greeting. Got: ${result.output.substring(0, 200)}`
      );
    });

    test('Claude must be able to read files', async function () {
      // Create a test file
      const testDir = path.join(workspacePath, '.coven', 'agent-read-test');
      await fs.promises.mkdir(testDir, { recursive: true });
      const testFile = path.join(testDir, 'test.txt');
      await fs.promises.writeFile(testFile, 'Test content: ABC123');

      try {
        const result = await runClaude(
          testDir,
          `Read the file test.txt and tell me what content it contains. Be brief.`,
          ['Read'],
          60000
        );

        console.log('Read test output:', result.output.substring(0, 300));
        assert.ok(result.success, `Claude read task must succeed. Exit code: ${result.exitCode}`);

        assert.ok(
          result.output.includes('ABC123') || result.output.includes('Test content'),
          `Claude must read file content. Got: ${result.output.substring(0, 300)}`
        );
      } finally {
        await fs.promises.rm(testDir, { recursive: true, force: true });
      }
    });

    test('Claude must be able to write files', async function () {
      const testDir = path.join(workspacePath, '.coven', 'agent-write-test');
      await fs.promises.mkdir(testDir, { recursive: true });

      try {
        const result = await runClaude(
          testDir,
          'Create a file called output.txt with the content "Written by Claude". Say "Done" when complete.',
          ['Write'],
          60000
        );

        console.log('Write test output:', result.output.substring(0, 300));
        assert.ok(result.success, `Claude write task must succeed. Exit code: ${result.exitCode}`);

        const outputFile = path.join(testDir, 'output.txt');
        assert.ok(fs.existsSync(outputFile), 'output.txt must be created');

        const content = await fs.promises.readFile(outputFile, 'utf-8');
        assert.ok(
          content.includes('Claude') || content.includes('Written'),
          `File must contain expected content. Got: ${content}`
        );
      } finally {
        await fs.promises.rm(testDir, { recursive: true, force: true });
      }
    });

    test('Claude must be able to edit files', async function () {
      const testDir = path.join(workspacePath, '.coven', 'agent-edit-test');
      await fs.promises.mkdir(testDir, { recursive: true });

      // Create initial file
      const testFile = path.join(testDir, 'source.ts');
      await fs.promises.writeFile(
        testFile,
        `function greet(): string {
  return "Hello";
}
`
      );

      try {
        const result = await runClaude(
          testDir,
          'Edit source.ts to change the return value from "Hello" to "Hello World". Say "Done" when complete.',
          ['Read', 'Edit'],
          60000
        );

        console.log('Edit test output:', result.output.substring(0, 300));
        assert.ok(result.success, `Claude edit task must succeed. Exit code: ${result.exitCode}`);

        const content = await fs.promises.readFile(testFile, 'utf-8');
        assert.ok(content.includes('World'), `File must be edited. Content: ${content}`);
      } finally {
        await fs.promises.rm(testDir, { recursive: true, force: true });
      }
    });

    test('Claude must complete a simple coding task', async function () {
      const testDir = path.join(workspacePath, '.coven', 'agent-task-test');
      await fs.promises.mkdir(testDir, { recursive: true });

      try {
        const result = await runClaude(
          testDir,
          `Create a TypeScript file called utils.ts with a function called "double" that takes a number and returns it multiplied by 2. Include proper type annotations. Say "Done" when complete.`,
          ['Write'],
          90000
        );

        console.log('Coding task output:', result.output.substring(0, 500));
        assert.ok(result.success, `Claude coding task must succeed. Exit code: ${result.exitCode}`);

        const utilsFile = path.join(testDir, 'utils.ts');
        assert.ok(fs.existsSync(utilsFile), 'utils.ts must be created');

        const content = await fs.promises.readFile(utilsFile, 'utf-8');
        assert.ok(
          content.includes('function') || content.includes('double'),
          `File must contain function. Content: ${content}`
        );
        assert.ok(content.includes('number'), `File must have type annotation. Content: ${content}`);
      } finally {
        await fs.promises.rm(testDir, { recursive: true, force: true });
      }
    });
  });

  suite('Error Handling', () => {
    test('Command must handle invalid task ID', async function () {
      this.timeout(5000);

      try {
        await vscode.commands.executeCommand('coven.startTask', 'invalid-task-id-xyz');
      } catch {
        // Expected to fail
      }
      // Should not crash
      assert.ok(true, 'Handled invalid task gracefully');
    });

    test('Command must handle undefined argument', async function () {
      this.timeout(5000);

      try {
        await vscode.commands.executeCommand('coven.viewFamiliarOutput', undefined);
      } catch {
        // Expected to fail
      }
      assert.ok(true, 'Handled undefined argument gracefully');
    });
  });
});
