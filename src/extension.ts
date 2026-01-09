import * as vscode from 'vscode';
import { CovenSession } from './session/CovenSession';
import { GrimoireTreeProvider } from './sidebar/GrimoireTreeProvider';
import { CovenStatusBar } from './sidebar/CovenStatusBar';
import { checkPrerequisites } from './setup/prerequisites';
import { SetupPanel } from './setup/SetupPanel';
import { TaskDetailPanel } from './tasks/TaskDetailPanel';
import { ReviewPanel } from './review/ReviewPanel';
import { ReviewManager } from './review/ReviewManager';
import { ExtensionContext } from './shared/extensionContext';
import { FamiliarOutputChannel } from './agents/FamiliarOutputChannel';
import { QuestionHandler } from './agents/QuestionHandler';
import { NotificationService } from './shared/notifications';
import { AgentResult } from './agents/types';
import { SessionEvents } from './shared/types';

let grimoireProvider: GrimoireTreeProvider;
let statusBar: CovenStatusBar;
let covenSession: CovenSession | null = null;
let familiarOutputChannel: FamiliarOutputChannel | null = null;
let questionHandler: QuestionHandler | null = null;
let notificationService: NotificationService | null = null;
let reviewManager: ReviewManager | null = null;
let treeView: vscode.TreeView<unknown>;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const ctx = ExtensionContext.initialize(context);
  ctx.logger.info('Coven extension activating');

  // Get workspace root
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // Initialize status bar
  statusBar = new CovenStatusBar();
  ctx.statusBarItem = statusBar.getStatusBarItem();
  ctx.subscriptions.push(statusBar);

  // Initialize sidebar tree view
  grimoireProvider = new GrimoireTreeProvider(context);
  treeView = vscode.window.createTreeView('coven.sessions', {
    treeDataProvider: grimoireProvider,
    showCollapseAll: true,
  });
  ctx.subscriptions.push(treeView);
  ctx.subscriptions.push({ dispose: () => grimoireProvider.dispose() });

  // Register commands
  ctx.subscriptions.push(
    vscode.commands.registerCommand('coven.startSession', () => startSession(workspaceRoot)),
    vscode.commands.registerCommand('coven.stopSession', stopSession),
    vscode.commands.registerCommand('coven.showSetup', showSetup),
    vscode.commands.registerCommand('coven.revealSidebar', revealSidebar),
    vscode.commands.registerCommand('coven.showTaskDetail', showTaskDetail),
    vscode.commands.registerCommand('coven.viewFamiliarOutput', viewFamiliarOutput),
    vscode.commands.registerCommand('coven.createTask', createTask),
    vscode.commands.registerCommand('coven.startTask', startTask),
    vscode.commands.registerCommand('coven.stopTask', stopTask),
    vscode.commands.registerCommand('coven.refreshTasks', refreshTasks),
    vscode.commands.registerCommand('coven.respondToQuestion', respondToQuestion),
    vscode.commands.registerCommand('coven.reviewTask', reviewTask)
  );

  // Initialize session if workspace is available
  if (workspaceRoot) {
    await initializeSession(workspaceRoot);
  }

  // Check prerequisites and show setup panel if needed
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
    await vscode.window.showErrorMessage(
      `Coven: Failed to check prerequisites: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  ctx.logger.info('Coven extension activated');
}

export function deactivate(): void {
  if (reviewManager) {
    reviewManager.dispose();
    reviewManager = null;
  }
  if (familiarOutputChannel) {
    familiarOutputChannel.dispose();
    familiarOutputChannel = null;
  }
  if (covenSession) {
    covenSession.dispose();
    covenSession = null;
  }
  if (ExtensionContext.isInitialized()) {
    ExtensionContext.get().logger.info('Coven extension deactivating');
    ExtensionContext.dispose();
  }
}

/**
 * Initialize the CovenSession and connect it to UI components.
 */
async function initializeSession(workspaceRoot: string): Promise<void> {
  const ctx = ExtensionContext.get();

  try {
    covenSession = new CovenSession(workspaceRoot);
    await covenSession.initialize();

    // Initialize output channel manager for familiars
    familiarOutputChannel = new FamiliarOutputChannel(
      covenSession.getFamiliarManager(),
      workspaceRoot
    );
    await familiarOutputChannel.initialize();

    // Initialize notification service
    notificationService = new NotificationService(() => covenSession!.getConfig());

    // Initialize question handler
    questionHandler = new QuestionHandler(
      covenSession.getFamiliarManager(),
      covenSession.getAgentOrchestrator()
    );

    // Initialize review manager
    reviewManager = new ReviewManager(
      workspaceRoot,
      covenSession.getWorktreeManager(),
      covenSession.getBeadsTaskSource(),
      covenSession.getFamiliarManager(),
      () => covenSession!.getConfig()
    );

    // Wire up session event handlers for notifications
    setupSessionEventHandlers(covenSession);

    // Connect session to UI components
    grimoireProvider.setSession(covenSession);
    statusBar.setSession(covenSession);

    ctx.logger.info('CovenSession initialized', {
      status: covenSession.getStatus(),
      featureBranch: covenSession.getFeatureBranch(),
    });
  } catch (err) {
    ctx.logger.error('Failed to initialize CovenSession', {
      error: err instanceof Error ? err.message : String(err),
    });
    // Continue without session - user can start one manually
  }
}

/**
 * Set up event handlers for session events (notifications, questions).
 */
function setupSessionEventHandlers(session: CovenSession): void {
  // Handle agent questions - show notification
  session.on('familiar:question', (event: SessionEvents['familiar:question']) => {
    if (!notificationService) return;

    const { question } = event;
    void notificationService.notifyQuestion(question.taskId, question.question, () => {
      void vscode.commands.executeCommand('coven.respondToQuestion', question.taskId);
    });
  });

  // Handle agent completion - show notification
  session.on('agent:complete', (event: { taskId: string; result: AgentResult }) => {
    if (!notificationService || !covenSession) return;

    const tasks = covenSession.getState().tasks;
    const allTasks = [
      ...tasks.ready,
      ...tasks.working,
      ...tasks.review,
      ...tasks.done,
      ...tasks.blocked,
    ];
    const task = allTasks.find((t) => t.id === event.taskId);
    const taskTitle = task?.title || event.taskId;

    if (event.result.success) {
      void notificationService.notifyCompletion(event.taskId, taskTitle, () => {
        void vscode.commands.executeCommand('coven.showTaskDetail', event.taskId);
      });
    } else {
      void notificationService.notifyError(
        event.taskId,
        event.result.summary || 'Agent failed to complete the task'
      );
    }
  });

  // Handle agent errors
  session.on('agent:error', (event: { taskId: string; error: Error }) => {
    if (!notificationService) return;
    void notificationService.notifyError(event.taskId, event.error.message);
  });
}

async function startSession(workspaceRoot: string | undefined): Promise<void> {
  const ctx = ExtensionContext.get();

  if (!workspaceRoot) {
    await vscode.window.showErrorMessage('Coven: No workspace folder open');
    return;
  }

  let prereqs;
  try {
    prereqs = await checkPrerequisites();
  } catch (err) {
    await vscode.window.showErrorMessage(
      `Coven: Failed to check prerequisites: ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }

  if (!prereqs.allMet) {
    await vscode.window.showWarningMessage(
      'Coven: Prerequisites not met. Please complete setup first.'
    );
    await SetupPanel.createOrShow(ctx.extensionUri);
    return;
  }

  // Prompt for feature branch name
  const branchName = await vscode.window.showInputBox({
    prompt: 'Enter feature branch name',
    placeHolder: 'feature/my-feature',
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Branch name is required';
      }
      if (!/^[\w\-/]+$/.test(value)) {
        return 'Branch name contains invalid characters';
      }
      return undefined;
    },
  });

  if (!branchName) {
    return; // User cancelled
  }

  try {
    // Initialize session if not already done
    if (!covenSession) {
      await initializeSession(workspaceRoot);
    }

    if (covenSession) {
      await covenSession.start(branchName);
      ctx.logger.info('Session started', { branchName });
    }
  } catch (err) {
    ctx.logger.error('Failed to start session', {
      error: err instanceof Error ? err.message : String(err),
    });
    await vscode.window.showErrorMessage(
      `Coven: Failed to start session: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function stopSession(): Promise<void> {
  const ctx = ExtensionContext.get();

  if (!covenSession || covenSession.getStatus() === 'inactive') {
    await vscode.window.showInformationMessage('Coven: No active session to stop');
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    'Stop the current Coven session? Active agents will be terminated.',
    { modal: true },
    'Stop Session'
  );

  if (confirm !== 'Stop Session') {
    return;
  }

  try {
    await covenSession.stop();
    ctx.logger.info('Session stopped');
  } catch (err) {
    ctx.logger.error('Failed to stop session', {
      error: err instanceof Error ? err.message : String(err),
    });
    await vscode.window.showErrorMessage(
      `Coven: Failed to stop session: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function showSetup(): Promise<void> {
  const ctx = ExtensionContext.get();
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  await SetupPanel.createOrShow(ctx.extensionUri, workspaceRoot, handleSessionBegin);
}

async function handleSessionBegin(
  branchName: string,
  config: { maxConcurrentAgents: number; worktreeBasePath: string; autoApprove: boolean }
): Promise<void> {
  const ctx = ExtensionContext.get();
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (!workspaceRoot) {
    await vscode.window.showErrorMessage('Coven: No workspace folder open');
    return;
  }

  try {
    // Initialize session if not already done
    if (!covenSession) {
      await initializeSession(workspaceRoot);
    }

    if (covenSession) {
      // Apply config to session before starting
      await covenSession.updateConfig({
        maxConcurrentAgents: config.maxConcurrentAgents,
        worktreeBasePath: config.worktreeBasePath,
      });

      await covenSession.start(branchName);
      ctx.logger.info('Session started from setup panel', { branchName, config });
    }
  } catch (err) {
    ctx.logger.error('Failed to start session from setup', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

function revealSidebar(): void {
  void vscode.commands.executeCommand('coven.sessions.focus');
}

async function showTaskDetail(arg: unknown): Promise<void> {
  const ctx = ExtensionContext.get();
  const taskId = extractTaskId(arg);

  if (!taskId) {
    await vscode.window.showErrorMessage('Coven: Invalid task reference');
    return;
  }

  if (!covenSession) {
    await vscode.window.showErrorMessage('Coven: No active session');
    return;
  }

  const beadsTaskSource = covenSession.getBeadsTaskSource();
  await TaskDetailPanel.createOrShow(ctx.extensionUri, beadsTaskSource, taskId);
}

async function viewFamiliarOutput(arg: unknown): Promise<void> {
  const taskId = extractTaskId(arg);

  if (!taskId) {
    await vscode.window.showErrorMessage('Coven: Invalid task reference');
    return;
  }

  if (!familiarOutputChannel) {
    await vscode.window.showErrorMessage('Coven: No active session');
    return;
  }

  // Load persisted output if channel doesn't exist yet
  if (!familiarOutputChannel.hasChannel(taskId)) {
    await familiarOutputChannel.loadPersistedOutput(taskId);
  }

  // Show the output channel
  familiarOutputChannel.showChannel(taskId, false);
}

async function createTask(): Promise<void> {
  // Create task via Beads
  const title = await vscode.window.showInputBox({
    prompt: 'Enter task title',
    placeHolder: 'Fix login bug',
  });

  if (!title) {
    return;
  }

  if (!covenSession) {
    await vscode.window.showErrorMessage('Coven: No active session');
    return;
  }

  const beadsTaskSource = covenSession.getBeadsTaskSource();
  const task = await beadsTaskSource.createTask(title);
  if (task) {
    void vscode.window.showInformationMessage(`Created task: ${task.id}`);
  } else {
    await vscode.window.showErrorMessage('Failed to create task in Beads');
  }
}

/**
 * Extract task ID from command argument.
 * Commands can receive either a string ID or a tree item with a task property.
 */
function extractTaskId(arg: unknown): string | null {
  if (typeof arg === 'string') {
    return arg;
  }
  if (arg && typeof arg === 'object') {
    // Tree item with task property (TaskItem)
    const item = arg as { task?: { id?: string } };
    if (item.task?.id) {
      return item.task.id;
    }
    // Tree item with familiar property (FamiliarItem)
    const familiarItem = arg as { familiar?: { taskId?: string } };
    if (familiarItem.familiar?.taskId) {
      return familiarItem.familiar.taskId;
    }
  }
  return null;
}

async function startTask(arg: unknown): Promise<void> {
  const ctx = ExtensionContext.get();
  const taskId = extractTaskId(arg);

  if (!taskId) {
    await vscode.window.showErrorMessage('Coven: Invalid task reference');
    return;
  }

  if (!covenSession) {
    await vscode.window.showErrorMessage('Coven: No active session');
    return;
  }

  if (!covenSession.isActive()) {
    await vscode.window.showErrorMessage('Coven: Session not active. Start a session first.');
    return;
  }

  try {
    // Check if Claude is available
    const agentAvailable = await covenSession.isAgentAvailable();
    if (!agentAvailable) {
      await vscode.window.showErrorMessage(
        'Coven: Claude CLI not found. Please install claude-code: npm install -g @anthropic-ai/claude-code'
      );
      return;
    }

    const beadsTaskSource = covenSession.getBeadsTaskSource();

    // Find task - first check cache, then try to fetch directly
    let task = beadsTaskSource.getTask(taskId);
    if (!task) {
      // Task not in cache, try to fetch it directly from Beads
      ctx.logger.info('Task not in cache, fetching from Beads', { taskId });
      task = await beadsTaskSource.fetchTask(taskId);
    }
    if (!task) {
      await vscode.window.showErrorMessage(`Task not found: ${taskId}`);
      return;
    }

    if (familiarOutputChannel) {
      familiarOutputChannel.setTaskTitle(taskId, task.title);
    }

    // Update task status to working
    await beadsTaskSource.updateTaskStatus(taskId, 'working');

    // Spawn the agent
    await covenSession.spawnAgentForTask(taskId);

    ctx.logger.info('Agent spawned for task', { taskId, taskTitle: task.title });
    void vscode.window.showInformationMessage(`Agent started working on: ${task.title}`);
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

  if (!taskId) {
    await vscode.window.showErrorMessage('Coven: Invalid task reference');
    return;
  }

  if (!covenSession) {
    await vscode.window.showErrorMessage('Coven: No active session');
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    'Stop this task? The agent will be terminated.',
    { modal: true },
    'Stop Task'
  );

  if (confirm !== 'Stop Task') {
    return;
  }

  try {
    // Terminate the agent first
    await covenSession.terminateAgent(taskId, 'user requested');

    // Update task status back to ready
    const beadsTaskSource = covenSession.getBeadsTaskSource();
    await beadsTaskSource.updateTaskStatus(taskId, 'ready');

    ctx.logger.info('Task stopped', { taskId });
    void vscode.window.showInformationMessage('Task stopped');
  } catch (err) {
    ctx.logger.error('Failed to stop task', {
      taskId,
      error: err instanceof Error ? err.message : String(err),
    });
    await vscode.window.showErrorMessage(
      `Failed to stop task: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function respondToQuestion(arg: unknown): Promise<void> {
  const taskId = extractTaskId(arg);

  if (!taskId) {
    await vscode.window.showErrorMessage('Coven: Invalid task reference');
    return;
  }

  if (!questionHandler) {
    await vscode.window.showErrorMessage('Coven: No active session');
    return;
  }

  await questionHandler.handleQuestionByTaskId(taskId);
}

async function refreshTasks(): Promise<void> {
  if (covenSession) {
    await covenSession.refreshTasks();
  }
  grimoireProvider.refresh();
}

async function reviewTask(arg: unknown): Promise<void> {
  const ctx = ExtensionContext.get();
  const taskId = extractTaskId(arg);

  if (!taskId) {
    await vscode.window.showErrorMessage('Coven: Invalid task reference');
    return;
  }

  if (!covenSession) {
    await vscode.window.showErrorMessage('Coven: No active session');
    return;
  }

  if (!reviewManager) {
    await vscode.window.showErrorMessage('Coven: Review manager not initialized');
    return;
  }

  try {
    const beadsTaskSource = covenSession.getBeadsTaskSource();
    const worktreeManager = covenSession.getWorktreeManager();
    const familiarManager = covenSession.getFamiliarManager();

    await ReviewPanel.createOrShow(
      ctx.extensionUri,
      reviewManager,
      worktreeManager,
      beadsTaskSource,
      familiarManager,
      taskId
    );

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
