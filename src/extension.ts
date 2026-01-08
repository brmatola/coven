import * as vscode from 'vscode';
import { CovenSession } from './session/CovenSession';
import { GrimoireTreeProvider } from './sidebar/GrimoireTreeProvider';
import { CovenStatusBar } from './sidebar/CovenStatusBar';
import { checkPrerequisites } from './setup/prerequisites';
import { SetupPanel } from './setup/SetupPanel';
import { TaskDetailPanel } from './tasks/TaskDetailPanel';
import { ExtensionContext } from './shared/extensionContext';
import { FamiliarOutputChannel } from './agents/FamiliarOutputChannel';

let grimoireProvider: GrimoireTreeProvider;
let statusBar: CovenStatusBar;
let covenSession: CovenSession | null = null;
let familiarOutputChannel: FamiliarOutputChannel | null = null;
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
    vscode.commands.registerCommand('coven.refreshTasks', refreshTasks)
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

async function showTaskDetail(taskId: string): Promise<void> {
  const ctx = ExtensionContext.get();

  if (!covenSession) {
    await vscode.window.showErrorMessage('Coven: No active session');
    return;
  }

  const beadsTaskSource = covenSession.getBeadsTaskSource();
  await TaskDetailPanel.createOrShow(ctx.extensionUri, beadsTaskSource, taskId);
}

async function viewFamiliarOutput(taskId: string): Promise<void> {
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

async function startTask(taskId: string): Promise<void> {
  if (!covenSession) {
    await vscode.window.showErrorMessage('Coven: No active session');
    return;
  }

  try {
    const beadsTaskSource = covenSession.getBeadsTaskSource();

    // Find task to get title for output channel naming
    const tasks = await beadsTaskSource.fetchTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (familiarOutputChannel && task) {
      familiarOutputChannel.setTaskTitle(taskId, task.title);
    }

    await beadsTaskSource.updateTaskStatus(taskId, 'working');
    // TODO: Wire agent spawning via AgentOrchestrator
    void vscode.window.showInformationMessage(`Started task: ${taskId} (agent spawning not yet wired)`);
  } catch (err) {
    await vscode.window.showErrorMessage(
      `Failed to start task: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function stopTask(taskId: string): Promise<void> {
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
    const beadsTaskSource = covenSession.getBeadsTaskSource();
    await beadsTaskSource.updateTaskStatus(taskId, 'ready');
    // TODO: Wire agent termination via AgentOrchestrator
  } catch (err) {
    await vscode.window.showErrorMessage(
      `Failed to stop task: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function refreshTasks(): Promise<void> {
  if (covenSession) {
    await covenSession.refreshTasks();
  }
  grimoireProvider.refresh();
}
