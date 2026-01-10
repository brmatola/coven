import * as vscode from 'vscode';
import { DaemonClient } from '../daemon/client';
import { DaemonClientError } from '../daemon/types';

/**
 * Options for workflow command operations
 */
interface CommandOptions {
  /** Show progress indicator during operation */
  showProgress?: boolean;
  /** Skip confirmation dialog (for programmatic/E2E test usage) */
  skipConfirmation?: boolean;
}

/**
 * Extract task ID from command argument.
 * Commands can receive either a string ID or a tree item with a task property.
 */
function extractId(arg: unknown): string | null {
  if (typeof arg === 'string') {
    return arg;
  }
  if (arg && typeof arg === 'object') {
    // Tree item with task property
    const item = arg as { task?: { id?: string }; id?: string };
    if (item.task?.id) {
      return item.task.id;
    }
    if (item.id) {
      return item.id;
    }
  }
  return null;
}

/**
 * Show a user-friendly error message for daemon errors
 */
function showDaemonError(error: unknown, context: string): void {
  let message: string;

  if (error instanceof DaemonClientError) {
    switch (error.code) {
      case 'connection_refused':
        message = 'Daemon is not running. Please start the coven daemon first.';
        break;
      case 'socket_not_found':
        message = 'Daemon socket not found. Please start the coven daemon first.';
        break;
      case 'task_not_found':
        message = 'Task not found. It may have been deleted.';
        break;
      case 'agent_not_found':
        message = 'No agent is running for this task.';
        break;
      case 'question_not_found':
        message = 'Question not found or already answered.';
        break;
      case 'session_not_active':
        message = 'No active session. Please start a session first.';
        break;
      default:
        message = error.message;
    }
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }

  void vscode.window.showErrorMessage(`${context}: ${message}`);
}

/**
 * Run an async operation with optional progress indicator
 */
async function withProgress<T>(
  title: string,
  showProgress: boolean,
  operation: () => Promise<T>
): Promise<T> {
  if (!showProgress) {
    return operation();
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: false,
    },
    async () => {
      return operation();
    }
  );
}

/**
 * Start a task by spawning an agent
 */
export async function startTask(
  client: DaemonClient,
  arg: unknown,
  options: CommandOptions = {}
): Promise<boolean> {
  const taskId = extractId(arg);
  if (!taskId) {
    void vscode.window.showErrorMessage('Invalid task reference');
    return false;
  }

  try {
    await withProgress('Starting task...', options.showProgress ?? true, async () => {
      await client.startTask(taskId);
    });
    void vscode.window.showInformationMessage('Task started');
    return true;
  } catch (error) {
    showDaemonError(error, 'Failed to start task');
    return false;
  }
}

/**
 * Kill an agent working on a task
 */
export async function killTask(
  client: DaemonClient,
  arg: unknown,
  options: CommandOptions = {}
): Promise<boolean> {
  const taskId = extractId(arg);
  if (!taskId) {
    void vscode.window.showErrorMessage('Invalid task reference');
    return false;
  }

  // Confirm before killing
  if (!options.skipConfirmation) {
    const confirm = await vscode.window.showWarningMessage(
      'Stop this task? The agent will be terminated.',
      { modal: true },
      'Stop Task'
    );
    if (confirm !== 'Stop Task') {
      return false;
    }
  }

  try {
    await withProgress('Stopping task...', options.showProgress ?? true, async () => {
      await client.killTask(taskId, 'user requested');
    });
    void vscode.window.showInformationMessage('Task stopped');
    return true;
  } catch (error) {
    showDaemonError(error, 'Failed to stop task');
    return false;
  }
}

/**
 * Answer a pending question
 */
export async function answerQuestion(
  client: DaemonClient,
  questionId: string,
  answer: string
): Promise<boolean> {
  if (!questionId) {
    void vscode.window.showErrorMessage('Invalid question reference');
    return false;
  }

  if (!answer.trim()) {
    void vscode.window.showErrorMessage('Answer cannot be empty');
    return false;
  }

  try {
    await client.answerQuestion(questionId, answer);
    return true;
  } catch (error) {
    showDaemonError(error, 'Failed to send answer');
    return false;
  }
}

