import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export interface ToolStatus {
  name: string;
  available: boolean;
  version?: string;
  installUrl?: string;
}

export interface InitStatus {
  name: string;
  initialized: boolean;
  path?: string;
}

export interface PrerequisitesStatus {
  tools: ToolStatus[];
  inits: InitStatus[];
  allMet: boolean;
}

let cachedStatus: PrerequisitesStatus | null = null;

export async function checkPrerequisites(): Promise<PrerequisitesStatus> {
  if (cachedStatus) {
    return cachedStatus;
  }

  const tools = await checkTools();
  const inits = await checkInits();
  const allMet = tools.every((t) => t.available) && inits.every((i) => i.initialized);

  cachedStatus = { tools, inits, allMet };
  return cachedStatus;
}

export function refreshPrerequisites(): void {
  cachedStatus = null;
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
    { name: 'bd', command: 'bd --version', installUrl: 'https://beads.dev' },
  ];

  const results = await Promise.all(
    toolChecks.map(async ({ name, command, installUrl }) => {
      try {
        const { stdout } = await execAsync(command);
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
