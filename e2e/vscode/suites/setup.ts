/**
 * Shared test setup for E2E tests.
 *
 * Provides a consistent test environment with daemon, event handling,
 * workspace management, mock agent configuration, and UI verification.
 */
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { createPresetWorkspace } from '../fixtures';
import {
  DaemonHelper,
  EventWaiter,
  createEventWaiter,
  TestDaemonClient,
  MockAgentConfigurator,
  MockAgentOptions,
  createMockAgentConfigurator,
  UIStateVerifier,
  createUIStateVerifier,
  DialogMockHelper,
  createDialogMockHelper,
} from '../helpers';

export interface TestContext {
  workspacePath: string;
  daemon: DaemonHelper;
  directClient: TestDaemonClient;
  events: EventWaiter | null;
  usingVSCodeDaemon: boolean;
  cleanup: (() => void) | null;
  /** Mock agent configurator for setting up deterministic agent behavior */
  mockAgent: MockAgentConfigurator;
  /** UI state verifier for checking tree view and status bar state */
  ui: UIStateVerifier;
  /** Dialog mock helper for testing commands with confirmation dialogs */
  dialogMock: DialogMockHelper;
  /** Install grimoire fixtures into the workspace's .coven/grimoires/ directory */
  installGrimoires: (grimoires: string[]) => void;
}

let testContext: TestContext | null = null;

/**
 * Get the path to the grimoire fixtures directory.
 * Works whether running from compiled JS or source TS.
 */
function getGrimoireFixturesDir(): string {
  const outDir = path.resolve(__dirname);
  // From out/suites, go to fixtures/grimoires
  if (outDir.includes('/out/')) {
    return outDir.replace('/out/suites', '/fixtures/grimoires');
  }
  // Fallback: relative to source location
  return path.resolve(__dirname, '..', 'fixtures', 'grimoires');
}

/**
 * Install grimoire fixtures into the workspace.
 * Copies grimoire YAML files from e2e/vscode/fixtures/grimoires/ to .coven/grimoires/.
 *
 * @param workspacePath Path to the workspace
 * @param grimoires Array of grimoire names (without .yaml extension)
 */
