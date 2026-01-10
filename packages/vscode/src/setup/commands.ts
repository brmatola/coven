import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { detectGit, detectBeads, detectCoven, detectOpenSpec } from './detection';

const execAsync = promisify(exec);

const EXEC_TIMEOUT_MS = 30000; // 30 second timeout for init commands

/**
 * Default coven configuration
 */
const DEFAULT_COVEN_CONFIG = `version: "1"
daemon:
  socket: ".coven/covend.sock"
`;

/**
 * Installation URLs for CLIs
 */
const INSTALL_URLS = {
  git: 'https://git-scm.com/downloads',
  bd: 'https://github.com/steveyegge/beads',
  openspec: 'https://github.com/openspec/openspec',
};

/**
 * Event emitter for component initialization
 */
export const onDidInitializeComponent = new vscode.EventEmitter<string>();

/**
 * Get the workspace root path
 */
function getWorkspaceRoot(): string {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    throw new Error('No workspace folder open');
  }
  return root;
}

/**
 * Show installation instructions for a CLI tool
 */
async function showInstallInstructions(tool: 'git' | 'bd' | 'openspec'): Promise<void> {
  const result = await vscode.window.showErrorMessage(
    `${tool} CLI is not available. Please install it to continue.`,
    'Open Installation Page'
  );
  if (result === 'Open Installation Page') {
    await vscode.env.openExternal(vscode.Uri.parse(INSTALL_URLS[tool]));
  }
}

/**
 * Initialize git repository in workspace
 */
export async function initGit(): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();

  // Check if already initialized
  const detection = await detectGit();
  if (detection.status === 'complete') {
    void vscode.window.showInformationMessage('Git repository already initialized.');
    return;
  }

  try {
    await execAsync('git init', { cwd: workspaceRoot, timeout: EXEC_TIMEOUT_MS });
    void vscode.window.showInformationMessage('Git repository initialized successfully.');
    onDidInitializeComponent.fire('git');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('command not found') || message.includes('not recognized')) {
      await showInstallInstructions('git');
    } else {
      void vscode.window.showErrorMessage(`Failed to initialize git: ${message}`);
    }
    throw error;
  }
}

/**
 * Initialize beads in workspace
 */
export async function initBeads(): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();

  // Check CLI availability
  const detection = await detectBeads();
  if (!detection.hasCliAvailable) {
    await showInstallInstructions('bd');
    throw new Error('Beads CLI not available');
  }

  // Check if already initialized
  if (detection.status === 'complete') {
    void vscode.window.showInformationMessage('Beads already initialized.');
    return;
  }

  try {
    await execAsync('bd init', { cwd: workspaceRoot, timeout: EXEC_TIMEOUT_MS });
    void vscode.window.showInformationMessage('Beads initialized successfully.');
    onDidInitializeComponent.fire('beads');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Failed to initialize beads: ${message}`);
    throw error;
  }
}

/**
 * Initialize openspec in workspace
 */
export async function initOpenspec(): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();

  // Check CLI availability
  const detection = await detectOpenSpec();
  if (!detection.hasCliAvailable) {
    await showInstallInstructions('openspec');
    throw new Error('OpenSpec CLI not available');
  }

  // Check if already initialized
  if (detection.status === 'complete') {
    void vscode.window.showInformationMessage('OpenSpec already initialized.');
    return;
  }

  try {
    await execAsync('openspec init --tools claude', { cwd: workspaceRoot, timeout: EXEC_TIMEOUT_MS });
    void vscode.window.showInformationMessage('OpenSpec initialized successfully.');
    onDidInitializeComponent.fire('openspec');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Failed to initialize openspec: ${message}`);
    throw error;
  }
}

/**
 * Initialize coven configuration in workspace
 */
export async function initCoven(): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();

  // Check if already initialized
  const detection = await detectCoven();
  if (detection.status === 'complete') {
    void vscode.window.showInformationMessage('Coven already initialized.');
    return;
  }

  try {
    const covenDir = path.join(workspaceRoot, '.coven');
    const configPath = path.join(covenDir, 'config.yaml');

    // Create .coven directory if it doesn't exist
    if (!detection.hasCovenDir) {
      await fs.mkdir(covenDir, { recursive: true });
    }

    // Create config.yaml with defaults
    await fs.writeFile(configPath, DEFAULT_COVEN_CONFIG, 'utf-8');

    void vscode.window.showInformationMessage('Coven initialized successfully.');
    onDidInitializeComponent.fire('coven');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Failed to initialize coven: ${message}`);
    throw error;
  }
}

/**
 * Register all setup commands
 */
export function registerSetupCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('coven.initGit', initGit),
    vscode.commands.registerCommand('coven.initBeads', initBeads),
    vscode.commands.registerCommand('coven.initOpenspec', initOpenspec),
    vscode.commands.registerCommand('coven.initCoven', initCoven),
    onDidInitializeComponent
  );
}
