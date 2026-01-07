import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { runTests } from '@vscode/test-electron';

/**
 * Create an isolated test workspace with git and beads initialized.
 * Returns the path to the workspace and a cleanup function.
 */
function createTestWorkspace(): { workspacePath: string; cleanup: () => void } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coven-e2e-'));
  console.log(`Created test workspace: ${tempDir}`);

  try {
    // Initialize git
    execSync('git init', { cwd: tempDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'pipe' });

    // Create an initial commit (required for some git operations)
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test Workspace\n');
    execSync('git add .', { cwd: tempDir, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: 'pipe' });

    console.log('Git initialized');

    // Initialize beads (if available)
    try {
      execSync('bd init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git add .beads', { cwd: tempDir, stdio: 'pipe' });
      execSync('git commit -m "Initialize beads"', { cwd: tempDir, stdio: 'pipe' });
      console.log('Beads initialized');
    } catch (err) {
      console.log('Beads CLI not available - tests will skip Beads-specific tests');
    }
  } catch (err) {
    // Clean up on error
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw err;
  }

  return {
    workspacePath: tempDir,
    cleanup: () => {
      console.log(`Cleaning up test workspace: ${tempDir}`);
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (err) {
        console.error('Failed to clean up test workspace:', err);
      }
    },
  };
}

async function main(): Promise<void> {
  // The extension root (where package.json is)
  const extensionDevelopmentPath = path.resolve(__dirname, '../');

  // The compiled test runner
  const extensionTestsPath = path.resolve(__dirname, '../dist/test/e2e/index.js');

  // Create isolated test workspace
  const { workspacePath, cleanup } = createTestWorkspace();

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspacePath,
        '--disable-extensions',
      ],
      extensionTestsEnv: {
        COVEN_E2E_WORKSPACE: workspacePath,
      },
    });
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error('Failed to run tests:', err);
  process.exit(1);
});
