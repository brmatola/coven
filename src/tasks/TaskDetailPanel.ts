import * as vscode from 'vscode';
import { WebviewPanel } from '../shared/webview/WebviewPanel';
import { MessageRouter } from '../shared/messageRouter';
import { getLogger } from '../shared/logger';
import { BeadsTaskSource } from './BeadsTaskSource';
import {
  TaskDetailState,
  TaskDetailMessageToExtension,
  TaskUpdate,
  BlockingTaskInfo,
} from './types';
import { Task } from '../shared/types';

/**
 * Panel for viewing and editing task details.
 * Opens a React webview with task information that users can modify.
 */
export class TaskDetailPanel extends WebviewPanel<TaskDetailState, TaskDetailMessageToExtension> {
  private static panels = new Map<string, TaskDetailPanel>();

  private readonly router: MessageRouter<TaskDetailMessageToExtension>;
  private readonly beadsTaskSource: BeadsTaskSource;
  private readonly taskId: string;
  private taskChangeListener: (() => void) | null = null;

  /**
   * Create or reveal a task detail panel for the given task.
   */
  public static async createOrShow(
    extensionUri: vscode.Uri,
    beadsTaskSource: BeadsTaskSource,
    taskId: string
  ): Promise<TaskDetailPanel | null> {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    // Check if panel already exists for this task
    const existing = TaskDetailPanel.panels.get(taskId);
    if (existing) {
      existing.reveal(column);
      return existing;
    }

    // Verify task exists
    const task = beadsTaskSource.getTask(taskId);
    if (!task) {
      await vscode.window.showErrorMessage(`Task not found: ${taskId}`);
      return null;
    }

    const panel = vscode.window.createWebviewPanel(
      'covenTaskDetail',
      `Task: ${task.title.substring(0, 30)}${task.title.length > 30 ? '...' : ''}`,
      column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webviews')],
        retainContextWhenHidden: true,
      }
    );

    const detailPanel = new TaskDetailPanel(panel, extensionUri, beadsTaskSource, taskId);
    TaskDetailPanel.panels.set(taskId, detailPanel);
    return detailPanel;
  }

  /**
   * Get an existing panel for a task if one exists.
   */
  public static get(taskId: string): TaskDetailPanel | undefined {
    return TaskDetailPanel.panels.get(taskId);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    beadsTaskSource: BeadsTaskSource,
    taskId: string
  ) {
    super(panel, extensionUri);
    this.beadsTaskSource = beadsTaskSource;
    this.taskId = taskId;

    this.router = new MessageRouter<TaskDetailMessageToExtension>()
      .on('ready', () => this.handleReady())
      .on('save', (msg) => this.handleSave(msg.payload))
      .on('startTask', () => this.handleStartTask())
      .on('deleteTask', () => this.handleDeleteTask());

    // Listen for task changes
    this.setupTaskChangeListener();
  }

  protected getWebviewName(): string {
    return 'tasks';
  }

  protected async onMessage(message: TaskDetailMessageToExtension): Promise<void> {
    const handled = await this.router.route(message);
    if (!handled) {
      getLogger().warn('Unhandled message type in TaskDetailPanel', { type: message.type });
    }
  }

  public override dispose(): void {
    TaskDetailPanel.panels.delete(this.taskId);
    if (this.taskChangeListener) {
      this.taskChangeListener();
    }
    super.dispose();
  }

  private setupTaskChangeListener(): void {
    const handler = (): void => {
      void this.sendState();
    };
    this.beadsTaskSource.on('sync', handler);
    this.taskChangeListener = (): void => {
      this.beadsTaskSource.off('sync', handler);
    };
  }

  private handleReady(): void {
    this.sendState();
  }

  private sendState(): void {
    const task = this.beadsTaskSource.getTask(this.taskId);
    const blockingTasks = this.getBlockingTasks(task);

    const state: TaskDetailState = {
      task: task ?? null,
      isLoading: false,
      isSaving: false,
      error: task ? null : 'Task not found',
      canStart: task?.status === 'ready',
      canDelete: task?.status === 'ready' || task?.status === 'blocked',
      blockingTasks,
    };

    this.updateState(state);

    // Update panel title if task exists
    if (task) {
      this.panel.title = `Task: ${task.title.substring(0, 30)}${task.title.length > 30 ? '...' : ''}`;
    }
  }

  private getBlockingTasks(task: Task | undefined): BlockingTaskInfo[] {
    if (!task || task.dependencies.length === 0) {
      return [];
    }

    const blockingTasks: BlockingTaskInfo[] = [];
    for (const depId of task.dependencies) {
      const depTask = this.beadsTaskSource.getTask(depId);
      if (depTask) {
        blockingTasks.push({
          id: depTask.id,
          title: depTask.title,
          status: depTask.status,
        });
      }
    }
    return blockingTasks;
  }

  private async handleSave(update: TaskUpdate): Promise<void> {
    // Send saving state
    const currentTask = this.beadsTaskSource.getTask(this.taskId);
    this.updateState({
      task: currentTask ?? null,
      isLoading: false,
      isSaving: true,
      error: null,
      canStart: currentTask?.status === 'ready',
      canDelete: currentTask?.status === 'ready' || currentTask?.status === 'blocked',
      blockingTasks: this.getBlockingTasks(currentTask),
    });

    try {
      const success = await this.beadsTaskSource.updateTask(this.taskId, update);

      if (!success) {
        const task = this.beadsTaskSource.getTask(this.taskId);
        this.updateState({
          task: task ?? null,
          isLoading: false,
          isSaving: false,
          error: 'Failed to save changes',
          canStart: task?.status === 'ready',
          canDelete: task?.status === 'ready' || task?.status === 'blocked',
          blockingTasks: this.getBlockingTasks(task),
        });
        return;
      }

      this.sendState();
    } catch (err) {
      getLogger().error('Failed to save task', { taskId: this.taskId, error: String(err) });
      const task = this.beadsTaskSource.getTask(this.taskId);
      this.updateState({
        task: task ?? null,
        isLoading: false,
        isSaving: false,
        error: `Failed to save: ${err instanceof Error ? err.message : String(err)}`,
        canStart: task?.status === 'ready',
        canDelete: task?.status === 'ready' || task?.status === 'blocked',
        blockingTasks: this.getBlockingTasks(task),
      });
    }
  }

  private async handleStartTask(): Promise<void> {
    const task = this.beadsTaskSource.getTask(this.taskId);
    if (!task || task.status !== 'ready') {
      await vscode.window.showWarningMessage('Task cannot be started');
      return;
    }

    try {
      await this.beadsTaskSource.updateTaskStatus(this.taskId, 'working');
      this.sendState();
      void vscode.window.showInformationMessage(`Started task: ${task.title}`);
    } catch (err) {
      await vscode.window.showErrorMessage(
        `Failed to start task: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async handleDeleteTask(): Promise<void> {
    const task = this.beadsTaskSource.getTask(this.taskId);
    if (!task) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Delete task "${task.title}"?`,
      { modal: true },
      'Delete'
    );

    if (confirm !== 'Delete') {
      return;
    }

    try {
      // Close the task in Beads with a reason
      const success = await this.beadsTaskSource.closeTask(this.taskId, 'Deleted from Coven');
      if (success) {
        void vscode.window.showInformationMessage(`Deleted task: ${task.title}`);
        this.dispose();
      } else {
        await vscode.window.showErrorMessage('Failed to delete task');
      }
    } catch (err) {
      await vscode.window.showErrorMessage(
        `Failed to delete task: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
