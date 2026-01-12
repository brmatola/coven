/**
 * Isolated test context for proper E2E test isolation.
 *
 * Each test suite can create its own isolated context with:
 * - Fresh workspace directory with git and beads initialized
 * - Its own daemon instance (not shared with VS Code)
 * - Proper cleanup on teardown
 *
 * This prevents cross-test contamination from:
 * - Accumulated beads tasks
 * - Orphaned workflows
 * - Daemon state
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import {
  DaemonHelper,
  TestDaemonClient,
  MockAgentConfigurator,
  createMockAgentConfigurator,
  UIStateVerifier,
  createUIStateVerifier,
  EventWaiter,
  createEventWaiter,
  MockAgentOptions,
} from './index';

/**
 * An isolated test context that doesn't share state with other suites.
 */
export interface IsolatedTestContext {
  /** Unique identifier for this context */
  id: string;
  /** Fresh workspace path for this suite */
  workspacePath: string;
  /** Daemon helper for this suite's daemon */
  daemon: DaemonHelper;
  /** Direct client for daemon API calls */
  directClient: TestDaemonClient;
  /** Mock agent configurator */
  mockAgent: MockAgentConfigurator;
  /** UI state verifier */
  ui: UIStateVerifier;
  /** Event waiter (created on demand) */
  events: EventWaiter | null;
  /** Array to track created task IDs for cleanup */
  taskIds: string[];
  /** Cleanup function - call this in suiteTeardown */
  cleanup: () => Promise<void>;
  /** Install grimoires into this context's workspace */
  installGrimoires: (grimoires: string[]) => void;
  /** Create a task with a grimoire label */
  createTask: (title: string, grimoire: string) => string;
  /** Restart daemon with new mock agent options */
  restartWithOptions: (options: MockAgentOptions) => Promise<void>;
}

/**
 * Options for creating an isolated context.
 */
export interface IsolatedContextOptions {
  /** Name prefix for the workspace (helps identify in logs) */
  name?: string;
  /** Initial mock agent options */
  agentOptions?: MockAgentOptions;
  /** Grimoires to install by default */
  grimoires?: string[];
}

/**
 * Find the repo root from the compiled helper location.
 */
function findRepoRoot(): string {
  // From out/helpers/isolated-context.js, go up 4 levels to repo root
  return path.resolve(__dirname, '..', '..', '..', '..');
}

/**
 * Find the grimoire fixtures source directory.
 */
function getGrimoireFixturesDir(): string {
  const outDir = path.resolve(__dirname);
  // From out/helpers, go to fixtures/grimoires
  if (outDir.includes('/out/')) {
    return outDir.replace('/out/helpers', '/fixtures/grimoires');
  }
  return path.resolve(outDir, '..', 'fixtures', 'grimoires');
}

/**
 * Create a fresh isolated workspace with git and beads initialized.
 */
function createIsolatedWorkspace(name: string): { workspacePath: string; cleanup: () => void } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `coven-e2e-${name}-`));

  try {
    // Initialize git
    execSync('git init', { cwd: tempDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'pipe' });

    // Create initial commit
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test Workspace\n');
    execSync('git add .', { cwd: tempDir, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: 'pipe' });

    // Initialize beads
    try {
      execSync('bd init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git add .beads', { cwd: tempDir, stdio: 'pipe' });
      execSync('git commit -m "Initialize beads"', { cwd: tempDir, stdio: 'pipe' });
    } catch (err) {
      console.warn('Beads CLI not available:', err);
    }

    // Initialize .coven directory
    const covenDir = path.join(tempDir, '.coven');
    fs.mkdirSync(covenDir, { recursive: true });
    const covenConfig = {
      poll_interval: 1,
      max_concurrent_agents: 1,
      log_level: 'debug',
    };
    fs.writeFileSync(path.join(covenDir, 'config.json'), JSON.stringify(covenConfig, null, 2));

    // Configure VS Code settings to use test daemon binary
    const repoRoot = findRepoRoot();
    const daemonBinaryPath = path.join(repoRoot, 'build', 'covend');
    const vscodeDir = path.join(tempDir, '.vscode');
    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.writeFileSync(
      path.join(vscodeDir, 'settings.json'),
      JSON.stringify({ 'coven.binaryPath': daemonBinaryPath }, null, 2)
    );
  } catch (err) {
    // Clean up on error
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw err;
  }

  return {
    workspacePath: tempDir,
    cleanup: () => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (err) {
        console.warn(`Failed to clean up workspace ${tempDir}:`, err);
      }
    },
  };
}

/**
 * Install grimoires into a workspace.
 */
function installGrimoires(workspacePath: string, grimoires: string[]): void {
  const grimoiresDir = path.join(workspacePath, '.coven', 'grimoires');
  fs.mkdirSync(grimoiresDir, { recursive: true });

  const fixturesDir = getGrimoireFixturesDir();

  for (const grimoire of grimoires) {
    const srcPath = path.join(fixturesDir, `${grimoire}.yaml`);
    const destPath = path.join(grimoiresDir, `${grimoire}.yaml`);

    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
      console.log(`Installed grimoire: ${grimoire}`);
    } else {
      console.warn(`Grimoire fixture not found: ${srcPath}`);
    }
  }
}

/**
 * Create a task with grimoire label using beads CLI.
 */
function createTaskWithBeads(workspacePath: string, title: string, grimoire: string): string {
  const output = execSync(
    `bd create --title="${title}" --type=task --priority=2 --label="grimoire:${grimoire}"`,
    { cwd: workspacePath, encoding: 'utf-8' }
  );

  const match = output.match(/Created issue:\s*([a-zA-Z0-9-]+)/);
  if (!match) {
    throw new Error(`Could not parse task ID from: ${output}`);
  }

  return match[1];
}

