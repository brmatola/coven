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
}

let testContext: TestContext | null = null;

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

  testContext = {
    workspacePath,
    daemon,
    directClient,
    events: null,
    usingVSCodeDaemon,
    cleanup,
    mockAgent,
    ui,
  };

  return testContext;
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

  // If daemon is already running (VS Code started it), we need to restart it
  // to pick up the new agent configuration
  if (ctx.usingVSCodeDaemon) {
    console.log('Restarting daemon to apply mock agent configuration...');
    try {
      await ctx.daemon.stop();
      await ctx.daemon.start();
    } catch (err) {
      console.warn('Failed to restart daemon for mock agent config:', err);
    }
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
 * Check if daemon is healthy. Use to skip tests when daemon is unavailable.
 */
export async function ensureDaemonHealthy(): Promise<boolean> {
  const ctx = getTestContext();
  return ctx.daemon.isHealthy();
}
