import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

/**
 * Manages isolated test workspaces for E2E tests.
 * Provides fast reset between tests rather than full recreation.
 */
export class WorkspaceManager {
  private workspacePath: string | null = null;
  private beadsAvailable: boolean = false;

  /**
   * Create a new isolated test workspace with git and beads initialized.
   * Call this once per test suite, then use reset() between tests.
   */
  create(): string {
    if (this.workspacePath) {
      throw new Error('Workspace already created. Call destroy() first or use reset().');
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coven-e2e-'));
    this.workspacePath = tempDir;

    try {
      // Initialize git
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'pipe' });

      // Create initial commit (required for git operations)
      fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test Workspace\n');
      execSync('git add .', { cwd: tempDir, stdio: 'pipe' });
      execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: 'pipe' });

      // Initialize beads if available
      try {
        execSync('bd init', { cwd: tempDir, stdio: 'pipe' });
        execSync('git add .beads', { cwd: tempDir, stdio: 'pipe' });
        execSync('git commit -m "Initialize beads"', { cwd: tempDir, stdio: 'pipe' });
        this.beadsAvailable = true;
      } catch {
        this.beadsAvailable = false;
      }

      return tempDir;
    } catch (err) {
      // Clean up on error
      this.destroyWithRetry(tempDir);
      this.workspacePath = null;
      throw err;
    }
  }

  /**
   * Fast reset of workspace state between tests.
   * Much faster than destroy/create cycle (~100ms vs ~2s).
   */
  reset(): void {
    if (!this.workspacePath) {
      throw new Error('No workspace to reset. Call create() first.');
    }

    try {
      // Clean untracked files
      execSync('git clean -fd', { cwd: this.workspacePath, stdio: 'pipe' });

      // Reset tracked files to last commit
      execSync('git checkout .', { cwd: this.workspacePath, stdio: 'pipe' });

      // Clear .coven state if it exists
      const covenDir = path.join(this.workspacePath, '.coven');
      if (fs.existsSync(covenDir)) {
        // Remove session state but keep config
        const sessionFile = path.join(covenDir, 'session.json');
        const familiarsDir = path.join(covenDir, 'familiars');

        if (fs.existsSync(sessionFile)) {
          fs.unlinkSync(sessionFile);
        }
        if (fs.existsSync(familiarsDir)) {
          fs.rmSync(familiarsDir, { recursive: true, force: true });
        }
      }
    } catch (err) {
      // If reset fails, log but don't throw - test can continue
      console.error('Workspace reset warning:', err);
    }
  }

  /**
   * Destroy the workspace and clean up all resources.
   * Call this in suite teardown.
   */
  destroy(): void {
    if (!this.workspacePath) {
      return;
    }

    this.destroyWithRetry(this.workspacePath);
    this.workspacePath = null;
    this.beadsAvailable = false;
  }

  /**
   * Get the current workspace path.
   */
  getPath(): string {
    if (!this.workspacePath) {
      throw new Error('No workspace created. Call create() first.');
    }
    return this.workspacePath;
  }

  /**
   * Check if workspace is ready (git initialized, optionally beads).
   */
  isReady(): { git: boolean; beads: boolean } {
    if (!this.workspacePath) {
      return { git: false, beads: false };
    }

    const gitDir = path.join(this.workspacePath, '.git');
    const beadsDir = path.join(this.workspacePath, '.beads');

    return {
      git: fs.existsSync(gitDir),
      beads: fs.existsSync(beadsDir),
    };
  }

  /**
   * Check if Beads CLI is available in this workspace.
   */
  isBeadsAvailable(): boolean {
    return this.beadsAvailable;
  }

  /**
   * Remove directory with retry logic for stubborn files.
   */
  private destroyWithRetry(dirPath: string, retries = 3): void {
    for (let i = 0; i < retries; i++) {
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
        return;
      } catch (err) {
        if (i === retries - 1) {
          console.error(`Failed to clean up workspace after ${retries} attempts:`, err);
        } else {
          // Brief delay before retry
          const delay = 100 * (i + 1);
          const start = Date.now();
          while (Date.now() - start < delay) {
            // Busy wait - synchronous delay
          }
        }
      }
    }
  }
}

// Singleton instance for convenience
let defaultManager: WorkspaceManager | null = null;

/**
 * Get the default WorkspaceManager instance.
 * Creates one if it doesn't exist.
 */
export function getWorkspaceManager(): WorkspaceManager {
  if (!defaultManager) {
    defaultManager = new WorkspaceManager();
  }
  return defaultManager;
}

/**
 * Reset the default WorkspaceManager (for test isolation).
 */
export function resetDefaultManager(): void {
  if (defaultManager) {
    defaultManager.destroy();
    defaultManager = null;
  }
}