/**
 * Create an isolated test context.
 *
 * This creates a completely fresh environment for a test suite:
 * - New workspace with git and beads
 * - Its own daemon instance
 * - No shared state with other suites
 *
 * Usage:
 * ```typescript
 * let ctx: IsolatedTestContext;
 *
 * suiteSetup(async function() {
 *   ctx = await createIsolatedTestContext({
 *     name: 'my-suite',
 *     agentOptions: { delay: '100ms' },
 *     grimoires: ['simple-agent'],
 *   });
 * });
 *
 * suiteTeardown(async function() {
 *   await ctx.cleanup();
 * });
 *
 * test('my test', async function() {
 *   const taskId = ctx.createTask('Test Task', 'simple-agent');
 *   // ... test code
 *   ctx.taskIds.push(taskId); // Track for cleanup
 * });
 * ```
 */
export async function createIsolatedTestContext(
  options: IsolatedContextOptions = {}
): Promise<IsolatedTestContext> {
  const name = options.name ?? 'isolated';
  const id = `${name}-${Date.now()}`;

  console.log(`Creating isolated test context: ${id}`);

  // Create fresh workspace
  const { workspacePath, cleanup: cleanupWorkspace } = createIsolatedWorkspace(name);
  console.log(`Isolated workspace: ${workspacePath}`);

  // Create helpers
  const daemon = new DaemonHelper({ workspacePath });
  const directClient = new TestDaemonClient(workspacePath);
  const mockAgent = createMockAgentConfigurator(workspacePath);
  const ui = createUIStateVerifier();
  const taskIds: string[] = [];

  // Ensure mock agent is built
  if (!mockAgent.isBuilt()) {
    try {
      await mockAgent.ensureBuilt();
    } catch (err) {
      console.warn('Mock agent build failed:', err);
    }
  }

  // Configure mock agent if options provided
  if (options.agentOptions) {
    mockAgent.configure(options.agentOptions);
  }

  // Start daemon (our own, not VS Code's)
  await daemon.start();
  console.log('Isolated daemon started');

  // Install default grimoires if specified
  if (options.grimoires && options.grimoires.length > 0) {
    installGrimoires(workspacePath, options.grimoires);
  }

  // Create context object
  const ctx: IsolatedTestContext = {
    id,
    workspacePath,
    daemon,
    directClient,
    mockAgent,
    ui,
    events: null,
    taskIds,

    installGrimoires: (grimoires: string[]) => {
      installGrimoires(workspacePath, grimoires);
    },

    createTask: (title: string, grimoire: string) => {
      const taskId = createTaskWithBeads(workspacePath, title, grimoire);
      taskIds.push(taskId);
      return taskId;
    },

    restartWithOptions: async (newOptions: MockAgentOptions) => {
      mockAgent.configure(newOptions);
      await daemon.restart();
      console.log('Isolated daemon restarted with new options');
    },

    cleanup: async () => {
      console.log(`Cleaning up isolated context: ${id}`);

      // Stop event waiter
      if (ctx.events) {
        ctx.events.stop();
      }

      // Close all tasks we created
      for (const taskId of taskIds) {
        try {
          execSync(`bd close ${taskId} --reason="E2E test cleanup"`, {
            cwd: workspacePath,
            stdio: 'pipe',
          });
        } catch {
          // Ignore - task may already be closed
        }
      }

      // Stop daemon
      try {
        await daemon.stop();
      } catch (err) {
        console.warn('Failed to stop isolated daemon:', err);
      }

      // Clean up workspace
      cleanupWorkspace();

      console.log(`Isolated context cleaned up: ${id}`);
    },
  };

  return ctx;
}

/**
 * Get or create event waiter for an isolated context.
 */
export async function getIsolatedEventWaiter(ctx: IsolatedTestContext): Promise<EventWaiter> {
  if (!ctx.events) {
    ctx.events = await createEventWaiter(ctx.daemon.getSocketPath());
  }
  return ctx.events;
}

/**
 * Clear events for an isolated context.
 */
export function clearIsolatedEvents(ctx: IsolatedTestContext): void {
  if (ctx.events) {
    ctx.events.clearEvents();
  }
}

/**
 * Wait for task to appear in ready section of UI.
 * Polls the daemon API since we're not using VS Code's tree view.
 */
export async function waitForTaskReady(
  ctx: IsolatedTestContext,
  taskId: string,
  timeoutMs: number = 15000
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const { tasks } = await ctx.directClient.getTasks();
      const task = tasks.find((t) => t.id === taskId);

      if (task) {
        // Task is ready if it's open and has no blockers
        if (task.status === 'open') {
          return true;
        }
      }
    } catch {
      // API error - keep trying
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return false;
}

/**
 * Wait for workflow to complete or fail.
 */
export async function waitForWorkflowDone(
  ctx: IsolatedTestContext,
  taskId: string,
  timeoutMs: number = 30000
): Promise<'completed' | 'failed' | 'cancelled' | 'timeout'> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const workflow = await ctx.directClient.getWorkflow(taskId);

      if (!workflow) {
        // No workflow = completed/cleaned up
        return 'completed';
      }

      if (workflow.status === 'completed') {
        return 'completed';
      }
      if (workflow.status === 'failed') {
        return 'failed';
      }
      if (workflow.status === 'cancelled') {
        return 'cancelled';
      }
    } catch {
      // API error - keep trying
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return 'timeout';
}
