/**
 * Daemon lifecycle helpers for E2E tests.
 *
 * Provides utilities to start, stop, and interact with the daemon process
 * in test environments.
 */
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import * as http from 'http';
import { spawn, ChildProcess, execSync } from 'child_process';

/**
 * Options for creating a DaemonHelper instance.
 */
export interface DaemonHelperOptions {
  /** Workspace root path */
  workspacePath: string;
  /** Path to daemon binary (auto-detected if not provided) */
  binaryPath?: string;
  /** Timeout for health checks in ms (default: 5000) */
  healthTimeoutMs?: number;
  /** Poll interval for health checks in ms (default: 100) */
  pollIntervalMs?: number;
}

/**
 * Find the daemon binary path from the repo root.
 */
function findDaemonBinary(): string {
  // Go up from e2e/vscode/helpers to repo root
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const daemonBin = path.join(repoRoot, 'build', 'covend');

  if (!fs.existsSync(daemonBin)) {
    throw new Error(
      `Daemon binary not found at ${daemonBin}. ` +
      `Run 'make build' or 'make build-daemon' first.`
    );
  }

  return daemonBin;
}

/**
 * Helper for managing daemon lifecycle in E2E tests.
 *
 * Usage:
 * ```typescript
 * const helper = new DaemonHelper({ workspacePath: '/tmp/test-workspace' });
 * await helper.start();
 * // ... run tests ...
 * await helper.stop();
 * ```
 */
export class DaemonHelper {
  private readonly workspacePath: string;
  private readonly binaryPath: string;
  private readonly healthTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly socketPath: string;
  private readonly logPath: string;
  private process: ChildProcess | null = null;

  constructor(options: DaemonHelperOptions) {
    this.workspacePath = options.workspacePath;
    this.binaryPath = options.binaryPath ?? findDaemonBinary();
    this.healthTimeoutMs = options.healthTimeoutMs ?? 5000;
    this.pollIntervalMs = options.pollIntervalMs ?? 100;
    this.socketPath = path.join(this.workspacePath, '.coven', 'covend.sock');
    this.logPath = path.join(this.workspacePath, '.coven', 'covend.log');
  }

  /**
   * Start the daemon process.
   *
   * @throws Error if daemon fails to start within timeout
   */
  async start(): Promise<void> {
    // Ensure .coven directory exists
    const covenDir = path.join(this.workspacePath, '.coven');
    fs.mkdirSync(covenDir, { recursive: true });

    // Clean up any stale socket
    if (fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }

    // Open log file
    const logStream = fs.openSync(this.logPath, 'a');

    // Spawn daemon
    this.process = spawn(
      this.binaryPath,
      ['--workspace', this.workspacePath],
      {
        detached: false, // For tests, we want to track the process
        stdio: ['ignore', logStream, logStream],
        cwd: this.workspacePath,
        env: {
          ...process.env,
          COVEN_WORKSPACE: this.workspacePath,
        },
      }
    );

    fs.closeSync(logStream);

    // Handle unexpected exit
    this.process.on('error', (err) => {
      console.error(`Daemon process error: ${err.message}`);
    });

    this.process.on('exit', (code, signal) => {
      if (code !== null && code !== 0) {
        console.error(`Daemon exited with code ${code}`);
      } else if (signal) {
        console.log(`Daemon killed with signal ${signal}`);
      }
      this.process = null;
    });

    // Wait for daemon to be healthy
    const healthy = await this.waitForHealth();
    if (!healthy) {
      const logs = this.getRecentLogs();
      throw new Error(
        `Daemon failed to start within ${this.healthTimeoutMs}ms. Recent logs:\n${logs}`
      );
    }
  }

  /**
   * Stop the daemon process.
   *
   * @param timeout Maximum time to wait for graceful shutdown in ms
   */
  async stop(timeout = 5000): Promise<void> {
    if (!this.process) {
      return;
    }

    // Try graceful shutdown via API first
    try {
      await this.sendRequest('POST', '/shutdown');
      await this.waitForExit(timeout);
      return;
    } catch {
      // Graceful shutdown failed, try SIGTERM
    }

    // Send SIGTERM
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      await this.waitForExit(timeout);
    }

    // Force kill if still running
    if (this.process && !this.process.killed) {
      this.process.kill('SIGKILL');
    }

    this.process = null;
  }

  /**
   * Check if daemon is responding to health checks.
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.sendRequest<{ status: string }>('GET', '/health');
      return response.status === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * Wait for daemon to become healthy.
   *
   * @returns true if daemon is healthy, false if timeout
   */
  async waitForHealth(timeout?: number): Promise<boolean> {
    const endTime = Date.now() + (timeout ?? this.healthTimeoutMs);

    while (Date.now() < endTime) {
      if (await this.isHealthy()) {
        return true;
      }
      await this.delay(this.pollIntervalMs);
    }

    return false;
  }

  /**
   * Wait for a specific condition on daemon state.
   *
   * @param predicate Function that returns true when condition is met
   * @param timeout Maximum time to wait in ms
   * @param message Description of what we're waiting for (for error messages)
   */
  async waitFor<T>(
    predicate: () => Promise<T | null>,
    timeout: number,
    message: string
  ): Promise<T> {
    const endTime = Date.now() + timeout;

    while (Date.now() < endTime) {
      const result = await predicate();
      if (result !== null) {
        return result;
      }
      await this.delay(this.pollIntervalMs);
    }

    throw new Error(`Timeout waiting for ${message} after ${timeout}ms`);
  }

  /**
   * Get the socket path.
   */
  getSocketPath(): string {
    return this.socketPath;
  }

  /**
   * Get the log file path.
   */
  getLogPath(): string {
    return this.logPath;
  }

  /**
   * Get recent daemon logs (last 50 lines).
   */
  getRecentLogs(lines = 50): string {
    try {
      if (!fs.existsSync(this.logPath)) {
        return '(no logs)';
      }
      const content = fs.readFileSync(this.logPath, 'utf-8');
      const allLines = content.split('\n');
      return allLines.slice(-lines).join('\n');
    } catch {
      return '(failed to read logs)';
    }
  }

  /**
   * Send an HTTP request to the daemon via Unix socket.
   */
  async sendRequest<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        socketPath: this.socketPath,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = data ? JSON.parse(data) : {};
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(json)}`));
            } else {
              resolve(json as T);
            }
          } catch {
            resolve(data as unknown as T);
          }
        });
      });

      req.on('error', reject);

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Wait for daemon process to exit.
   */
  private waitForExit(timeout: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        resolve();
      }, timeout);

      this.process.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Helper to delay for a specified number of milliseconds.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a DaemonHelper with sensible test defaults.
 */
export function createDaemonHelper(workspacePath: string): DaemonHelper {
  return new DaemonHelper({ workspacePath });
}
