import * as vscode from 'vscode';
import { WorkflowTreeProvider } from './sidebar/WorkflowTreeProvider';
import { CovenStatusBar } from './sidebar/CovenStatusBar';
import { checkPrerequisites } from './setup/prerequisites';
import { SetupPanel } from './setup/SetupPanel';
import { SetupTreeProvider } from './setup/SetupTreeProvider';
import { TaskDetailPanel } from './tasks/TaskDetailPanel';
import { ReviewPanel } from './review/ReviewPanel';
import { ExtensionContext } from './shared/extensionContext';
import { FamiliarOutputChannel } from './agents/FamiliarOutputChannel';
import { QuestionHandler } from './agents/QuestionHandler';
import { NotificationService } from './shared/notifications';
import { BeadsTaskSource } from './tasks/BeadsTaskSource';
import {
  ConnectionManager,
  DaemonClient,
  SSEClient,
  StateCache,
  BinaryManager,
  DaemonLifecycle,
  DaemonNotificationService,
  DaemonStartError,
} from './daemon';
import { WorktreeManager } from './git/WorktreeManager';
import { detectCoven } from './setup/detection';
import {
  stopDaemon,
  restartDaemon,
  DaemonCommandDependencies,
} from './commands/daemon';
import {
  approveWorkflow,
  rejectWorkflow,
} from './commands/workflow';

