import * as vscode from 'vscode';
import { CovenSession } from '../session/CovenSession';
import { CovenState, Task, TaskStatus, Familiar, FamiliarStatus } from '../shared/types';

/**
 * Tree item types for type-safe context handling.
 */
export type TreeItemType =
  | 'sessionHeader'
  | 'taskGroup'
  | 'task'
  | 'familiar'
  | 'emptyState'
  | 'noSession';

/**
 * Base interface for all grimoire tree items.
 */
export interface GrimoireTreeItemData {
  type: TreeItemType;
}

/**
 * Main TreeDataProvider for the Coven sidebar.
 * Displays session state including tasks grouped by status and active familiars.
 */
export class GrimoireTreeProvider implements vscode.TreeDataProvider<GrimoireTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<GrimoireTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private session: CovenSession | null = null;
  private expandedGroups: Set<TaskStatus> = new Set(['ready', 'working', 'review']);
  private stateSubscription: (() => void) | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {
    // Load persisted expand/collapse state
    const saved = context.workspaceState.get<TaskStatus[]>('grimoire.expandedGroups');
    if (saved) {
      this.expandedGroups = new Set(saved);
    }
  }

  /**
   * Connect to a CovenSession and subscribe to state changes.
   */
  setSession(session: CovenSession | null): void {
    // Unsubscribe from previous session
    if (this.stateSubscription) {
      this.stateSubscription();
      this.stateSubscription = null;
    }

    this.session = session;

    if (session) {
      const handler = (): void => {
        this.refresh();
      };
      session.on('state:changed', handler);
      this.stateSubscription = (): void => {
        session.off('state:changed', handler);
      };
    }

    this.refresh();
  }

  /**
   * Refresh the tree view.
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Get the tree item representation for display.
   */
  getTreeItem(element: GrimoireTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Get children for a tree element.
   */
  getChildren(element?: GrimoireTreeItem): vscode.ProviderResult<GrimoireTreeItem[]> {
    // Root level
    if (!element) {
      return this.getRootChildren();
    }

    // Children of specific items
    if (element instanceof TaskGroupItem) {
      return this.getTaskGroupChildren(element);
    }

    if (element instanceof TaskItem && element.task.status === 'working') {
      return this.getFamiliarChildren(element.task.id);
    }

    return [];
  }

  /**
   * Get parent of an element (for reveal functionality).
   */
  getParent(element: GrimoireTreeItem): vscode.ProviderResult<GrimoireTreeItem> {
    if (element instanceof TaskItem) {
      // Parent is the task group for this status
      return new TaskGroupItem(element.task.status, [], this.expandedGroups.has(element.task.status));
    }
    if (element instanceof FamiliarItem) {
      // Parent is the task
      const state = this.session?.getState();
      if (state) {
        const task = state.tasks.working.find((t) => t.id === element.familiar.taskId);
        if (task) {
          return new TaskItem(task, this.hasFamiliar(task.id));
        }
      }
    }
    return undefined;
  }

  /**
   * Toggle expand/collapse state for a group.
   */
  toggleGroupExpanded(status: TaskStatus): void {
    if (this.expandedGroups.has(status)) {
      this.expandedGroups.delete(status);
    } else {
      this.expandedGroups.add(status);
    }
    // Persist state
    void this.context.workspaceState.update('grimoire.expandedGroups', Array.from(this.expandedGroups));
    this.refresh();
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    if (this.stateSubscription) {
      this.stateSubscription();
    }
    this._onDidChangeTreeData.dispose();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private getRootChildren(): GrimoireTreeItem[] {
    if (!this.session) {
      return [new NoSessionItem()];
    }

    const state = this.session.getState();

    if (state.sessionStatus === 'inactive') {
      return [new NoSessionItem()];
    }

    const items: GrimoireTreeItem[] = [];

    // Session header
    items.push(new SessionHeaderItem(state));

    // Task groups (only show non-empty groups, except Ready which always shows)
    const groups: TaskStatus[] = ['ready', 'working', 'review', 'blocked', 'done'];
    for (const status of groups) {
      const tasks = state.tasks[status];
      if (tasks.length > 0 || status === 'ready') {
        items.push(new TaskGroupItem(status, tasks, this.expandedGroups.has(status)));
      }
    }

    // Show empty state if no tasks at all
    const totalTasks = Object.values(state.tasks).reduce((sum, arr) => sum + arr.length, 0);
    if (totalTasks === 0) {
      items.push(new EmptyStateItem());
    }

    return items;
  }

  private getTaskGroupChildren(group: TaskGroupItem): GrimoireTreeItem[] {
    if (!this.session) return [];

    const state = this.session.getState();
    const tasks = state.tasks[group.status];

    return tasks.map((task) => new TaskItem(task, this.hasFamiliar(task.id)));
  }

  private getFamiliarChildren(taskId: string): GrimoireTreeItem[] {
    if (!this.session) return [];

    const state = this.session.getState();
    const familiar = state.familiars.find((f) => f.taskId === taskId);

    if (familiar) {
      const question = state.pendingQuestions.find((q) => q.familiarId === taskId);
      return [new FamiliarItem(familiar, question !== undefined)];
    }

    return [];
  }

  private hasFamiliar(taskId: string): boolean {
    if (!this.session) return false;
    const state = this.session.getState();
    return state.familiars.some((f) => f.taskId === taskId);
  }
}

/**
 * Base class for all tree items in the grimoire.
 */
export abstract class GrimoireTreeItem extends vscode.TreeItem {
  abstract readonly itemType: TreeItemType;
}

/**
 * Session header showing branch name and summary stats.
 */
export class SessionHeaderItem extends GrimoireTreeItem {
  readonly itemType: TreeItemType = 'sessionHeader';

  constructor(state: CovenState) {
    const branchName = state.featureBranch ?? 'Unknown';
    super(branchName, vscode.TreeItemCollapsibleState.None);

    const totalTasks = Object.values(state.tasks).reduce((sum, arr) => sum + arr.length, 0);
    const doneTasks = state.tasks.done.length;
    const workingTasks = state.tasks.working.length;

    this.description = `${doneTasks}/${totalTasks} done`;
    if (workingTasks > 0) {
      this.description += ` | ${workingTasks} working`;
    }

    this.iconPath = new vscode.ThemeIcon('git-branch');
    this.contextValue = 'sessionHeader';
    this.tooltip = new vscode.MarkdownString(
      `**Branch:** ${branchName}\n\n` +
        `**Status:** ${state.sessionStatus}\n\n` +
        `**Tasks:** ${doneTasks} of ${totalTasks} complete`
    );
  }
}

/**
 * Task group header (Ready, Working, Review, etc.).
 */
export class TaskGroupItem extends GrimoireTreeItem {
  readonly itemType: TreeItemType = 'taskGroup';
  readonly status: TaskStatus;

  constructor(
    status: TaskStatus,
    tasks: Task[],
    expanded: boolean
  ) {
    const label = getStatusLabel(status);
    super(label, expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);

    this.status = status;
    this.description = `(${tasks.length})`;
    this.iconPath = getStatusIcon(status);
    this.contextValue = `taskGroup.${status}`;
  }
}

/**
 * Individual task item.
 */
export class TaskItem extends GrimoireTreeItem {
  readonly itemType: TreeItemType = 'task';
  readonly task: Task;

  constructor(task: Task, hasFamiliar: boolean) {
    super(
      task.title,
      task.status === 'working' && hasFamiliar
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );

    this.task = task;
    this.iconPath = getStatusIcon(task.status);
    this.contextValue = `task.${task.status}`;

    // Build description
    const parts: string[] = [];
    if (task.status === 'working') {
      parts.push(formatElapsedTime(task.updatedAt));
    }
    if (task.status === 'blocked' && task.dependencies.length > 0) {
      parts.push(`blocked by ${task.dependencies.length}`);
    }
    if (task.priority === 'critical' || task.priority === 'high') {
      parts.push(task.priority);
    }
    this.description = parts.join(' | ');

    // Tooltip with full details
    this.tooltip = new vscode.MarkdownString(
      `**${task.title}**\n\n` +
        `${task.description}\n\n` +
        `---\n\n` +
        `**Status:** ${task.status}\n\n` +
        `**Priority:** ${task.priority}\n\n` +
        `**Source:** ${task.sourceId}` +
        (task.acceptanceCriteria ? `\n\n**Acceptance Criteria:**\n${task.acceptanceCriteria}` : '')
    );

    // Command to open task detail
    this.command = {
      command: 'coven.showTaskDetail',
      title: 'Show Task Detail',
      arguments: [task.id],
    };
  }
}

/**
 * Familiar (agent) item shown under working tasks.
 */
export class FamiliarItem extends GrimoireTreeItem {
  readonly itemType: TreeItemType = 'familiar';
  readonly familiar: Familiar;

  constructor(familiar: Familiar, hasQuestion: boolean) {
    super(getFamiliarStatusLabel(familiar.status), vscode.TreeItemCollapsibleState.None);

    this.familiar = familiar;
    this.description = formatElapsedTime(familiar.spawnedAt);

    if (hasQuestion) {
      this.iconPath = new vscode.ThemeIcon('question', new vscode.ThemeColor('charts.yellow'));
      this.contextValue = 'familiar.waiting';
    } else {
      this.iconPath = getFamiliarStatusIcon(familiar.status);
      this.contextValue = `familiar.${familiar.status}`;
    }

    // Command to view output
    this.command = {
      command: 'coven.viewFamiliarOutput',
      title: 'View Output',
      arguments: [familiar.taskId],
    };
  }
}

/**
 * Empty state item shown when no tasks exist.
 */
export class EmptyStateItem extends GrimoireTreeItem {
  readonly itemType: TreeItemType = 'emptyState';

  constructor() {
    super('No tasks yet', vscode.TreeItemCollapsibleState.None);
    this.description = 'Add a task to get started';
    this.iconPath = new vscode.ThemeIcon('inbox');
    this.contextValue = 'emptyState';
    this.command = {
      command: 'coven.createTask',
      title: 'Create Task',
    };
  }
}

/**
 * No session item shown when session is inactive.
 */
export class NoSessionItem extends GrimoireTreeItem {
  readonly itemType: TreeItemType = 'noSession';

  constructor() {
    super('Start a Session', vscode.TreeItemCollapsibleState.None);
    this.description = 'Click to begin';
    this.iconPath = new vscode.ThemeIcon('play');
    this.contextValue = 'noSession';
    this.command = {
      command: 'coven.startSession',
      title: 'Start Session',
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function getStatusLabel(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    ready: 'Ready',
    working: 'Working',
    review: 'Review',
    done: 'Done',
    blocked: 'Blocked',
  };
  return labels[status];
}

function getStatusIcon(status: TaskStatus): vscode.ThemeIcon {
  const icons: Record<TaskStatus, [string, string?]> = {
    ready: ['circle-outline'],
    working: ['sync~spin', 'charts.blue'],
    review: ['eye', 'charts.orange'],
    done: ['check', 'charts.green'],
    blocked: ['lock', 'charts.red'],
  };
  const [icon, color] = icons[status];
  return color ? new vscode.ThemeIcon(icon, new vscode.ThemeColor(color)) : new vscode.ThemeIcon(icon);
}

function getFamiliarStatusLabel(status: FamiliarStatus): string {
  const labels: Record<FamiliarStatus, string> = {
    working: 'Agent working',
    waiting: 'Waiting for response',
    merging: 'Merging changes',
    complete: 'Complete',
    failed: 'Failed',
  };
  return labels[status];
}

function getFamiliarStatusIcon(status: FamiliarStatus): vscode.ThemeIcon {
  const icons: Record<FamiliarStatus, [string, string?]> = {
    working: ['sync~spin', 'charts.blue'],
    waiting: ['question', 'charts.yellow'],
    merging: ['git-merge', 'charts.purple'],
    complete: ['check', 'charts.green'],
    failed: ['error', 'charts.red'],
  };
  const [icon, color] = icons[status];
  return color ? new vscode.ThemeIcon(icon, new vscode.ThemeColor(color)) : new vscode.ThemeIcon(icon);
}

function formatElapsedTime(startTimestamp: number): string {
  const elapsed = Date.now() - startTimestamp;
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
