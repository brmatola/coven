import { exec } from 'child_process';
import { promisify } from 'util';
import { getLogger } from '../shared/logger';

const execAsync = promisify(exec);

const EXEC_TIMEOUT_MS = 30000; // 30 second timeout for CLI commands

/**
 * Raw bead data from the Beads CLI JSON output.
 */
export interface BeadData {
  id: string;
  title: string;
  description?: string;
  status: 'open' | 'in_progress' | 'closed';
  priority: number;
  issue_type: 'task' | 'bug' | 'epic' | 'story' | 'feature';
  created_at: string;
  created_by: string;
  updated_at: string;
  labels?: string[];
  close_reason?: string;
  dependencies?: BeadDependency[];
}

/**
 * Bead dependency information.
 */
export interface BeadDependency {
  id: string;
  title: string;
  status: string;
  dependency_type: 'blocks' | 'blocked-by' | 'parent-child';
}

/**
 * Options for creating a new bead.
 */
export interface CreateBeadOptions {
  title: string;
  description?: string;
  priority?: number;
  type?: 'task' | 'bug' | 'epic' | 'story';
  labels?: string[];
  parent?: string;
}

/**
 * Result of a bead operation.
 */
export interface BeadResult {
  success: boolean;
  id?: string;
  error?: string;
}

/**
 * Client for interacting with the Beads CLI (`bd` command).
 * Wraps CLI commands and provides typed responses.
 */
export class BeadsClient {
  private workspaceRoot: string;
  private logger = getLogger();

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Check if the Beads CLI is available.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('bd --version', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if Beads is initialized in the workspace.
   */
  async isInitialized(): Promise<boolean> {
    try {
      await this.exec('bd list --limit 1');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List ready (unblocked) issues of all types.
   */
  async listReady(): Promise<BeadData[]> {
    try {
      const { stdout } = await this.exec('bd ready --json');
      const beads = JSON.parse(stdout) as BeadData[];
      // Return all ready issues - bd ready already filters for unblocked
      return beads;
    } catch (err) {
      this.logger.error('Failed to list ready beads', { error: String(err) });
      throw new BeadsClientError('Failed to list ready tasks', err);
    }
  }

  /**
   * List all open issues (including blocked ones).
   */
  async listOpen(): Promise<BeadData[]> {
    try {
      const { stdout } = await this.exec('bd list --status open --json');
      const beads = JSON.parse(stdout) as BeadData[];
      // Return all open issues regardless of type
      return beads;
    } catch (err) {
      this.logger.error('Failed to list open beads', { error: String(err) });
      throw new BeadsClientError('Failed to list open tasks', err);
    }
  }

  /**
   * Get a specific task by ID.
   */
  async getTask(id: string): Promise<BeadData | null> {
    try {
      const { stdout } = await this.exec(`bd show ${this.escapeArg(id)} --json`);
      const beads = JSON.parse(stdout) as BeadData[];
      return beads.length > 0 ? beads[0] ?? null : null;
    } catch (err) {
      // Check if it's a "not found" error
      if (String(err).includes('not found') || String(err).includes('No issue')) {
        return null;
      }
      this.logger.error('Failed to get bead', { id, error: String(err) });
      throw new BeadsClientError(`Failed to get task ${id}`, err);
    }
  }

  /**
   * Create a new task.
   */
  async createTask(options: CreateBeadOptions): Promise<BeadResult> {
    try {
      const args = [
        'bd',
        'create',
        this.escapeArg(options.title),
        '--type',
        options.type ?? 'task',
        '--priority',
        String(options.priority ?? 2),
      ];

      if (options.description) {
        args.push('--description', this.escapeArg(options.description));
      }

      if (options.labels && options.labels.length > 0) {
        args.push('--labels', options.labels.join(','));
      }

      if (options.parent) {
        args.push('--parent', this.escapeArg(options.parent));
      }

      const { stdout } = await this.exec(args.join(' '));

      // Parse the created ID from output like "✓ Created issue: coven-xyz"
      const match = stdout.match(/Created issue:\s*(\S+)/);
      const createdId = match?.[1];
      if (createdId) {
        return { success: true, id: createdId };
      }

      return { success: true };
    } catch (err) {
      this.logger.error('Failed to create bead', { options, error: String(err) });
      return { success: false, error: String(err) };
    }
  }

  /**
   * Update the status of a task.
   */
  async updateStatus(
    id: string,
    status: 'open' | 'in_progress' | 'closed'
  ): Promise<BeadResult> {
    try {
      if (status === 'closed') {
        await this.exec(`bd close ${this.escapeArg(id)}`);
      } else {
        await this.exec(`bd update ${this.escapeArg(id)} --status ${status}`);
      }
      return { success: true, id };
    } catch (err) {
      this.logger.error('Failed to update bead status', { id, status, error: String(err) });
      return { success: false, error: String(err) };
    }
  }

  /**
   * Update a task's title and/or description.
   */
  async updateTask(
    id: string,
    updates: { title?: string | undefined; description?: string | undefined }
  ): Promise<BeadResult> {
    try {
      const args = ['bd', 'update', this.escapeArg(id)];

      if (updates.title !== undefined) {
        args.push('--title', this.escapeArg(updates.title));
      }

      if (updates.description !== undefined) {
        args.push('--description', this.escapeArg(updates.description));
      }

      // Only run if there are updates
      if (args.length > 3) {
        await this.exec(args.join(' '));
      }

      return { success: true, id };
    } catch (err) {
      this.logger.error('Failed to update bead', { id, updates, error: String(err) });
      return { success: false, error: String(err) };
    }
  }

  /**
   * Close a task with a reason.
   */
  async closeTask(id: string, reason?: string): Promise<BeadResult> {
    try {
      const args = ['bd', 'close', this.escapeArg(id)];
      if (reason) {
        args.push('--reason', this.escapeArg(reason));
      }
      await this.exec(args.join(' '));
      return { success: true, id };
    } catch (err) {
      this.logger.error('Failed to close bead', { id, error: String(err) });
      return { success: false, error: String(err) };
    }
  }

  /**
   * Reopen a closed task.
   */
  async reopenTask(id: string): Promise<BeadResult> {
    try {
      await this.exec(`bd reopen ${this.escapeArg(id)}`);
      return { success: true, id };
    } catch (err) {
      this.logger.error('Failed to reopen bead', { id, error: String(err) });
      return { success: false, error: String(err) };
    }
  }

  /**
   * Get blockers for a task.
   */
  async getBlockers(id: string): Promise<string[]> {
    const bead = await this.getTask(id);
    if (!bead || !bead.dependencies) {
      return [];
    }
    return bead.dependencies
      .filter((d) => d.dependency_type === 'blocked-by' && d.status !== 'closed')
      .map((d) => d.id);
  }

  /**
   * Execute a bd command in the workspace.
   */
  private async exec(command: string): Promise<{ stdout: string; stderr: string }> {
    return execAsync(command, {
      cwd: this.workspaceRoot,
      timeout: EXEC_TIMEOUT_MS,
    });
  }

  /**
   * Escape a command argument to prevent injection.
   */
  private escapeArg(arg: string): string {
    // Use double quotes and escape internal double quotes
    return `"${arg.replace(/"/g, '\\"')}"`;
  }
}

/**
 * Error thrown by BeadsClient operations.
 */
export class BeadsClientError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'BeadsClientError';
    this.cause = cause;
  }
}