// Global state
let workflowProvider: WorkflowTreeProvider | null = null;
let setupProvider: SetupTreeProvider | null = null;
let statusBar: CovenStatusBar | null = null;
let connectionManager: ConnectionManager | null = null;
let stateCache: StateCache | null = null;
let sseClient: SSEClient | null = null;
let familiarOutputChannel: FamiliarOutputChannel | null = null;
let questionHandler: QuestionHandler | null = null;
let treeView: vscode.TreeView<unknown> | null = null;
let beadsTaskSource: BeadsTaskSource | null = null;
let worktreeManager: WorktreeManager | null = null;
let daemonSocketPath: string | null = null;
let daemonNotifications: DaemonNotificationService | null = null;
let reconnectStatusDisposable: vscode.Disposable | null = null;
let daemonLifecycle: DaemonLifecycle | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const ctx = ExtensionContext.initialize(context);
  ctx.logger.info('Coven extension activating');

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // Initialize status bar
  statusBar = new CovenStatusBar();
  ctx.statusBarItem = statusBar.getStatusBarItem();
  ctx.subscriptions.push(statusBar);

  // Initialize state cache for workflow provider
  stateCache = new StateCache();

  // Initialize workflow tree provider
  workflowProvider = new WorkflowTreeProvider(context);
  treeView = vscode.window.createTreeView('coven.sessions', {
    treeDataProvider: workflowProvider,
    showCollapseAll: true,
  });
  ctx.subscriptions.push(treeView);
  ctx.subscriptions.push(workflowProvider);

  // Connect tree provider to state cache
  workflowProvider.setCache(stateCache);

  // Register commands
  ctx.subscriptions.push(
    vscode.commands.registerCommand('coven.startSession', (branchName?: string) =>
      startSession(workspaceRoot, branchName)
    ),
    vscode.commands.registerCommand(
      'coven.stopSession',
      (options?: { skipConfirmation?: boolean }) => stopSession(options)
    ),
    vscode.commands.registerCommand('coven.showSetup', showSetup),
    vscode.commands.registerCommand('coven.revealSidebar', revealSidebar),
    vscode.commands.registerCommand('coven.showTaskDetail', showTaskDetail),
    vscode.commands.registerCommand('coven.viewFamiliarOutput', viewFamiliarOutput),
    vscode.commands.registerCommand('coven.createTask', createTask),
    vscode.commands.registerCommand('coven.startTask', startTask),
    vscode.commands.registerCommand('coven.stopTask', stopTask),
    vscode.commands.registerCommand('coven.refreshTasks', refreshTasks),
    vscode.commands.registerCommand('coven.respondToQuestion', respondToQuestion),
    vscode.commands.registerCommand('coven.reviewTask', reviewTask),
    vscode.commands.registerCommand('coven.viewDaemonLogs', viewDaemonLogs),
    vscode.commands.registerCommand('coven.stopDaemon', handleStopDaemon),
    vscode.commands.registerCommand('coven.restartDaemon', handleRestartDaemon),
    vscode.commands.registerCommand('coven.cancelWorkflow', cancelWorkflow),
    vscode.commands.registerCommand('coven.retryWorkflow', retryWorkflow),
    vscode.commands.registerCommand('coven.approveMerge', approveMerge),
    vscode.commands.registerCommand('coven.rejectMerge', rejectMerge)
  );

  // Check workspace initialization status
  if (workspaceRoot) {
    // Initialize daemon notification service
    daemonNotifications = new DaemonNotificationService(workspaceRoot);

    // Check if .coven/ directory exists
    const covenDetection = await detectCoven();

    if (covenDetection.status === 'missing') {
      // Show setup tree provider instead of workflow tree
      ctx.logger.info('Coven not initialized in workspace, showing setup view');
      setupProvider = new SetupTreeProvider(workspaceRoot);
      ctx.subscriptions.push(setupProvider);
      // Status bar will show "not initialized" state
      statusBar.setNotInitialized();
    } else {
      // Initialize daemon connection
      await initializeDaemon(context, workspaceRoot);
    }
  }

  // Check prerequisites
  try {
    const prereqs = await checkPrerequisites();
    ctx.logger.info('Prerequisites check complete', { allMet: prereqs.allMet });
    if (!prereqs.allMet) {
      await SetupPanel.createOrShow(ctx.extensionUri);
    }
  } catch (err) {
    ctx.logger.error('Failed to check prerequisites', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  ctx.logger.info('Coven extension activated');
}

export function deactivate(): void {
  // Clean up reconnect status
  reconnectStatusDisposable?.dispose();
  reconnectStatusDisposable = null;

  if (connectionManager) {
    connectionManager.disconnect();
    connectionManager = null;
  }
  if (familiarOutputChannel) {
    familiarOutputChannel.dispose();
    familiarOutputChannel = null;
  }
  if (setupProvider) {
    setupProvider.dispose();
    setupProvider = null;
  }

  // Reset all daemon-related state
  daemonNotifications = null;
  daemonSocketPath = null;
  daemonLifecycle = null;
  sseClient = null;
  stateCache = null;
  beadsTaskSource = null;
  worktreeManager = null;
  questionHandler = null;

  if (ExtensionContext.isInitialized()) {
    ExtensionContext.get().logger.info('Coven extension deactivating');
    ExtensionContext.dispose();
  }
}

/**
 * View daemon logs command handler.
 */
async function viewDaemonLogs(): Promise<void> {
  if (daemonNotifications) {
    await daemonNotifications.viewLogs();
  } else {
    await vscode.window.showErrorMessage('Coven: Daemon not configured');
  }
}

/**
 * Initialize connection to the daemon.
 */
async function initializeDaemon(
  context: vscode.ExtensionContext,
  workspaceRoot: string
): Promise<void> {
  const ctx = ExtensionContext.get();

  try {
    // Get override path from settings (for development)
    const config = vscode.workspace.getConfiguration('coven');
    const overridePath = config.get<string>('binaryPath') || undefined;

    // Create binary manager
    const binaryManager = new BinaryManager({
      extensionPath: context.extensionPath,
      bundledVersion: '0.1.0',
      overridePath,
    });

    // Create lifecycle manager
    const lifecycle = new DaemonLifecycle({
      binaryManager,
      workspaceRoot,
    });
    daemonLifecycle = lifecycle;

    // Show starting notification
    const startingDisposable = await daemonNotifications?.showStarting();

    try {
      // Ensure daemon is running (auto-starts if needed)
      await lifecycle.ensureRunning();
      startingDisposable?.dispose();
      daemonNotifications?.showStarted();
    } catch (err) {
      startingDisposable?.dispose();
      if (err instanceof DaemonStartError) {
        await daemonNotifications?.showError(err, {
          viewLogs: () => daemonNotifications?.viewLogs(),
        });
      }
      throw err;
    }

    // Store socket path
    daemonSocketPath = lifecycle.getSocketPath();

    // Create SSE client for state updates
    sseClient = new SSEClient(daemonSocketPath);

    // Create daemon client
    const daemonClient = new DaemonClient(daemonSocketPath);

    // Create connection manager
    connectionManager = new ConnectionManager(daemonClient, sseClient, stateCache!);

    // Wire up connection manager events to notifications
    setupConnectionEventHandlers(connectionManager);

    // Connect to daemon
    await connectionManager.connect();

    // Wire up status bar to state cache
    statusBar?.setStateCache(stateCache);

    // Initialize notification service for agent events
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _notificationService = new NotificationService(() => ({
      notifications: true,
      notifyCompletion: true,
      notifyError: true,
    }));

    // Initialize task source
    beadsTaskSource = new BeadsTaskSource(daemonClient, sseClient, workspaceRoot);
    beadsTaskSource.watch();

    // Initialize worktree manager
    worktreeManager = new WorktreeManager(workspaceRoot);

    // Initialize output channel
    familiarOutputChannel = new FamiliarOutputChannel(daemonClient, sseClient);
    familiarOutputChannel.initialize();

    // Initialize question handler
    questionHandler = new QuestionHandler(daemonClient, sseClient);
    questionHandler.initialize();

    ctx.logger.info('Daemon connection initialized');
  } catch (err) {
    ctx.logger.error('Failed to initialize daemon connection', {
      error: err instanceof Error ? err.message : String(err),
    });

    // Show user-friendly error notification
    if (err instanceof Error && daemonNotifications) {
      await daemonNotifications.showError(err, {
        viewLogs: () => daemonNotifications?.viewLogs(),
        startDaemon: () => initializeDaemon(context, workspaceRoot),
      });
    }
  }
}

/**
 * Set up event handlers for connection manager events.
 */
function setupConnectionEventHandlers(manager: ConnectionManager): void {
  manager.on('connected', () => {
    // Clear any reconnecting status
    reconnectStatusDisposable?.dispose();
    reconnectStatusDisposable = null;
    statusBar?.setConnected();
  });

  manager.on('disconnected', () => {
    statusBar?.setDisconnected();
    void daemonNotifications?.showConnectionLost({
      retry: () => connectionManager?.connect(),
    });
  });

  manager.on('reconnecting', (attempt: number, maxAttempts: number) => {
    // Show reconnection progress in status bar
    reconnectStatusDisposable?.dispose();
    reconnectStatusDisposable = daemonNotifications?.showReconnecting(attempt, maxAttempts) ?? null;
  });

  manager.on('error', (error: Error) => {
    const ctx = ExtensionContext.get();
    ctx.logger.error('Connection error', {
      error: error.message,
    });

    // Only show notification for fatal errors, not transient ones
    if (error.message.includes('Max reconnection attempts')) {
      void daemonNotifications?.showReconnectionFailed({
        retry: () => connectionManager?.connect(),
      });
    }
  });

  manager.on('versionMismatch', (expected: string, actual: string) => {
    void daemonNotifications?.showVersionMismatch(expected, actual);
  });
}

async function startSession(
  workspaceRoot: string | undefined,
  _branchName?: string
): Promise<void> {
  const ctx = ExtensionContext.get();

  if (!workspaceRoot) {
    await vscode.window.showErrorMessage('Coven: No workspace folder open');
    return;
  }

  if (!connectionManager || !daemonSocketPath) {
    await vscode.window.showErrorMessage('Coven: Daemon not connected');
    return;
  }

  try {
    // Start session via daemon API
    const client = new DaemonClient(daemonSocketPath);
    await client.startSession();
    ctx.logger.info('Session started via daemon');
  } catch (err) {
    ctx.logger.error('Failed to start session', {
      error: err instanceof Error ? err.message : String(err),
    });
    await vscode.window.showErrorMessage(
      `Coven: Failed to start session: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function stopSession(options?: { skipConfirmation?: boolean }): Promise<void> {
  const ctx = ExtensionContext.get();

  if (!connectionManager || !daemonSocketPath) {
    await vscode.window.showInformationMessage('Coven: No active session');
    return;
  }

  if (!options?.skipConfirmation) {
    const confirm = await vscode.window.showWarningMessage(
      'Stop the current Coven session?',
      { modal: true },
      'Stop Session'
    );
    if (confirm !== 'Stop Session') {
      return;
    }
  }

  try {
    const client = new DaemonClient(daemonSocketPath);
    await client.stopSession();
    ctx.logger.info('Session stopped');
  } catch (err) {
    ctx.logger.error('Failed to stop session', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function showSetup(): Promise<void> {
  const ctx = ExtensionContext.get();
  await SetupPanel.createOrShow(ctx.extensionUri);
}

function revealSidebar(): void {
  void vscode.commands.executeCommand('coven.sessions.focus');
}

async function showTaskDetail(arg: unknown): Promise<void> {
  const ctx = ExtensionContext.get();
  const taskId = extractTaskId(arg);

  if (!taskId || !beadsTaskSource) {
    await vscode.window.showErrorMessage('Coven: Invalid task reference');
    return;
  }

  await TaskDetailPanel.createOrShow(ctx.extensionUri, beadsTaskSource, taskId);
}

async function viewFamiliarOutput(arg: unknown): Promise<void> {
  const taskId = extractTaskId(arg);

  if (!taskId || !familiarOutputChannel) {
    await vscode.window.showErrorMessage('Coven: Invalid task reference or no active session');
    return;
  }

  if (!familiarOutputChannel.hasChannel(taskId)) {
    await familiarOutputChannel.fetchHistory(taskId);
  }
  familiarOutputChannel.showChannel(taskId, false);
}

async function createTask(): Promise<void> {
  const title = await vscode.window.showInputBox({
    prompt: 'Enter task title',
    placeHolder: 'Fix login bug',
  });

  if (!title || !beadsTaskSource) {
    return;
  }

  const task = await beadsTaskSource.createTask(title);
  if (task) {
    void vscode.window.showInformationMessage(`Created task: ${task.id}`);
  } else {
    await vscode.window.showErrorMessage('Failed to create task in Beads');
  }
}

function extractTaskId(arg: unknown): string | null {
  if (typeof arg === 'string') {
    return arg;
  }
  if (arg && typeof arg === 'object') {
    const item = arg as { task?: { id?: string }; taskId?: string };
    return item.task?.id || item.taskId || null;
  }
  return null;
}

async function startTask(arg: unknown): Promise<void> {
  const ctx = ExtensionContext.get();
  const taskId = extractTaskId(arg);

  if (!taskId || !connectionManager || !daemonSocketPath) {
    await vscode.window.showErrorMessage('Coven: Invalid task reference or no daemon connection');
    return;
  }

  try {
    const client = new DaemonClient(daemonSocketPath);
    await client.startTask(taskId);
    ctx.logger.info('Task started via daemon', { taskId });
    void vscode.window.showInformationMessage(`Task started: ${taskId}`);
  } catch (err) {
    ctx.logger.error('Failed to start task', {
      taskId,
      error: err instanceof Error ? err.message : String(err),
    });
    await vscode.window.showErrorMessage(
      `Failed to start task: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function stopTask(arg: unknown): Promise<void> {
  const ctx = ExtensionContext.get();
  const taskId = extractTaskId(arg);

  if (!taskId || !connectionManager || !daemonSocketPath) {
    await vscode.window.showErrorMessage('Coven: Invalid task reference');
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    'Stop this task?',
    { modal: true },
    'Stop Task'
  );

  if (confirm !== 'Stop Task') {
    return;
  }

  try {
    const client = new DaemonClient(daemonSocketPath);
    await client.killTask(taskId);
    ctx.logger.info('Task stopped', { taskId });
    void vscode.window.showInformationMessage('Task stopped');
  } catch (err) {
    ctx.logger.error('Failed to stop task', {
      taskId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function respondToQuestion(arg: unknown): Promise<void> {
  const taskId = extractTaskId(arg);

  if (!taskId || !questionHandler) {
    await vscode.window.showErrorMessage('Coven: Invalid task reference');
    return;
  }

  await questionHandler.showAnswerDialogByTaskId(taskId);
}

async function refreshTasks(): Promise<void> {
  if (beadsTaskSource) {
    await beadsTaskSource.sync();
  }
  if (workflowProvider) {
    workflowProvider.refresh();
  }
}

async function reviewTask(arg: unknown): Promise<void> {
  const ctx = ExtensionContext.get();
  const taskId = extractTaskId(arg);

  if (!taskId || !worktreeManager || !beadsTaskSource) {
    await vscode.window.showErrorMessage('Coven: Invalid task reference or not initialized');
    return;
  }

  try {
    ReviewPanel.createOrShow(ctx.extensionUri, taskId);
    ctx.logger.info('Review panel opened for task', { taskId });
  } catch (err) {
    ctx.logger.error('Failed to open review panel', {
      taskId,
      error: err instanceof Error ? err.message : String(err),
    });
    await vscode.window.showErrorMessage(
      `Failed to open review: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Helper to get daemon command dependencies.
 */
function getDaemonDeps(): DaemonCommandDependencies | null {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot || !daemonSocketPath || !daemonLifecycle) {
    return null;
  }
  return {
    client: new DaemonClient(daemonSocketPath),
    lifecycle: daemonLifecycle,
    workspaceRoot,
  };
}

/**
 * Stop daemon command handler.
 */
async function handleStopDaemon(): Promise<void> {
  const deps = getDaemonDeps();
  if (!deps) {
    await vscode.window.showErrorMessage('Coven: Daemon not connected');
    return;
  }
  await stopDaemon(deps);
  statusBar?.setDisconnected();
}

/**
 * Restart daemon command handler.
 */
async function handleRestartDaemon(): Promise<void> {
  const deps = getDaemonDeps();
  if (!deps) {
    await vscode.window.showErrorMessage('Coven: Daemon not connected');
    return;
  }
  await restartDaemon(deps);
}

/**
 * Extract workflow ID from command argument.
 */
function extractWorkflowId(arg: unknown): string | null {
  if (typeof arg === 'string') {
    return arg;
  }
  if (arg && typeof arg === 'object') {
    const item = arg as { workflow?: { id?: string }; workflowId?: string; task?: { id?: string } };
    if (item.workflow?.id) {
      return item.workflow.id;
    }
    if (item.workflowId) {
      return item.workflowId;
    }
    if (item.task?.id) {
      return item.task.id;
    }
  }
  return null;
}

/**
 * Cancel a running workflow.
 */
async function cancelWorkflow(arg: unknown): Promise<void> {
  const ctx = ExtensionContext.get();
  const workflowId = extractWorkflowId(arg);

  if (!workflowId || !daemonSocketPath) {
    await vscode.window.showErrorMessage('Coven: Invalid workflow reference or daemon not connected');
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    'Cancel this workflow? Running agents will be terminated.',
    { modal: true },
    'Cancel Workflow'
  );
  if (confirm !== 'Cancel Workflow') {
    return;
  }

  try {
    const client = new DaemonClient(daemonSocketPath);
    await client.post(`/workflows/${encodeURIComponent(workflowId)}/cancel`, {});
    ctx.logger.info('Workflow cancelled', { workflowId });
    void vscode.window.showInformationMessage('Workflow cancelled');
  } catch (err) {
    ctx.logger.error('Failed to cancel workflow', {
      workflowId,
      error: err instanceof Error ? err.message : String(err),
    });
    await vscode.window.showErrorMessage(
      `Failed to cancel workflow: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Retry a failed or blocked workflow.
 */
async function retryWorkflow(arg: unknown): Promise<void> {
  const ctx = ExtensionContext.get();
  const workflowId = extractWorkflowId(arg);

  if (!workflowId || !daemonSocketPath) {
    await vscode.window.showErrorMessage('Coven: Invalid workflow reference or daemon not connected');
    return;
  }

  try {
    const client = new DaemonClient(daemonSocketPath);
    await client.post(`/workflows/${encodeURIComponent(workflowId)}/retry`, {});
    ctx.logger.info('Workflow retried', { workflowId });
    void vscode.window.showInformationMessage('Workflow restarted');
  } catch (err) {
    ctx.logger.error('Failed to retry workflow', {
      workflowId,
      error: err instanceof Error ? err.message : String(err),
    });
    await vscode.window.showErrorMessage(
      `Failed to retry workflow: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Approve a workflow and merge changes.
 */
async function approveMerge(arg: unknown): Promise<void> {
  if (!daemonSocketPath) {
    await vscode.window.showErrorMessage('Coven: Daemon not connected');
    return;
  }

  const client = new DaemonClient(daemonSocketPath);
  await approveWorkflow(client, arg);
}

/**
 * Reject a workflow and discard changes.
 */
async function rejectMerge(arg: unknown): Promise<void> {
  if (!daemonSocketPath) {
    await vscode.window.showErrorMessage('Coven: Daemon not connected');
    return;
  }

  const client = new DaemonClient(daemonSocketPath);
  await rejectWorkflow(client, arg);
}
