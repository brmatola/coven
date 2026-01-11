import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { runTests } from '@vscode/test-electron';

/**
 * Configuration from environment variables.
 */
const config = {
  // Use existing workspace if set (for CI or debugging)
  existingWorkspace: process.env.COVEN_E2E_WORKSPACE,
  // Timeout for test suite (default: 2 minutes)
  timeout: parseInt(process.env.COVEN_E2E_TIMEOUT || '120000', 10),
  // Keep workspace after tests for debugging
  keepWorkspace: process.env.COVEN_E2E_KEEP_WORKSPACE === 'true',
};

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

    // Create initial commit (required for git operations)
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test Workspace\n');
    execSync('git add .', { cwd: tempDir, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: 'pipe' });

    console.log('Git initialized');

    // Initialize beads if available
    try {
      execSync('bd init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git add .beads', { cwd: tempDir, stdio: 'pipe' });
      execSync('git commit -m "Initialize beads"', { cwd: tempDir, stdio: 'pipe' });
      console.log('Beads initialized');
    } catch {
      console.log('Beads CLI not available - tests will skip Beads-specific tests');
    }
  } catch (err) {
    // Clean up on error
    cleanupWorkspace(tempDir);
    throw err;
  }

  return {
    workspacePath: tempDir,
    cleanup: () => {
      if (config.keepWorkspace) {
        console.log(`Keeping test workspace for debugging: ${tempDir}`);
        return;
      }
      cleanupWorkspace(tempDir);
    },
  };
}

/**
 * Clean up workspace with retry logic.
 */
function cleanupWorkspace(workspacePath: string, retries = 3): void {
  console.log(`Cleaning up test workspace: ${workspacePath}`);

  for (let i = 0; i < retries; i++) {
    try {
      fs.rmSync(workspacePath, { recursive: true, force: true });
      return;
    } catch (err) {
      if (i === retries - 1) {
        console.error(`Failed to clean up workspace after ${retries} attempts:`, err);
      } else {
        // Brief delay before retry
        const delay = 100 * (i + 1);
        const start = Date.now();
        while (Date.now() - start < delay) {
          // Synchronous delay
        }
      }
    }
  }
}

async function main(): Promise<void> {
  // The extension root (where package.json is)
  // From out/e2e/vscode/runTest.js, __dirname is out/e2e/vscode/
  // Go up 3 levels: ../.. -> out/, ../ -> root, then packages/vscode
  const extensionDevelopmentPath = path.resolve(__dirname, '../../../packages/vscode');

  // The compiled test runner (index.js in suites)
  // Files are in out/e2e/vscode/suites/ when TypeScript preserves structure
  const extensionTestsPath = path.resolve(__dirname, './suites/index.js');

  // Use existing workspace or create isolated one
  let workspacePath: string;
  let cleanup: (() => void) | null = null;

  if (config.existingWorkspace) {
    workspacePath = config.existingWorkspace;
    console.log(`Using existing workspace: ${workspacePath}`);
  } else {
    const workspace = createTestWorkspace();
    workspacePath = workspace.workspacePath;
    cleanup = workspace.cleanup;
  }

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspacePath,
        // Disable workspace trust prompt
        '--disable-workspace-trust',
        // Skip telemetry
        '--disable-telemetry',
      ],
      extensionTestsEnv: {
        COVEN_E2E_WORKSPACE: workspacePath,
        COVEN_E2E_TIMEOUT: String(config.timeout),
      },
    });
  } finally {
    if (cleanup) {
      cleanup();
    }
  }
}

main().catch((err) => {
  console.error('Failed to run tests:', err);
  process.exit(1);
});
