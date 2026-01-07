import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SetupState, ToolStatus, InitStatus } from './types';

const execAsync = promisify(exec);

const EXEC_TIMEOUT_MS = 10000; // 10 second timeout for CLI commands
const CACHE_TTL_MS = 30000; // Cache expires after 30 seconds

let cachedStatus: SetupState | null = null;
let cacheTimestamp = 0;

export async function checkPrerequisites(): Promise<SetupState> {
  const now = Date.now();
  if (cachedStatus && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedStatus;
  }

  const tools = await checkTools();
  const inits = await checkInits();
  const allMet = tools.every((t) => t.available) && inits.every((i) => i.initialized);

  cachedStatus = { tools, inits, allMet };
  cacheTimestamp = Date.now();
  return cachedStatus;
}

export function refreshPrerequisites(): void {
  cachedStatus = null;
  cacheTimestamp = 0;
}

async function checkTools(): Promise<ToolStatus[]> {
  const toolChecks: Array<{ name: string; command: string; installUrl: string }> = [
    { name: 'git', command: 'git --version', installUrl: 'https://git-scm.com/downloads' },
    { name: 'claude', command: 'claude --version', installUrl: 'https://claude.ai/download' },
    {
      name: 'openspec',
      command: 'openspec --version',
      installUrl: 'https://github.com/openspec/openspec',
    },
    {
      name: 'bd',
      command: 'bd --version',
      installUrl: 'https://github.com/steveyegge/beads',
    },
  ];

  const results = await Promise.all(
    toolChecks.map(async ({ name, command, installUrl }) => {
      try {
        const { stdout } = await execAsync(command, { timeout: EXEC_TIMEOUT_MS });
        const version = stdout.trim().split('\n')[0];
        return { name, available: true, version, installUrl };
      } catch {
        return { name, available: false, installUrl };
      }
    })
  );

  return results;
}

async function checkInits(): Promise<InitStatus[]> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return [
      { name: 'openspec', initialized: false },
      { name: 'beads', initialized: false },
    ];
  }

  const [openspecExists, beadsExists] = await Promise.all([
    directoryExists(path.join(workspaceRoot, 'openspec')),
    directoryExists(path.join(workspaceRoot, '.beads')),
  ]);

  return [
    {
      name: 'openspec',
      initialized: openspecExists,
      path: openspecExists ? path.join(workspaceRoot, 'openspec') : undefined,
    },
    {
      name: 'beads',
      initialized: beadsExists,
      path: beadsExists ? path.join(workspaceRoot, '.beads') : undefined,
    },
  ];
}

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function initOpenspec(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    throw new Error('No workspace folder open');
  }
  await execAsync('openspec init --tools claude', { cwd: workspaceRoot, timeout: EXEC_TIMEOUT_MS * 3 });
}

export async function initBeads(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    throw new Error('No workspace folder open');
  }
  await execAsync('bd init', { cwd: workspaceRoot, timeout: EXEC_TIMEOUT_MS * 3 });
}
