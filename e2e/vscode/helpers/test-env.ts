/**
 * Test environment management for E2E tests.
 * Handles daemon lifecycle and test workspace setup.
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess, execSync } from 'child_process';
import { TestDaemonClient } from './daemon-client';
import { BeadsClient, isBeadsAvailable } from './beads-client';

export interface TestEnvConfig {
  workspacePath: string;
  daemonBinaryPath?: string;
  keepDaemonRunning?: boolean;
}

/**
 * Test environment for integration tests.
 * Manages daemon lifecycle and provides access to test helpers.
 */
export class TestEnv {
  readonly workspacePath: string;
  readonly daemonClient: TestDaemonClient;
  readonly beadsClient: BeadsClient;
  readonly beadsAvailable: boolean;

  private daemonBinaryPath: string;
  private daemonProcess: ChildProcess | null = null;
  private keepDaemonRunning: boolean;

  constructor(config: TestEnvConfig) {
    this.workspacePath = config.workspacePath;
    this.keepDaemonRunning = config.keepDaemonRunning ?? false;
    this.daemonBinaryPath = config.daemonBinaryPath || this.findDaemonBinary();

    this.daemonClient = new TestDaemonClient(this.workspacePath);
    this.beadsClient = new BeadsClient(this.workspacePath);
    this.beadsAvailable = isBeadsAvailable();
  }

  /**
   * Find the daemon binary by searching up from the test directory.
   */
  private findDaemonBinary(): string {
    let dir = __dirname;
    while (dir !== '/' && dir !== '') {
      const daemonPath = path.join(dir, 'build', 'covend');
      if (fs.existsSync(daemonPath)) {
        return daemonPath;
      }
      dir = path.dirname(dir);
    }
    throw new Error('Daemon binary not found. Run `make build` first.');
  }

  /**
   * Get path to daemon socket.
   */
  get socketPath(): string {
    return path.join(this.workspacePath, '.coven', 'covend.sock');
  }

  /**
   * Get path to daemon PID file.
   */
  get pidFilePath(): string {
    return path.join(this.workspacePath, '.coven', 'covend.pid');
  }

  /**
   * Check if daemon is running.
   */
  isDaemonRunning(): boolean {
    if (!this.daemonClient.socketExists()) {
      return false;
    }

    // Check if PID file exists and process is alive
    if (fs.existsSync(this.pidFilePath)) {
      try {
        const pid = parseInt(fs.readFileSync(this.pidFilePath, 'utf-8').trim(), 10);
        process.kill(pid, 0); // Signal 0 checks if process exists
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Start the daemon if not already running.
   */
  async startDaemon(): Promise<void> {
    if (this.isDaemonRunning()) {
      console.log('Daemon already running');
      await this.daemonClient.waitForHealthy();
      return;
    }

    // Ensure .coven directory exists
    const covenDir = path.join(this.workspacePath, '.coven');
    if (!fs.existsSync(covenDir)) {
      fs.mkdirSync(covenDir, { recursive: true });
    }

    // Clean up stale socket if exists
    if (fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }

    console.log(`Starting daemon: ${this.daemonBinaryPath} --workspace ${this.workspacePath}`);

    this.daemonProcess = spawn(this.daemonBinaryPath, ['--workspace', this.workspacePath], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Capture output for debugging
    this.daemonProcess.stdout?.on('data', (data) => {
      console.log(`[daemon stdout] ${data.toString().trim()}`);
    });
    this.daemonProcess.stderr?.on('data', (data) => {
      console.log(`[daemon stderr] ${data.toString().trim()}`);
    });

    this.daemonProcess.on('error', (err) => {
      console.error('Daemon process error:', err);
    });

    this.daemonProcess.on('exit', (code, signal) => {
      console.log(`Daemon exited: code=${code}, signal=${signal}`);
      this.daemonProcess = null;
    });

    // Wait for daemon to be healthy
    await this.daemonClient.waitForHealthy(20000);
    console.log('Daemon is healthy');
  }

  /**
   * Stop the daemon.
   */
  async stopDaemon(): Promise<void> {
    if (this.keepDaemonRunning) {
      console.log('Keeping daemon running (keepDaemonRunning=true)');
      return;
    }

    // Try graceful shutdown first
    try {
      await this.daemonClient.shutdown();
    } catch {
      // Shutdown endpoint may not respond
    }

    // Wait for process to exit or force kill
    await this.waitForDaemonStop(5000);

    // If still running, force kill
    if (this.daemonProcess && this.daemonProcess.pid) {
      try {
        process.kill(this.daemonProcess.pid, 'SIGKILL');
      } catch {
        // Already dead
      }
    }

    // Also try killing via PID file
    if (fs.existsSync(this.pidFilePath)) {
      try {
        const pid = parseInt(fs.readFileSync(this.pidFilePath, 'utf-8').trim(), 10);
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already dead
      }
    }

    // Clean up
    this.daemonProcess = null;
    console.log('Daemon stopped');
  }

  /**
   * Wait for daemon to stop.
   */
  private async waitForDaemonStop(timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!this.isDaemonRunning()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  /**
   * Restart the daemon.
   */
  async restartDaemon(): Promise<void> {
    await this.stopDaemon();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await this.startDaemon();
  }

  /**
   * Initialize beads if not already initialized.
   */
  initializeBeads(): void {
    if (!this.beadsAvailable) {
      console.log('Beads CLI not available');
      return;
    }
    this.beadsClient.initialize();
  }

  /**
   * Create a unique test task.
   * Returns the task ID.
   */
  createTestTask(title?: string, description?: string): string {
    if (!this.beadsAvailable) {
      throw new Error('Beads CLI not available');
    }

    const uniqueTitle = title || `E2E Test ${Date.now()}`;
    const taskDescription = description || `Task created by E2E test at ${new Date().toISOString()}`;

    return this.beadsClient.createTask({
      title: uniqueTitle,
      description: taskDescription,
      type: 'task',
      priority: 2,
    });
  }

  /**
   * Clean up test tasks created during tests.
   */
  cleanupTestTasks(): void {
    if (this.beadsAvailable) {
      this.beadsClient.cleanupTestTasks('E2E Test');
    }
  }

  /**
   * Full cleanup - stop daemon and clean up test data.
   */
  async cleanup(): Promise<void> {
    await this.stopDaemon();
    this.cleanupTestTasks();
  }
}

/**
 * Create a test environment from VS Code workspace path.
 */
export function createTestEnv(): TestEnv {
  const workspacePath = process.env.COVEN_E2E_WORKSPACE;
  if (!workspacePath) {
    throw new Error('COVEN_E2E_WORKSPACE environment variable not set');
  }

  return new TestEnv({
    workspacePath,
    keepDaemonRunning: process.env.COVEN_E2E_KEEP_DAEMON === 'true',
  });
}
