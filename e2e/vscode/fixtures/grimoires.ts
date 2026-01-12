/**
 * Test grimoire fixtures and helpers.
 *
 * Provides grimoire files for testing different workflow scenarios.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

/**
 * Names of available test grimoires.
 */
export type TestGrimoire = 'simple-agent' | 'multi-step' | 'with-merge' | 'auto-merge';

/**
 * Get the fixtures source directory.
 * When running from compiled JS in out/, we need to go back to the source fixtures.
 */
function getFixturesSourceDir(): string {
  // __dirname is e2e/vscode/out/fixtures when compiled
  // We need e2e/vscode/fixtures (the source directory with YAML files)
  const outDir = path.resolve(__dirname);

  // Check if we're in the 'out' directory
  if (outDir.includes('/out/')) {
    // Go from out/fixtures to fixtures
    return outDir.replace('/out/', '/');
  }

  // Already in source directory
  return outDir;
}

/**
 * Install test grimoires into a workspace.
 *
 * @param workspacePath Path to the workspace
 * @param grimoires Names of grimoires to install (defaults to all)
 */
export function installTestGrimoires(
  workspacePath: string,
  grimoires?: TestGrimoire[]
): void {
  const grimoiresDir = path.join(workspacePath, '.coven', 'grimoires');
  fs.mkdirSync(grimoiresDir, { recursive: true });

  const fixturesDir = path.join(getFixturesSourceDir(), 'grimoires');
  const toInstall = grimoires ?? ['simple-agent'];

  for (const grimoire of toInstall) {
    const srcPath = path.join(fixturesDir, `${grimoire}.yaml`);
    const destPath = path.join(grimoiresDir, `${grimoire}.yaml`);

    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
      console.log(`Installed grimoire: ${grimoire}`);
    } else {
      console.warn(`Grimoire fixture not found: ${srcPath}`);
    }
  }
}

/**
 * Create a task with a specific grimoire label.
 *
 * @param workspacePath Path to the workspace
 * @param title Task title
 * @param grimoireName Name of the grimoire to use
 * @returns Task ID
 */
export function createTaskWithGrimoire(
  workspacePath: string,
  title: string,
  grimoireName: TestGrimoire
): string {
  // Create task with grimoire label
  const output = execSync(
    `bd create --title="${title}" --type=task --priority=2 --label="grimoire:${grimoireName}"`,
    {
      cwd: workspacePath,
      encoding: 'utf-8',
    }
  );

  // Extract task ID from output
  // Format can be:
  // - "Created issue: beads-xxx" (old format)
  // - "✓ Created issue: coven-e2e-xxx-yyy" (new format with checkmark)
  // Match any alphanumeric ID after "Created issue:"
  const match = output.match(/Created issue:\s*([a-zA-Z0-9-]+)/);
  if (!match) {
    throw new Error(`Could not parse task ID from: ${output}`);
  }

  return match[1];
}

/**
 * Remove all test grimoires from a workspace.
 *
 * @param workspacePath Path to the workspace
 */
export function cleanupTestGrimoires(workspacePath: string): void {
  const grimoiresDir = path.join(workspacePath, '.coven', 'grimoires');

  if (!fs.existsSync(grimoiresDir)) {
    return;
  }

  const testGrimoires: TestGrimoire[] = ['simple-agent', 'multi-step', 'with-merge', 'auto-merge'];

  for (const grimoire of testGrimoires) {
    const grimPath = path.join(grimoiresDir, `${grimoire}.yaml`);
    if (fs.existsSync(grimPath)) {
      fs.unlinkSync(grimPath);
    }
  }
}
