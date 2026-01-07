import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import {
  GitProvider,
  Worktree,
  MergeResult,
  ConflictFile,
  GitStatus,
  DiffSummary,
  CreateWorktreeOptions,
  MergeOptions,
} from './types';
import { getLogger } from '../shared/logger';

const execAsync = promisify(exec);

const EXEC_TIMEOUT_MS = 60000; // 60 second timeout for git commands

/**
 * Git provider implementation using the git CLI.
 */
export class GitCLI implements GitProvider {
  private repoRoot: string;
  private logger = getLogger();

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
  }

  // ============================================================================
  // Worktree Operations
  // ============================================================================

  async createWorktree(
    branch: string,
    worktreePath: string,
    options: CreateWorktreeOptions = {}
  ): Promise<Worktree> {
    const { baseBranch, createBranch = true } = options;

    // Ensure parent directory exists
    const parentDir = path.dirname(worktreePath);
    await fs.promises.mkdir(parentDir, { recursive: true });

    // Build command
    let cmd = `git worktree add "${worktreePath}"`;
    if (createBranch) {
      cmd += ` -b "${branch}"`;
      if (baseBranch) {
        cmd += ` "${baseBranch}"`;
      }
    } else {
      cmd += ` "${branch}"`;
    }

    await this.exec(cmd);

    // Get worktree info
    const worktrees = await this.listWorktrees();
    const created = worktrees.find((w) => w.path === worktreePath);
    if (!created) {
      throw new GitCLIError(`Worktree created but not found: ${worktreePath}`);
    }

    return created;
  }

  async deleteWorktree(worktreePath: string, force = false): Promise<void> {
    const cmd = force
      ? `git worktree remove --force "${worktreePath}"`
      : `git worktree remove "${worktreePath}"`;

    try {
      await this.exec(cmd);
    } catch (err) {
      // Try to clean up manually if regular removal fails
      if (force) {
        this.logger.warn('Force removing worktree directory', { path: worktreePath });
        try {
          await fs.promises.rm(worktreePath, { recursive: true, force: true });
          await this.exec('git worktree prune');
        } catch (cleanupErr) {
          throw new GitCLIError(`Failed to remove worktree: ${worktreePath}`, err);
        }
      } else {
        throw new GitCLIError(`Failed to remove worktree: ${worktreePath}`, err);
      }
    }
  }

  async listWorktrees(): Promise<Worktree[]> {
    const { stdout } = await this.exec('git worktree list --porcelain');

    const worktrees: Worktree[] = [];
    let current: Partial<Worktree> = {};

    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) {
          worktrees.push(current as Worktree);
        }
        current = {
          path: line.substring('worktree '.length),
          isMain: false,
          isBare: false,
        };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.substring('HEAD '.length);
      } else if (line.startsWith('branch ')) {
        // refs/heads/branch-name -> branch-name
        const branchRef = line.substring('branch '.length);
        current.branch = branchRef.replace('refs/heads/', '');
      } else if (line === 'bare') {
        current.isBare = true;
      } else if (line === 'detached') {
        current.branch = 'HEAD (detached)';
      }
    }

    // Add last worktree
    if (current.path) {
      worktrees.push(current as Worktree);
    }

    // Mark main worktree
    if (worktrees.length > 0 && worktrees[0]) {
      worktrees[0].isMain = true;
    }

    return worktrees;
  }

  async isWorktree(checkPath: string): Promise<boolean> {
    const worktrees = await this.listWorktrees();
    return worktrees.some((w) => w.path === checkPath);
  }

  // ============================================================================
  // Branch Operations
  // ============================================================================

  async createBranch(name: string, base?: string): Promise<void> {
    const cmd = base ? `git branch "${name}" "${base}"` : `git branch "${name}"`;
    await this.exec(cmd);
  }

  async deleteBranch(name: string, force = false): Promise<void> {
    const flag = force ? '-D' : '-d';
    await this.exec(`git branch ${flag} "${name}"`);
  }

  async branchExists(name: string): Promise<boolean> {
    try {
      await this.exec(`git show-ref --verify --quiet refs/heads/${name}`);
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentBranch(workingDir?: string): Promise<string> {
    const { stdout } = await this.exec('git rev-parse --abbrev-ref HEAD', workingDir);
    return stdout.trim();
  }

  // ============================================================================
  // Merge Operations
  // ============================================================================

  async merge(
    source: string,
    options: MergeOptions = {},
    workingDir?: string
  ): Promise<MergeResult> {
    const { message, squash = false, fastForward = true } = options;

    let cmd = 'git merge';
    if (squash) {
      cmd += ' --squash';
    }
    if (!fastForward) {
      cmd += ' --no-ff';
    }
    if (message) {
      cmd += ` -m "${message.replace(/"/g, '\\"')}"`;
    }
    cmd += ` "${source}"`;

    try {
      const { stdout } = await this.exec(cmd, workingDir);

      // Parse merge commit hash from output if available
      const commitMatch = stdout.match(/([a-f0-9]{40})/);
      const commitHash = commitMatch?.[1];

      // Get list of merged files
      const mergedFiles = await this.getMergedFiles(workingDir);

      return {
        success: true,
        conflicts: [],
        mergedFiles,
        commitHash,
      };
    } catch (err) {
      // Check if this is a merge conflict
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes('CONFLICT') || errorMsg.includes('Automatic merge failed')) {
        const conflicts = await this.getConflictFiles(workingDir);
        const mergedFiles = await this.getMergedFiles(workingDir);

        return {
          success: false,
          conflicts,
          mergedFiles,
        };
      }

      throw new GitCLIError(`Merge failed: ${source}`, err);
    }
  }

  async abortMerge(workingDir?: string): Promise<void> {
    await this.exec('git merge --abort', workingDir);
  }

  private async getConflictFiles(workingDir?: string): Promise<ConflictFile[]> {
    try {
      const { stdout } = await this.exec('git diff --name-only --diff-filter=U', workingDir);
      const conflictPaths = stdout.trim().split('\n').filter(Boolean);

      const conflicts: ConflictFile[] = [];
      for (const filePath of conflictPaths) {
        try {
          const conflict = await this.parseConflict(filePath, workingDir);
          conflicts.push(conflict);
        } catch {
          // If we can't parse, still include basic info
          conflicts.push({
            path: filePath,
            ourContent: '',
            theirContent: '',
          });
        }
      }

      return conflicts;
    } catch {
      return [];
    }
  }

  private async parseConflict(filePath: string, workingDir?: string): Promise<ConflictFile> {
    const cwd = workingDir ?? this.repoRoot;
    const fullPath = path.join(cwd, filePath);

    // Read file content with conflict markers
    const content = await fs.promises.readFile(fullPath, 'utf-8');

    // Parse conflict markers
    let ourContent = '';
    let theirContent = '';
    let baseContent = '';
    let section: 'ours' | 'base' | 'theirs' | null = null;

    for (const line of content.split('\n')) {
      if (line.startsWith('<<<<<<<')) {
        section = 'ours';
      } else if (line.startsWith('|||||||')) {
        section = 'base';
      } else if (line.startsWith('=======')) {
        section = 'theirs';
      } else if (line.startsWith('>>>>>>>')) {
        section = null;
      } else if (section === 'ours') {
        ourContent += line + '\n';
      } else if (section === 'base') {
        baseContent += line + '\n';
      } else if (section === 'theirs') {
        theirContent += line + '\n';
      }
    }

    return {
      path: filePath,
      ourContent: ourContent.trimEnd(),
      theirContent: theirContent.trimEnd(),
      baseContent: baseContent.trimEnd() || undefined,
    };
  }

  private async getMergedFiles(workingDir?: string): Promise<string[]> {
    try {
      const { stdout } = await this.exec('git diff --name-only HEAD~1 HEAD 2>/dev/null || true', workingDir);
      return stdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  // ============================================================================
  // Status and Diff
  // ============================================================================

  async getStatus(workingDir?: string): Promise<GitStatus> {
    const { stdout } = await this.exec('git status --porcelain=v2 --branch', workingDir);

    const status: GitStatus = {
      staged: [],
      modified: [],
      untracked: [],
      deleted: [],
      branch: 'HEAD',
      ahead: 0,
      behind: 0,
    };

    for (const line of stdout.split('\n')) {
      if (line.startsWith('# branch.head ')) {
        status.branch = line.substring('# branch.head '.length);
      } else if (line.startsWith('# branch.ab ')) {
        const match = line.match(/\+(\d+) -(\d+)/);
        if (match) {
          status.ahead = parseInt(match[1] ?? '0', 10);
          status.behind = parseInt(match[2] ?? '0', 10);
        }
      } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
        // Changed entry
        const parts = line.split(' ');
        const xy = parts[1] ?? '';
        const filePath = parts.slice(8).join(' ');

        if (xy[0] !== '.') {
          status.staged.push(filePath);
        }
        if (xy[1] === 'M') {
          status.modified.push(filePath);
        } else if (xy[1] === 'D') {
          status.deleted.push(filePath);
        }
      } else if (line.startsWith('? ')) {
        // Untracked
        status.untracked.push(line.substring(2));
      }
    }

    return status;
  }

  async getDiff(base: string, head: string, workingDir?: string): Promise<DiffSummary> {
    const { stdout } = await this.exec(
      `git diff --stat --numstat "${base}...${head}"`,
      workingDir
    );

    const summary: DiffSummary = {
      added: [],
      modified: [],
      deleted: [],
      linesAdded: 0,
      linesDeleted: 0,
    };

    // Parse numstat output (lines added, lines deleted, filename)
    for (const line of stdout.split('\n')) {
      const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (match) {
        const [, addStr, delStr, filePath] = match;
        const add = addStr === '-' ? 0 : parseInt(addStr ?? '0', 10);
        const del = delStr === '-' ? 0 : parseInt(delStr ?? '0', 10);

        summary.linesAdded += add;
        summary.linesDeleted += del;

        if (filePath) {
          // Determine file status
          if (del === 0 && add > 0) {
            summary.added.push(filePath);
          } else if (add === 0 && del > 0) {
            summary.deleted.push(filePath);
          } else {
            summary.modified.push(filePath);
          }
        }
      }
    }

    return summary;
  }

  // ============================================================================
  // Commit Operations
  // ============================================================================

  async add(files: string | string[], workingDir?: string): Promise<void> {
    const fileList = Array.isArray(files) ? files.map((f) => `"${f}"`).join(' ') : `"${files}"`;
    await this.exec(`git add ${fileList}`, workingDir);
  }

  async commit(message: string, workingDir?: string): Promise<string> {
    const escapedMessage = message.replace(/"/g, '\\"');
    const { stdout } = await this.exec(`git commit -m "${escapedMessage}"`, workingDir);

    // Parse commit hash from output
    const match = stdout.match(/\[.+ ([a-f0-9]+)\]/);
    return match?.[1] ?? '';
  }

  // ============================================================================
  // Repository Info
  // ============================================================================

  async getRepoRoot(fromDir?: string): Promise<string> {
    const { stdout } = await this.exec('git rev-parse --show-toplevel', fromDir);
    return stdout.trim();
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('git --version', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private async exec(
    command: string,
    workingDir?: string
  ): Promise<{ stdout: string; stderr: string }> {
    const cwd = workingDir ?? this.repoRoot;

    try {
      return await execAsync(command, {
        cwd,
        timeout: EXEC_TIMEOUT_MS,
      });
    } catch (err) {
      const error = err as { stderr?: string; message?: string };
      const message = error.stderr ?? error.message ?? String(err);
      throw new GitCLIError(`Git command failed: ${command}`, new Error(message));
    }
  }
}

/**
 * Error thrown by GitCLI operations.
 */
export class GitCLIError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'GitCLIError';
    this.cause = cause;
  }
}
