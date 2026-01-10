import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { BinaryManager } from './binary';
import { DaemonClient } from './client';
import { DaemonClientError } from './types';

/**
 * Options for DaemonLifecycle initialization.
 */
export interface DaemonLifecycleOptions {
  /** BinaryManager for getting the daemon binary path */
  binaryManager: BinaryManager;
  /** Workspace root directory */
  workspaceRoot: string;
  /** Socket path relative to workspace (default: '.coven/covend.sock') */
  socketPath?: string;
  /** Timeout waiting for daemon to start in ms (default: 5000) */
  startTimeoutMs?: number;
  /** Polling interval when waiting for socket in ms (default: 100) */
  pollIntervalMs?: number;
}

/**
 * Error thrown when daemon fails to start.
 */
export class DaemonStartError extends Error {
  constructor(
    message: string,
    public readonly logPath: string
  ) {
    super(message);
    this.name = 'DaemonStartError';
  }
}

/**
 * Default options.
 */
const DEFAULT_OPTIONS = {
  socketPath: '.coven/covend.sock',
  startTimeoutMs: 5000,
  pollIntervalMs: 100,
};

/**
 * Manages daemon lifecycle - starting, checking status, and stopping.
 *
 * The daemon is spawned as a detached process that survives extension
 * reload. Communication happens via Unix socket.
 */
export class DaemonLifecycle {
  private readonly binaryManager: BinaryManager;
  private readonly workspaceRoot: string;
  private readonly socketPath: string;
  private readonly absoluteSocketPath: string;
  private readonly startTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly logPath: string;

  constructor(options: DaemonLifecycleOptions) {
    this.binaryManager = options.binaryManager;
    this.workspaceRoot = options.workspaceRoot;
    this.socketPath = options.socketPath ?? DEFAULT_OPTIONS.socketPath;
    this.absoluteSocketPath = path.join(this.workspaceRoot, this.socketPath);
    this.startTimeoutMs = options.startTimeoutMs ?? DEFAULT_OPTIONS.startTimeoutMs;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_OPTIONS.pollIntervalMs;
    this.logPath = path.join(this.workspaceRoot, '.coven', 'covend.log');
  }

  /**
   * Ensure daemon is running. If not running, start it.
   *
   * @throws DaemonStartError if daemon fails to start
   */
  async ensureRunning(): Promise<void> {
    const running = await this.isRunning();
    if (running) {
      return;
    }

    await this.startDaemon();
    const started = await this.waitForSocket();
    if (!started) {
      throw new DaemonStartError(
        'Daemon failed to start within timeout. Check logs for details.',
        this.logPath
      );
    }
  }

  /**
   * Check if daemon is responding to health checks.
   */
  async isRunning(): Promise<boolean> {
    // First check if socket file exists
    if (!fs.existsSync(this.absoluteSocketPath)) {
      return false;
    }

    // Try health check
    const client = new DaemonClient(this.absoluteSocketPath);
    try {
      await client.getHealth();
      return true;
    } catch (error) {
      if (error instanceof DaemonClientError) {
        // Connection refused or socket not found means not running
        if (error.code === 'connection_refused' || error.code === 'socket_not_found') {
          return false;
        }
        // Timeout might mean daemon is starting but not ready yet
        if (error.code === 'connection_timeout') {
          return false;
        }
      }
      // Any other error, consider not running
      return false;
    }
  }

  /**
   * Get the path to the daemon log file.
   */
  getLogPath(): string {
    return this.logPath;
  }

  /**
   * Get the absolute socket path.
   */
  getSocketPath(): string {
    return this.absoluteSocketPath;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Start the daemon process.
   */
  private async startDaemon(): Promise<void> {
    const binaryPath = await this.binaryManager.ensureBinary();

    // Ensure .coven directory exists
    const covenDir = path.join(this.workspaceRoot, '.coven');
    if (!fs.existsSync(covenDir)) {
      fs.mkdirSync(covenDir, { recursive: true });
    }

    // Open log file for daemon output
    const logStream = fs.openSync(this.logPath, 'a');

    // Spawn detached daemon process
    const child: ChildProcess = spawn(
      binaryPath,
      ['--workspace', this.workspaceRoot],
      {
        detached: true,
        stdio: ['ignore', logStream, logStream],
        cwd: this.workspaceRoot,
        env: {
          ...process.env,
          // Ensure daemon knows about the workspace
          COVEN_WORKSPACE: this.workspaceRoot,
        },
      }
    );

    // Unref to allow extension to exit without waiting for daemon
    child.unref();

    // Close our reference to the log stream
    // The daemon process keeps its own reference
    fs.closeSync(logStream);

    // Small delay to allow process to start
    await this.delay(100);
  }

  /**
   * Wait for socket to become available.
   *
   * @returns true if socket is ready, false if timeout
   */
  private async waitForSocket(): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < this.startTimeoutMs) {
      const running = await this.isRunning();
      if (running) {
        return true;
      }
      await this.delay(this.pollIntervalMs);
    }

    return false;
  }

  /**
   * Helper to delay for a specified number of milliseconds.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