/**
 * Start the daemon session
 */
export async function startSession(
  client: DaemonClient,
  featureBranch?: string,
  options: CommandOptions = {}
): Promise<boolean> {
  try {
    await withProgress('Starting session...', options.showProgress ?? true, async () => {
      await client.startSession(featureBranch ? { featureBranch } : undefined);
    });
    void vscode.window.showInformationMessage('Session started');
    return true;
  } catch (error) {
    showDaemonError(error, 'Failed to start session');
    return false;
  }
}

/**
 * Stop the daemon session
 */
export async function stopSession(
  client: DaemonClient,
  options: CommandOptions = {}
): Promise<boolean> {
  // Confirm before stopping
  if (!options.skipConfirmation) {
    const confirm = await vscode.window.showWarningMessage(
      'Stop the current session? Active agents will be terminated.',
      { modal: true },
      'Stop Session'
    );
    if (confirm !== 'Stop Session') {
      return false;
    }
  }

  try {
    await withProgress('Stopping session...', options.showProgress ?? true, async () => {
      await client.stopSession(false);
    });
    void vscode.window.showInformationMessage('Session stopped');
    return true;
  } catch (error) {
    showDaemonError(error, 'Failed to stop session');
    return false;
  }
}

/**
 * Force stop the daemon session
 */
export async function forceStopSession(
  client: DaemonClient,
  options: CommandOptions = {}
): Promise<boolean> {
  // Confirm before force stopping
  if (!options.skipConfirmation) {
    const confirm = await vscode.window.showWarningMessage(
      'Force stop the session? All agents will be immediately killed and unsaved work may be lost.',
      { modal: true },
      'Force Stop'
    );
    if (confirm !== 'Force Stop') {
      return false;
    }
  }

  try {
    await withProgress('Force stopping session...', options.showProgress ?? true, async () => {
      await client.stopSession(true);
    });
    void vscode.window.showInformationMessage('Session force stopped');
    return true;
  } catch (error) {
    showDaemonError(error, 'Failed to force stop session');
    return false;
  }
}

/**
 * Extract workflow ID from command argument.
 * Handles both string IDs and tree items.
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
    // For task items in completed section, task.id is the workflow ID
    if (item.task?.id) {
      return item.task.id;
    }
  }
  return null;
}

/**
 * Approve a completed workflow and merge changes
 */
export async function approveWorkflow(
  client: DaemonClient,
  arg: unknown,
  options: CommandOptions = {}
): Promise<boolean> {
  const workflowId = extractWorkflowId(arg);
  if (!workflowId) {
    void vscode.window.showErrorMessage('Invalid workflow reference');
    return false;
  }

  // Confirm before approving
  if (!options.skipConfirmation) {
    const confirm = await vscode.window.showInformationMessage(
      'Approve this workflow and merge changes?',
      { modal: true },
      'Approve'
    );
    if (confirm !== 'Approve') {
      return false;
    }
  }

  try {
    await withProgress('Approving workflow...', options.showProgress ?? true, async () => {
      await client.approveWorkflow(workflowId);
    });
    void vscode.window.showInformationMessage('Workflow approved and changes merged');
    return true;
  } catch (error) {
    showDaemonError(error, 'Failed to approve workflow');
    return false;
  }
}

/**
 * Reject a workflow and discard changes
 */
export async function rejectWorkflow(
  client: DaemonClient,
  arg: unknown,
  options: CommandOptions = {}
): Promise<boolean> {
  const workflowId = extractWorkflowId(arg);
  if (!workflowId) {
    void vscode.window.showErrorMessage('Invalid workflow reference');
    return false;
  }

  // Confirm before rejecting
  if (!options.skipConfirmation) {
    const confirm = await vscode.window.showWarningMessage(
      'Reject this workflow? All changes will be discarded.',
      { modal: true },
      'Reject'
    );
    if (confirm !== 'Reject') {
      return false;
    }
  }

  try {
    await withProgress('Rejecting workflow...', options.showProgress ?? true, async () => {
      await client.rejectWorkflow(workflowId);
    });
    void vscode.window.showInformationMessage('Workflow rejected and changes discarded');
    return true;
  } catch (error) {
    showDaemonError(error, 'Failed to reject workflow');
    return false;
  }
}