function installGrimoiresToWorkspace(workspacePath: string, grimoires: string[]): void {
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
 * Initialize the shared test context.
 * Call this in suiteSetup() of each test suite.
 */
export async function initTestContext(): Promise<TestContext> {
  // Return existing context if already initialized
  if (testContext) {
    return testContext;
  }

  let workspacePath: string;
  let cleanup: (() => void) | null = null;
  let usingVSCodeDaemon = false;

  // Prefer VS Code's workspace if available
  const vscodeWorkspaceFolders = vscode.workspace.workspaceFolders;
  if (vscodeWorkspaceFolders && vscodeWorkspaceFolders.length > 0) {
    workspacePath = vscodeWorkspaceFolders[0].uri.fsPath;
    console.log(`Using VS Code workspace: ${workspacePath}`);

    // Ensure .coven directory exists with daemon config
    const covenDir = path.join(workspacePath, '.coven');
    if (!fs.existsSync(covenDir)) {
      fs.mkdirSync(covenDir, { recursive: true });
    }

    // Configure daemon if not already configured
    const configPath = path.join(covenDir, 'config.json');
    if (!fs.existsSync(configPath)) {
      const daemonConfig = {
        poll_interval: 1,
        max_concurrent_agents: 1,
        log_level: 'info',
      };
      fs.writeFileSync(configPath, JSON.stringify(daemonConfig, null, 2));
    }
  } else {
    // Fallback: create our own workspace
    const workspace = createPresetWorkspace('complete');
    workspacePath = workspace.workspacePath;
    cleanup = workspace.cleanup;
    console.log(`Created test workspace: ${workspacePath}`);
  }

  const daemon = new DaemonHelper({ workspacePath });

  // Check if daemon is already running (likely started by VS Code extension)
  const alreadyHealthy = await daemon.isHealthy();
  if (alreadyHealthy) {
    console.log('Using existing daemon (started by VS Code extension)');
    usingVSCodeDaemon = true;
  } else {
    // Start daemon ourselves
    await daemon.start();
    console.log('Started daemon for tests');
  }

  const directClient = new TestDaemonClient(workspacePath);
  const mockAgent = createMockAgentConfigurator(workspacePath);
  const ui = createUIStateVerifier();
  const dialogMock = createDialogMockHelper();

  testContext = {
    workspacePath,
    daemon,
    directClient,
    events: null,
    usingVSCodeDaemon,
    cleanup,
    mockAgent,
    ui,
    dialogMock,
    installGrimoires: (grimoires: string[]) => installGrimoiresToWorkspace(workspacePath, grimoires),
  };

  return testContext;
}

/**
 * Wait for the VS Code extension to be connected to the daemon.
 * This is necessary after daemon restarts since the extension needs to reconnect.
 * Call this after any daemon restart operation.
 */
export async function waitForExtensionConnected(timeoutMs: number = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const isConnected = await vscode.commands.executeCommand<boolean>('coven._isConnected');
      if (isConnected) {
        console.log('VS Code extension connected to daemon');
        return;
      }
    } catch {
      // Command might not be available yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  console.warn(`VS Code extension did not connect to daemon within ${timeoutMs}ms`);
}

/**
 * Print recent daemon logs for debugging.
 * Call this when a test fails to see what the daemon is doing.
 */
export function printDaemonLogs(lines = 30): void {
  if (!testContext) {
    console.log('(no test context)');
    return;
  }
  try {
    const logs = testContext.daemon.getRecentLogs(lines);
    console.log('=== DAEMON LOGS ===');
    console.log(logs);
    console.log('===================');
  } catch (err) {
    console.log('(failed to read daemon logs)');
  }
}

/**
 * Initialize test context with mock agent configured.
 * This is the recommended entry point for tests that need agent execution.
 *
 * @param agentOptions Options for mock agent behavior (delay, fail, question, etc.)
 * @returns The initialized test context
 */
export async function initTestContextWithMockAgent(
  agentOptions: MockAgentOptions = { delay: '100ms' }
): Promise<TestContext> {
  // First initialize base context
  const ctx = await initTestContext();

  // Ensure mock agent is built
  if (!ctx.mockAgent.isBuilt()) {
    try {
      await ctx.mockAgent.ensureBuilt();
    } catch (err) {
      console.warn(
        'Mock agent not built and build failed. Tests requiring mock agent will fail.',
        err
      );
    }
  }

  // Configure mock agent
  ctx.mockAgent.configure(agentOptions);

  // Always restart daemon to pick up the new agent configuration
  // This is needed because:
  // 1. If daemon was started by VS Code, it doesn't have the mock agent config
  // 2. If daemon was started by initTestContext(), it was started BEFORE mock agent was configured
  console.log('Restarting daemon to apply mock agent configuration...');
  try {
    await ctx.daemon.stop();
    await ctx.daemon.start();

    // Wait for VS Code extension to reconnect after daemon restart
    await waitForExtensionConnected();
  } catch (err) {
    console.warn('Failed to restart daemon for mock agent config:', err);
  }

  return ctx;
}

/**
 * Get the current test context.
 * Throws if context hasn't been initialized.
 */
export function getTestContext(): TestContext {
  if (!testContext) {
    throw new Error('Test context not initialized. Call initTestContext() in suiteSetup()');
  }
  return testContext;
}

/**
 * Clean up the test context.
 * Call this in suiteTeardown() of the last test suite.
 */
export async function cleanupTestContext(): Promise<void> {
  if (!testContext) {
    return;
  }

  if (testContext.events) {
    testContext.events.stop();
  }

  // Only stop daemon if we started it ourselves
  if (!testContext.usingVSCodeDaemon) {
    try {
      await testContext.daemon.stop();
    } catch {
      // Ignore cleanup errors
    }
  }

  if (testContext.cleanup) {
    testContext.cleanup();
  }

  testContext = null;
}

/**
 * Get or create an SSE event waiter for the current test context.
 */
export async function getEventWaiter(): Promise<EventWaiter> {
  const ctx = getTestContext();
  if (!ctx.events) {
    ctx.events = await createEventWaiter(ctx.daemon.getSocketPath());
  }
  return ctx.events;
}

/**
 * Clear events and prepare for a fresh test.
 * Call this in setup() hook of each test.
 */
export function clearEvents(): void {
  if (testContext?.events) {
    testContext.events.clearEvents();
  }
}

/**
 * Cancel all active workflows and wait for them to complete.
 * This ensures test isolation by clearing any running tasks.
 *
 * IMPORTANT: Agents with pending questions won't cancel until questions are answered.
 * This function first answers all pending questions, then cancels workflows.
 *
 * @param timeoutMs Maximum time to wait for cleanup
 */
export async function cancelAllActiveWorkflows(timeoutMs: number = 15000): Promise<void> {
  if (!testContext) {
    return;
  }

  try {
    // STEP 1: Answer all pending questions first
    // Agents blocked on questions won't respond to cancel signals
    const { questions } = await testContext.directClient.getQuestions();
    if (questions && questions.length > 0) {
      console.log(`Answering ${questions.length} pending question(s) before cancellation...`);
      for (const q of questions) {
        try {
          await testContext.directClient.answerQuestion(q.id, 'n'); // Answer 'no' to abort
          console.log(`  Answered question: ${q.id} (task: ${q.task_id})`);
        } catch (err) {
          console.log(`  Failed to answer question ${q.id}: ${err}`);
        }
      }
      // Give agents a moment to process answers
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // STEP 2: Get and cancel all active workflows
    const { workflows } = await testContext.directClient.getWorkflows();
    const activeWorkflows = workflows.filter(
      (w) => w.status === 'running' || w.status === 'pending_merge'
    );

    if (activeWorkflows.length === 0) {
      return;
    }

    console.log(`Cancelling ${activeWorkflows.length} active workflow(s) for test isolation...`);

    // Cancel each active workflow
    for (const workflow of activeWorkflows) {
      try {
        await testContext.directClient.cancelWorkflow(workflow.task_id);
        console.log(`  Cancelled workflow: ${workflow.task_id}`);
      } catch (err) {
        // Try killing the agent directly
        try {
          await testContext.directClient.killTask(workflow.task_id);
          console.log(`  Killed agent: ${workflow.task_id}`);
        } catch {
          console.log(`  Could not cancel/kill ${workflow.task_id}: ${err}`);
        }
      }
    }

    // STEP 3: Wait for no active tasks in UI state
    await testContext.ui.waitForTreeState(
      (state) => state.active.length === 0,
      timeoutMs,
      'all workflows cancelled'
    );
    console.log('All workflows cancelled, test isolation complete');
  } catch (err) {
    console.warn('Warning: Failed to ensure test isolation:', err);
    // Don't throw - let the test proceed and potentially fail with a clearer error
  }
}

/**
 * Ensure no tasks are running before starting a test.
 * Combines event clearing with workflow cancellation and dialog mock reset.
 * Call this in setup() hook for tests that need strict isolation.
 */
export async function ensureTestIsolation(): Promise<void> {
  clearEvents();
  await cancelAllActiveWorkflows();
  // Reset dialog mock between tests to ensure no stale responses/invocations
  if (testContext?.dialogMock) {
    await testContext.dialogMock.reset();
  }
}

/**
 * Perform a fresh reset for a test suite.
 * This does a complete cleanup and restart to ensure isolation:
 * 1. Answers all pending questions
 * 2. Cancels all active workflows
 * 3. Closes all open beads tasks to prevent restart
 * 4. Restarts daemon to clear all cached state
 * 5. Waits for extension to reconnect
 *
 * Call this at the START of suiteSetup() for suites that need strict isolation.
 * This is heavier than ensureTestIsolation() but provides stronger guarantees.
 *
 * @param agentOptions Optional mock agent configuration for this suite
 */
export async function resetForSuite(agentOptions?: MockAgentOptions): Promise<void> {
  const ctx = await initTestContext();

  console.log('Performing fresh reset for test suite...');

  // Step 1: Answer any pending questions
  try {
    const { questions } = await ctx.directClient.getQuestions();
    if (questions && questions.length > 0) {
      console.log(`  Answering ${questions.length} pending question(s)...`);
      for (const q of questions) {
        try {
          await ctx.directClient.answerQuestion(q.id, 'n');
          console.log(`    Answered: ${q.id}`);
        } catch {
          // Ignore
        }
      }
      // Give agents time to process
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch {
    // Questions endpoint might fail if daemon is unhealthy
  }

  // Step 2: Cancel all active workflows
  try {
    const { workflows } = await ctx.directClient.getWorkflows();
    if (workflows && workflows.length > 0) {
      const active = workflows.filter((w) => w.status === 'running' || w.status === 'pending_merge');
      if (active.length > 0) {
        console.log(`  Cancelling ${active.length} active workflow(s)...`);
        for (const w of active) {
          try {
            await ctx.directClient.cancelWorkflow(w.task_id);
          } catch {
            try {
              await ctx.directClient.killTask(w.task_id);
            } catch {
              // Ignore
            }
          }
        }
        // Give daemon time to clean up
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  } catch {
    // Workflows endpoint might fail if daemon is unhealthy
  }

  // Step 3: Close ALL open beads tasks to prevent restart on daemon reboot
  // This is critical for isolation - old tasks must not be restarted
  try {
    const { tasks } = await ctx.directClient.getTasks();
    if (tasks && tasks.length > 0) {
      const openTasks = tasks.filter((t) => t.status === 'open' || t.status === 'in_progress');
      if (openTasks.length > 0) {
        console.log(`  Closing ${openTasks.length} open beads task(s) to prevent restart...`);
        const { execSync } = await import('child_process');
        for (const t of openTasks) {
          try {
            execSync(`bd close ${t.id} --reason="E2E suite reset"`, {
              cwd: ctx.workspacePath,
              stdio: 'pipe',
            });
          } catch {
            // Ignore - task may already be closed
          }
        }
      }
    }
  } catch {
    // Tasks endpoint might fail if daemon is unhealthy
  }

  // Step 4: Configure mock agent if specified
  if (agentOptions) {
    ctx.mockAgent.configure(agentOptions);
  }

  // Step 5: Close any existing event listener before daemon restart
  // This prevents stale SSE connections from the old daemon instance
  if (ctx.events) {
    console.log('  Closing stale event listener...');
    ctx.events.stop();
    ctx.events = null;
  }

  // Step 6: Restart daemon for clean state
  console.log('  Restarting daemon for fresh suite...');
  await ctx.daemon.stop();
  await new Promise((resolve) => setTimeout(resolve, 500)); // Let things settle
  await ctx.daemon.start();

  // Step 7: Wait for extension to reconnect
  await waitForExtensionConnected();

  // Step 8: Wait for state initialization (state.snapshot event)
  // This ensures the extension's cache is populated before tests run
  await waitForStateInitialized(ctx, 10000);

  console.log('Suite reset complete');
}

/**
 * Wait for the daemon state to be initialized.
 * This waits for the extension's cache to receive a state.snapshot event.
 *
 * @param ctx The test context
 * @param timeoutMs Maximum time to wait (default: 10000)
 */
async function waitForStateInitialized(ctx: TestContext, timeoutMs: number = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      // Check if the extension has received state from daemon
      const cacheState = await ctx.ui.getCacheState();
      if (cacheState && (cacheState.tasks || cacheState.workflow || cacheState.agents || cacheState.isInitialized)) {
        console.log('  State initialized (cache has data)');
        return;
      }
    } catch {
      // Cache state not available yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  console.warn(`  Warning: State not fully initialized within ${timeoutMs}ms`);
}

/**
 * Check if daemon is healthy. Use to skip tests when daemon is unavailable.
 */
export async function ensureDaemonHealthy(): Promise<boolean> {
  const ctx = getTestContext();
  return ctx.daemon.isHealthy();
}

/**
 * Wait for a task to be in a startable state (ready section).
 * If task is blocked, log a warning and skip gracefully.
 *
 * @returns true if task is ready, false if blocked (test should skip)
 */
export async function waitForTaskReady(
  taskId: string,
  timeoutMs: number = 15000
): Promise<boolean> {
  if (!testContext) {
    throw new Error('Test context not initialized');
  }

  try {
    // First wait for task to appear somewhere
    await testContext.ui.waitForTreeState(
      (state) => state.ready.includes(taskId) || state.blocked.includes(taskId),
      timeoutMs,
      `task ${taskId} appears in tree`
    );

    // Check current state
    const state = await testContext.ui.getTreeViewState();
    if (state?.blocked.includes(taskId)) {
      console.log(`Task ${taskId} is blocked (likely dependency from previous test), skipping test`);
      return false;
    }

    // Task is ready
    return true;
  } catch {
    console.log(`Task ${taskId} did not appear in tree within timeout`);
    return false;
  }
}
