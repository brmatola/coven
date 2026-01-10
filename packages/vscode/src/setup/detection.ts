import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

const EXEC_TIMEOUT_MS = 10000; // 10 second timeout for CLI commands

/**
 * Detection status for a workspace component
 */
export type DetectionStatus = 'missing' | 'partial' | 'complete';

/**
 * Base result for component detection
 */
export interface DetectionResult {
  status: DetectionStatus;
  details: string;
}

/**
 * Git repository detection result
 */
export interface GitDetectionResult extends DetectionResult {
  hasGitDir: boolean;
  isValidRepo: boolean;
  currentBranch?: string;
}

/**
 * Beads detection result
 */
export interface BeadsDetectionResult extends DetectionResult {
  hasBeadsDir: boolean;
  hasCliAvailable: boolean;
  cliVersion?: string;
}

/**
 * Coven config detection result
 */
export interface CovenDetectionResult extends DetectionResult {
  hasCovenDir: boolean;
  hasConfigFile: boolean;
  configPath?: string;
}

/**
 * OpenSpec detection result
 */
export interface OpenSpecDetectionResult extends DetectionResult {
  hasOpenspecDir: boolean;
  hasCliAvailable: boolean;
  cliVersion?: string;
}

/**
 * Combined workspace detection state
 */
export interface WorkspaceDetectionState {
  git: GitDetectionResult;
  beads: BeadsDetectionResult;
  coven: CovenDetectionResult;
  openspec: OpenSpecDetectionResult;
  isFullyInitialized: boolean;
  isPartiallyInitialized: boolean;
}

/**
 * Get the workspace root path
 */
function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Check if a directory exists
 */
async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Detect git repository status in workspace
 */
export async function detectGit(): Promise<GitDetectionResult> {
  const workspaceRoot = getWorkspaceRoot();

  if (!workspaceRoot) {
    return {
      status: 'missing',
      details: 'No workspace folder open',
      hasGitDir: false,
      isValidRepo: false,
    };
  }

  const gitDir = path.join(workspaceRoot, '.git');
  const hasGitDir = await directoryExists(gitDir);

  if (!hasGitDir) {
    return {
      status: 'missing',
      details: 'No .git directory found',
      hasGitDir: false,
      isValidRepo: false,
    };
  }

  // Verify it's a valid git repo by checking current branch
  try {
    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
      cwd: workspaceRoot,
      timeout: EXEC_TIMEOUT_MS,
    });
    const currentBranch = stdout.trim();

    return {
      status: 'complete',
      details: `Git repository on branch: ${currentBranch}`,
      hasGitDir: true,
      isValidRepo: true,
      currentBranch,
    };
  } catch {
    // .git exists but repo might be corrupted or not properly initialized
    return {
      status: 'partial',
      details: '.git directory exists but repository may be corrupted',
      hasGitDir: true,
      isValidRepo: false,
    };
  }
}

/**
 * Detect beads CLI and initialization status
 */
export async function detectBeads(): Promise<BeadsDetectionResult> {
  const workspaceRoot = getWorkspaceRoot();

  // Check CLI availability
  let hasCliAvailable = false;
  let cliVersion: string | undefined;

  try {
    const { stdout } = await execAsync('bd --version', {
      timeout: EXEC_TIMEOUT_MS,
    });
    hasCliAvailable = true;
    cliVersion = stdout.trim().split('\n')[0];
  } catch {
    hasCliAvailable = false;
  }

  if (!workspaceRoot) {
    return {
      status: hasCliAvailable ? 'partial' : 'missing',
      details: hasCliAvailable ? 'CLI available but no workspace open' : 'CLI not available',
      hasBeadsDir: false,
      hasCliAvailable,
      cliVersion,
    };
  }

  const beadsDir = path.join(workspaceRoot, '.beads');
  const hasBeadsDir = await directoryExists(beadsDir);

  if (!hasCliAvailable && !hasBeadsDir) {
    return {
      status: 'missing',
      details: 'Beads CLI not available and no .beads directory',
      hasBeadsDir: false,
      hasCliAvailable: false,
    };
  }

  if (!hasCliAvailable) {
    return {
      status: 'partial',
      details: '.beads directory exists but CLI not available',
      hasBeadsDir: true,
      hasCliAvailable: false,
    };
  }

  if (!hasBeadsDir) {
    return {
      status: 'partial',
      details: 'CLI available but workspace not initialized',
      hasBeadsDir: false,
      hasCliAvailable: true,
      cliVersion,
    };
  }

  return {
    status: 'complete',
    details: `Beads initialized (${cliVersion})`,
    hasBeadsDir: true,
    hasCliAvailable: true,
    cliVersion,
  };
}