/**
 * Retry a failed or blocked task by restarting it
 */
export async function retryTask(
  client: DaemonClient,
  arg: unknown,
  options: CommandOptions = {}
): Promise<boolean> {
  const taskId = extractId(arg);
  if (!taskId) {
    void vscode.window.showErrorMessage('Invalid task reference');
    return false;
  }

  try {
    await withProgress('Retrying task...', options.showProgress ?? true, async () => {
      await client.startTask(taskId);
    });
    void vscode.window.showInformationMessage('Task restarted');
    return true;
  } catch (error) {
    showDaemonError(error, 'Failed to retry task');
    return false;
  }
}

/**
 * Show answer dialog for a question
 */
export async function showAnswerDialog(
  client: DaemonClient,
  arg: unknown
): Promise<boolean> {
  // Extract question from argument
  let questionId: string | null = null;
  let questionText = 'Enter your answer:';
  let questionOptions: string[] | undefined;

  if (typeof arg === 'string') {
    questionId = arg;
  } else if (arg && typeof arg === 'object') {
    const item = arg as {
      question?: { id?: string; text?: string; options?: string[] };
      id?: string;
    };
    if (item.question) {
      questionId = item.question.id ?? null;
      questionText = item.question.text ?? questionText;
      questionOptions = item.question.options;
    } else if (item.id) {
      questionId = item.id;
    }
  }

  if (!questionId) {
    void vscode.window.showErrorMessage('Invalid question reference');
    return false;
  }

  let answer: string | undefined;

  // If question has options, show quick pick
  if (questionOptions && questionOptions.length > 0) {
    answer = await vscode.window.showQuickPick(questionOptions, {
      placeHolder: questionText,
      title: 'Answer Question',
    });
  } else {
    // Free-form input
    answer = await vscode.window.showInputBox({
      prompt: questionText,
      placeHolder: 'Enter your answer...',
      title: 'Answer Question',
    });
  }

  if (answer === undefined) {
    // User cancelled
    return false;
  }

  return answerQuestion(client, questionId, answer);
}

/**
 * Register all workflow commands
 */
export function registerWorkflowCommands(
  context: vscode.ExtensionContext,
  client: DaemonClient
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('coven.daemon.startTask', (arg: unknown) =>
      startTask(client, arg)
    ),
    vscode.commands.registerCommand('coven.daemon.killTask', (arg: unknown) =>
      killTask(client, arg)
    ),
    vscode.commands.registerCommand(
      'coven.daemon.answerQuestion',
      (questionId: string, answer: string) => answerQuestion(client, questionId, answer)
    ),
    vscode.commands.registerCommand('coven.daemon.showAnswerDialog', (arg: unknown) =>
      showAnswerDialog(client, arg)
    ),
    vscode.commands.registerCommand('coven.daemon.approveWorkflow', (arg: unknown) =>
      approveWorkflow(client, arg)
    ),
    vscode.commands.registerCommand('coven.daemon.rejectWorkflow', (arg: unknown) =>
      rejectWorkflow(client, arg)
    ),
    vscode.commands.registerCommand('coven.daemon.retryTask', (arg: unknown) =>
      retryTask(client, arg)
    ),
    vscode.commands.registerCommand('coven.daemon.startSession', (featureBranch?: string) =>
      startSession(client, featureBranch)
    ),
    vscode.commands.registerCommand('coven.daemon.stopSession', () => stopSession(client)),
    vscode.commands.registerCommand('coven.daemon.forceStopSession', () =>
      forceStopSession(client)
    )
  );
}
