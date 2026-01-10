import * as vscode from 'vscode';
import { StateCache } from '../daemon/cache';
import { DaemonTask, Question, Agent, WorkflowState, WorkflowStatus } from '../daemon/types';

/**
 * Tree item types for type-safe context handling.
 */
export type WorkflowTreeItemType =
  | 'sectionHeader'
  | 'workflowItem'
  | 'taskItem'
  | 'questionItem'
  | 'emptyState';

/**
 * Section types for the workflow tree view.
 */
export type SectionType = 'active' | 'questions' | 'ready' | 'blocked' | 'completed';

/**
 * Default debounce interval for rapid event updates (ms).
 */
const DEFAULT_DEBOUNCE_MS = 100;

/**
 * Main TreeDataProvider for the Workflow sidebar.
 * Displays workflow state from daemon cache with grouped sections.
 */
export class WorkflowTreeProvider implements vscode.TreeDataProvider<WorkflowTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<WorkflowTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private cache: StateCache | null = null;
  private expandedSections: Set<SectionType> = new Set(['active', 'questions', 'ready', 'blocked']);
  private cacheListeners: (() => void)[] = [];

  // Debouncing state
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRefresh: boolean = false;
  private readonly debounceMs: number;

  // Track which sections are dirty for potential future optimization
  private dirtySections: Set<SectionType> = new Set();

  constructor(private readonly context: vscode.ExtensionContext, debounceMs: number = DEFAULT_DEBOUNCE_MS) {
    this.debounceMs = debounceMs;

    // Load persisted expand/collapse state
    const saved = context.workspaceState.get<SectionType[]>('workflow.expandedSections');
    if (saved) {
      this.expandedSections = new Set(saved);
    }
  }

  /**
   * Connect to a StateCache and subscribe to state changes.
   */
  setCache(cache: StateCache | null): void {
    // Unsubscribe from previous cache
    this.cleanupListeners();

    this.cache = cache;

    if (cache) {
      // Create handlers that mark specific sections as dirty
      const workflowHandler = (): void => {
        this.markDirty('active');
        this.scheduleRefresh();
      };

      const tasksHandler = (): void => {
        // Tasks can affect multiple sections
        this.markDirty('active', 'ready', 'blocked', 'completed');
        this.scheduleRefresh();
      };

      const agentsHandler = (): void => {
        this.markDirty('active');
        this.scheduleRefresh();
      };

      const questionsHandler = (): void => {
        this.markDirty('questions');
        this.scheduleRefresh();
      };

      const resetHandler = (): void => {
        // Full state reset - mark everything dirty and refresh immediately
        this.markDirty('active', 'questions', 'ready', 'blocked', 'completed');
        this.flushRefresh();
      };

      cache.on('workflows.changed', workflowHandler);
      cache.on('tasks.changed', tasksHandler);
      cache.on('agents.changed', agentsHandler);
      cache.on('questions.changed', questionsHandler);
      cache.on('state.reset', resetHandler);

      this.cacheListeners = [
        () => cache.off('workflows.changed', workflowHandler),
        () => cache.off('tasks.changed', tasksHandler),
        () => cache.off('agents.changed', agentsHandler),
        () => cache.off('questions.changed', questionsHandler),
        () => cache.off('state.reset', resetHandler),
      ];
    }

    // Initial refresh (immediate, not debounced)
    this.flushRefresh();
  }

  /**
   * Mark sections as dirty (needing refresh).
   */
  private markDirty(...sections: SectionType[]): void {
    for (const section of sections) {
      this.dirtySections.add(section);
    }
  }

  /**
   * Schedule a debounced refresh.
   */
  private scheduleRefresh(): void {
    this.pendingRefresh = true;

    if (this.debounceTimer !== null) {
      // Already scheduled, will pick up the pending flag
      return;
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.pendingRefresh) {
        this.pendingRefresh = false;
        this.executeRefresh();
      }
    }, this.debounceMs);
  }

  /**
   * Flush any pending refresh immediately.
   */
  flushRefresh(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingRefresh = false;
    this.executeRefresh();
  }

  /**
   * Execute the actual refresh.
   */
  private executeRefresh(): void {
    // Clear dirty sections tracker
    this.dirtySections.clear();
    this._onDidChangeTreeData.fire();
  }

  /**
   * Refresh the tree view (debounced).
   */
  refresh(): void {
    this.scheduleRefresh();
  }

  /**
   * Check if any refresh is pending.
   */
  hasPendingRefresh(): boolean {
    return this.pendingRefresh || this.debounceTimer !== null;
  }

  /**
   * Get the currently dirty sections (for testing/debugging).
   */
  getDirtySections(): SectionType[] {
    return Array.from(this.dirtySections);
  }

  /**
   * Get the tree item representation for display.
   */
  getTreeItem(element: WorkflowTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Get children for a tree element.
   */
  getChildren(element?: WorkflowTreeItem): vscode.ProviderResult<WorkflowTreeItem[]> {
    // Root level
    if (!element) {
      return this.getRootChildren();
    }

    // Children of section headers
    if (element instanceof SectionHeaderItem) {
      return this.getSectionChildren(element.section);
    }

    return [];
  }

  /**
   * Get parent of an element (for reveal functionality).
   */
  getParent(element: WorkflowTreeItem): vscode.ProviderResult<WorkflowTreeItem> {
    if (element instanceof WorkflowItem) {
      return new SectionHeaderItem('active', 0, this.expandedSections.has('active'));
    }
    if (element instanceof TaskTreeItem) {
      const task = element.task;
      const section = this.getTaskSection(task);
      const count = this.getSectionTaskCount(section);
      return new SectionHeaderItem(section, count, this.expandedSections.has(section));
    }
    if (element instanceof QuestionTreeItem) {
      const count = this.cache?.getQuestions().length ?? 0;
      return new SectionHeaderItem('questions', count, this.expandedSections.has('questions'));
    }
    return undefined;
  }

  /**
   * Toggle expand/collapse state for a section.
   */
  toggleSectionExpanded(section: SectionType): void {
    if (this.expandedSections.has(section)) {
      this.expandedSections.delete(section);
    } else {
      this.expandedSections.add(section);
    }
    // Persist state
    void this.context.workspaceState.update('workflow.expandedSections', Array.from(this.expandedSections));
    this.refresh();
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.cleanupListeners();
    this.clearDebounceTimer();
    this._onDidChangeTreeData.dispose();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private cleanupListeners(): void {
    for (const cleanup of this.cacheListeners) {
      cleanup();
    }
    this.cacheListeners = [];
  }

  private clearDebounceTimer(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingRefresh = false;
    this.dirtySections.clear();
  }

  private getRootChildren(): WorkflowTreeItem[] {
    if (!this.cache || !this.cache.isInitialized()) {
      return [new EmptyStateItem('Connecting...', 'Waiting for daemon connection')];
    }

    const items: WorkflowTreeItem[] = [];
    const workflow = this.cache.getWorkflow();
    const tasks = this.cache.getTasks();
    const questions = this.cache.getQuestions();
    const agents = this.cache.getAgents();

    // 1. Active Workflows section - show running workflows with spinner icons
    const activeAgents = agents.filter(a => a.status === 'running');
    if (activeAgents.length > 0 || (workflow && workflow.status === 'running')) {
      items.push(new SectionHeaderItem('active', activeAgents.length, this.expandedSections.has('active')));
    }

    // 2. Questions section - workflows blocked on human input
    if (questions.length > 0) {
      items.push(new SectionHeaderItem('questions', questions.length, this.expandedSections.has('questions')));
    }

    // 3. Ready Tasks - queued and ready to start
    const readyTasks = tasks.filter(t => t.status === 'ready' || t.status === 'pending');
    if (readyTasks.length > 0) {
      items.push(new SectionHeaderItem('ready', readyTasks.length, this.expandedSections.has('ready')));
    }

    // 4. Blocked - tasks blocked on dependencies or errors
    const blockedTasks = tasks.filter(t => t.status === 'blocked');
    if (blockedTasks.length > 0) {
      items.push(new SectionHeaderItem('blocked', blockedTasks.length, this.expandedSections.has('blocked')));
    }

    // 5. Completed - finished tasks (collapsed by default)
    const completedTasks = tasks.filter(t => t.status === 'complete');
    if (completedTasks.length > 0) {
      items.push(new SectionHeaderItem('completed', completedTasks.length, this.expandedSections.has('completed')));
    }

    // Show empty state if nothing at all
    if (items.length === 0) {
      return [new EmptyStateItem('No tasks', 'Add a task to get started')];
    }

    return items;
  }

  private getSectionChildren(section: SectionType): WorkflowTreeItem[] {
    if (!this.cache) return [];

    switch (section) {
      case 'active':
        return this.getActiveChildren();
      case 'questions':
        return this.getQuestionChildren();
      case 'ready':
        return this.getReadyChildren();
      case 'blocked':
        return this.getBlockedChildren();
      case 'completed':
        return this.getCompletedChildren();
      default:
        return [];
    }
  }

  private getActiveChildren(): WorkflowTreeItem[] {
    if (!this.cache) return [];

    const items: WorkflowTreeItem[] = [];
    const workflow = this.cache.getWorkflow();
    const agents = this.cache.getAgents();
    const tasks = this.cache.getTasks();

    // Show workflow if running
    if (workflow && workflow.status === 'running') {
      items.push(new WorkflowItem(workflow));
    }

    // Show running agents with their tasks
    for (const agent of agents) {
      if (agent.status === 'running') {
        const task = tasks.find(t => t.id === agent.taskId);
        if (task) {
          items.push(new TaskTreeItem(task, agent));
        }
      }
    }

    return items;
  }

  private getQuestionChildren(): WorkflowTreeItem[] {
    if (!this.cache) return [];

    const questions = this.cache.getQuestions();
    const tasks = this.cache.getTasks();

    return questions.map(q => {
      const task = tasks.find(t => t.id === q.taskId);
      return new QuestionTreeItem(q, task);
    });
  }

  private getReadyChildren(): WorkflowTreeItem[] {
    if (!this.cache) return [];

    const tasks = this.cache.getTasks();
    return tasks
      .filter(t => t.status === 'ready' || t.status === 'pending')
      .sort((a, b) => b.priority - a.priority)
      .map(t => new TaskTreeItem(t));
  }

  private getBlockedChildren(): WorkflowTreeItem[] {
    if (!this.cache) return [];

    const tasks = this.cache.getTasks();
    return tasks
      .filter(t => t.status === 'blocked')
      .map(t => new TaskTreeItem(t));
  }

  private getCompletedChildren(): WorkflowTreeItem[] {
    if (!this.cache) return [];

    const tasks = this.cache.getTasks();
    return tasks
      .filter(t => t.status === 'complete')
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      .map(t => new TaskTreeItem(t));
  }

  private getTaskSection(task: DaemonTask): SectionType {
    switch (task.status) {
      case 'running':
        return 'active';
      case 'ready':
      case 'pending':
        return 'ready';
      case 'blocked':
        return 'blocked';
      case 'complete':
        return 'completed';
      default:
        return 'ready';
    }
  }

  private getSectionTaskCount(section: SectionType): number {
    if (!this.cache) return 0;

    const tasks = this.cache.getTasks();
    switch (section) {
      case 'active':
        return this.cache.getAgents().filter(a => a.status === 'running').length;
      case 'questions':
        return this.cache.getQuestions().length;
      case 'ready':
        return tasks.filter(t => t.status === 'ready' || t.status === 'pending').length;
      case 'blocked':
        return tasks.filter(t => t.status === 'blocked').length;
      case 'completed':
        return tasks.filter(t => t.status === 'complete').length;
      default:
        return 0;
    }
  }
}

/**
 * Base class for all tree items in the workflow view.
 */
export abstract class WorkflowTreeItem extends vscode.TreeItem {
  abstract readonly itemType: WorkflowTreeItemType;
}

/**
 * Section header item (Active, Questions, Ready, etc.).
 */
export class SectionHeaderItem extends WorkflowTreeItem {
  readonly itemType: WorkflowTreeItemType = 'sectionHeader';
  readonly section: SectionType;

  constructor(section: SectionType, count: number, expanded: boolean) {
    const label = getSectionLabel(section);
    // Show badge count for questions section
    const displayLabel = section === 'questions' && count > 0 ? `${label} (${count})` : label;
    super(displayLabel, expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);

    this.section = section;
    if (section !== 'questions') {
      this.description = `(${count})`;
    }
    this.iconPath = getSectionIcon(section);
    this.contextValue = `section.${section}`;
  }
}

/**
 * Workflow item showing the running workflow.
 */
export class WorkflowItem extends WorkflowTreeItem {
  readonly itemType: WorkflowTreeItemType = 'workflowItem';
  readonly workflow: WorkflowState;

  constructor(workflow: WorkflowState) {
    super(workflow.id || 'Workflow', vscode.TreeItemCollapsibleState.None);

    this.workflow = workflow;
    this.description = getWorkflowStatusLabel(workflow.status);
    this.iconPath = getWorkflowStatusIcon(workflow.status);
    this.contextValue = `workflow.${workflow.status}`;

    if (workflow.startedAt) {
      this.tooltip = new vscode.MarkdownString(
        `**Workflow:** ${workflow.id}\n\n` +
        `**Status:** ${workflow.status}\n\n` +
        `**Started:** ${new Date(workflow.startedAt).toLocaleString()}`
      );
    }
  }
}

/**
 * Task item showing a task from the daemon.
 */
export class TaskTreeItem extends WorkflowTreeItem {
  readonly itemType: WorkflowTreeItemType = 'taskItem';
  readonly task: DaemonTask;
  readonly agent?: Agent;

  constructor(task: DaemonTask, agent?: Agent) {
    super(task.title, vscode.TreeItemCollapsibleState.None);

    this.task = task;
    this.agent = agent;

    // Set icon based on status
    this.iconPath = getTaskStatusIcon(task.status, agent?.status);
    this.contextValue = `task.${task.status}`;

    // Build description
    const parts: string[] = [];
    if (task.status === 'running' && task.startedAt) {
      parts.push(formatElapsedTime(task.startedAt));
    }
    if (task.status === 'blocked' && task.dependencies.length > 0) {
      parts.push(`blocked by ${task.dependencies.length}`);
    }
    if (task.priority >= 3) {
      parts.push('high priority');
    }
    this.description = parts.join(' | ');

    // Tooltip with full details
    this.tooltip = new vscode.MarkdownString(
      `**${task.title}**\n\n` +
      `${task.description}\n\n` +
      `---\n\n` +
      `**Status:** ${task.status}\n\n` +
      `**Priority:** ${task.priority}` +
      (task.error ? `\n\n**Error:** ${task.error}` : '')
    );

    // Command to open task detail
    this.command = {
      command: 'coven.showWorkflowDetail',
      title: 'Show Workflow Detail',
      arguments: [task.id],
    };
  }
}

/**
 * Question item showing a pending question.
 */
export class QuestionTreeItem extends WorkflowTreeItem {
  readonly itemType: WorkflowTreeItemType = 'questionItem';
  readonly question: Question;
  readonly task?: DaemonTask;

  constructor(question: Question, task?: DaemonTask) {
    const label = task?.title ?? `Task ${question.taskId}`;
    super(label, vscode.TreeItemCollapsibleState.None);

    this.question = question;
    this.task = task;

    this.description = truncateText(question.text, 50);
    this.iconPath = new vscode.ThemeIcon('question', new vscode.ThemeColor('charts.yellow'));
    this.contextValue = 'question';

    // Tooltip with full question
    const tooltipLines = [
      `**${label}**`,
      '',
      question.text,
    ];
    if (question.options && question.options.length > 0) {
      tooltipLines.push('', '**Options:**');
      for (const opt of question.options) {
        tooltipLines.push(`- ${opt}`);
      }
    }
    this.tooltip = new vscode.MarkdownString(tooltipLines.join('\n'));

    // Command to answer question
    this.command = {
      command: 'coven.answerQuestion',
      title: 'Answer Question',
      arguments: [question.id],
    };
  }
}

/**
 * Empty state item shown when no content.
 */
export class EmptyStateItem extends WorkflowTreeItem {
  readonly itemType: WorkflowTreeItemType = 'emptyState';

  constructor(label: string, description?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon('inbox');
    this.contextValue = 'emptyState';
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function getSectionLabel(section: SectionType): string {
  const labels: Record<SectionType, string> = {
    active: 'Active',
    questions: 'Questions',
    ready: 'Ready',
    blocked: 'Blocked',
    completed: 'Completed',
  };
  return labels[section];
}

function getSectionIcon(section: SectionType): vscode.ThemeIcon {
  const icons: Record<SectionType, [string, string?]> = {
    active: ['sync~spin', 'charts.blue'],
    questions: ['question', 'charts.yellow'],
    ready: ['circle-outline'],
    blocked: ['lock', 'charts.red'],
    completed: ['check', 'charts.green'],
  };
  const [icon, color] = icons[section];
  return color ? new vscode.ThemeIcon(icon, new vscode.ThemeColor(color)) : new vscode.ThemeIcon(icon);
}

function getWorkflowStatusLabel(status: WorkflowStatus): string {
  const labels: Record<WorkflowStatus, string> = {
    idle: 'Idle',
    running: 'Running',
    paused: 'Paused',
    completed: 'Completed',
    error: 'Error',
  };
  return labels[status];
}

function getWorkflowStatusIcon(status: WorkflowStatus): vscode.ThemeIcon {
  const icons: Record<WorkflowStatus, [string, string?]> = {
    idle: ['circle-outline'],
    running: ['sync~spin', 'charts.blue'],
    paused: ['debug-pause', 'charts.orange'],
    completed: ['check', 'charts.green'],
    error: ['error', 'charts.red'],
  };
  const [icon, color] = icons[status];
  return color ? new vscode.ThemeIcon(icon, new vscode.ThemeColor(color)) : new vscode.ThemeIcon(icon);
}

function getTaskStatusIcon(
  taskStatus: DaemonTask['status'],
  agentStatus?: Agent['status']
): vscode.ThemeIcon {
  // If agent is running, show spinner
  if (agentStatus === 'running') {
    return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
  }
  if (agentStatus === 'waiting') {
    return new vscode.ThemeIcon('question', new vscode.ThemeColor('charts.yellow'));
  }

  const icons: Record<DaemonTask['status'], [string, string?]> = {
    pending: ['circle-outline'],
    ready: ['circle-outline'],
    running: ['sync~spin', 'charts.blue'],
    complete: ['check', 'charts.green'],
    failed: ['error', 'charts.red'],
    blocked: ['lock', 'charts.red'],
  };
  const [icon, color] = icons[taskStatus];
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

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