/**
 * Detect coven configuration status
 */
export async function detectCoven(): Promise<CovenDetectionResult> {
  const workspaceRoot = getWorkspaceRoot();

  if (!workspaceRoot) {
    return {
      status: 'missing',
      details: 'No workspace folder open',
      hasCovenDir: false,
      hasConfigFile: false,
    };
  }

  const covenDir = path.join(workspaceRoot, '.coven');
  const configPath = path.join(covenDir, 'config.yaml');

  const hasCovenDir = await directoryExists(covenDir);
  const hasConfigFile = await fileExists(configPath);

  if (!hasCovenDir) {
    return {
      status: 'missing',
      details: 'No .coven directory found',
      hasCovenDir: false,
      hasConfigFile: false,
    };
  }

  if (!hasConfigFile) {
    return {
      status: 'partial',
      details: '.coven directory exists but config.yaml is missing',
      hasCovenDir: true,
      hasConfigFile: false,
    };
  }

  return {
    status: 'complete',
    details: 'Coven configuration found',
    hasCovenDir: true,
    hasConfigFile: true,
    configPath,
  };
}

/**
 * Detect openspec CLI and initialization status
 */
export async function detectOpenSpec(): Promise<OpenSpecDetectionResult> {
  const workspaceRoot = getWorkspaceRoot();

  // Check CLI availability
  let hasCliAvailable = false;
  let cliVersion: string | undefined;

  try {
    const { stdout } = await execAsync('openspec --version', {
      timeout: EXEC_TIMEOUT_MS,
    });
    hasCliAvailable = true;
    cliVersion = stdout.trim().split('\n')[0];
  } catch {
    hasCliAvailable = false;
  }

  if (!workspaceRoot) {
    return {
      status: hasCliAvailable ? 'partial' : 'missing',
      details: hasCliAvailable ? 'CLI available but no workspace open' : 'CLI not available',
      hasOpenspecDir: false,
      hasCliAvailable,
      cliVersion,
    };
  }

  const openspecDir = path.join(workspaceRoot, 'openspec');
  const hasOpenspecDir = await directoryExists(openspecDir);

  if (!hasCliAvailable && !hasOpenspecDir) {
    return {
      status: 'missing',
      details: 'OpenSpec CLI not available and no openspec directory',
      hasOpenspecDir: false,
      hasCliAvailable: false,
    };
  }

  if (!hasCliAvailable) {
    return {
      status: 'partial',
      details: 'openspec directory exists but CLI not available',
      hasOpenspecDir: true,
      hasCliAvailable: false,
    };
  }

  if (!hasOpenspecDir) {
    return {
      status: 'partial',
      details: 'CLI available but workspace not initialized',
      hasOpenspecDir: false,
      hasCliAvailable: true,
      cliVersion,
    };
  }

  return {
    status: 'complete',
    details: `OpenSpec initialized (${cliVersion})`,
    hasOpenspecDir: true,
    hasCliAvailable: true,
    cliVersion,
  };
}

/**
 * Detect all workspace components
 */
export async function detectWorkspaceComponents(): Promise<WorkspaceDetectionState> {
  const [git, beads, coven, openspec] = await Promise.all([
    detectGit(),
    detectBeads(),
    detectCoven(),
    detectOpenSpec(),
  ]);

  // Git is required, coven is required, beads is required
  // OpenSpec is optional
  const requiredComplete =
    git.status === 'complete' && beads.status === 'complete' && coven.status === 'complete';

  const isFullyInitialized = requiredComplete && openspec.status === 'complete';

  const isPartiallyInitialized =
    !isFullyInitialized &&
    (git.status !== 'missing' ||
      beads.status !== 'missing' ||
      coven.status !== 'missing' ||
      openspec.status !== 'missing');

  return {
    git,
    beads,
    coven,
    openspec,
    isFullyInitialized,
    isPartiallyInitialized,
  };
}
