import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WorkflowTreeProvider,
  SectionHeaderItem,
  WorkflowItem,
  TaskTreeItem,
  QuestionTreeItem,
  EmptyStateItem,
  SectionType,
} from './WorkflowTreeProvider';
import { StateCache } from '../daemon/cache';
import { DaemonTask, Question, Agent, WorkflowState } from '../daemon/types';
import type * as vscode from 'vscode';
import { TreeItemCollapsibleState } from 'vscode';

// Mock StateCache
vi.mock('../daemon/cache', () => ({
  StateCache: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    off: vi.fn(),
    isInitialized: vi.fn(() => true),
    getWorkflow: vi.fn(),
    getTasks: vi.fn(() => []),
    getAgents: vi.fn(() => []),
    getQuestions: vi.fn(() => []),
  })),
}));

function createMockContext(): vscode.ExtensionContext {
  const storage = new Map<string, unknown>();
  return {
    workspaceState: {
      get: <T>(key: string): T | undefined => storage.get(key) as T,
      update: (key: string, value: unknown) => {
        storage.set(key, value);
        return Promise.resolve();
      },
      keys: () => Array.from(storage.keys()),
    },
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

function createMockWorkflow(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    id: 'workflow-1',
    status: 'running',
    startedAt: Date.now() - 60000,
    ...overrides,
  };
}

function createMockTask(overrides: Partial<DaemonTask> = {}): DaemonTask {
  return {
    id: 'task-1',
    title: 'Test Task',
    description: 'A test task description',
    status: 'ready',
    priority: 2,
    dependencies: [],
    createdAt: Date.now() - 120000,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createMockAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    taskId: 'task-1',
    status: 'running',
    pid: 1234,
    startedAt: Date.now() - 30000,
    ...overrides,
  };
}

function createMockQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'question-1',
    taskId: 'task-1',
    agentId: 'agent-1',
    text: 'What should I do next?',
    options: ['Option A', 'Option B'],
    askedAt: Date.now(),
    ...overrides,
  };
}

describe('WorkflowTreeProvider', () => {
  let provider: WorkflowTreeProvider;
  let mockContext: vscode.ExtensionContext;
  let mockCache: StateCache;

  beforeEach(() => {
    mockContext = createMockContext();
    provider = new WorkflowTreeProvider(mockContext);
    mockCache = new StateCache();
  });

  afterEach(() => {
    provider.dispose();
  });

  describe('constructor', () => {
    it('loads persisted expand/collapse state', async () => {
      const context = createMockContext();
      await context.workspaceState.update('workflow.expandedSections', ['active', 'ready']);

      const p = new WorkflowTreeProvider(context);
      p.dispose();
    });

    it('uses default expanded sections when no persisted state', () => {
      const context = createMockContext();
      const p = new WorkflowTreeProvider(context);
      p.dispose();
    });
  });

  describe('setCache', () => {
    it('subscribes to state changes', () => {
      provider.setCache(mockCache);

      expect(mockCache.on).toHaveBeenCalledWith('workflows.changed', expect.any(Function));
      expect(mockCache.on).toHaveBeenCalledWith('tasks.changed', expect.any(Function));
      expect(mockCache.on).toHaveBeenCalledWith('agents.changed', expect.any(Function));
      expect(mockCache.on).toHaveBeenCalledWith('questions.changed', expect.any(Function));
      expect(mockCache.on).toHaveBeenCalledWith('state.reset', expect.any(Function));
    });

    it('unsubscribes from previous cache', () => {
      provider.setCache(mockCache);
      provider.setCache(null);

      expect(mockCache.off).toHaveBeenCalledWith('workflows.changed', expect.any(Function));
      expect(mockCache.off).toHaveBeenCalledWith('tasks.changed', expect.any(Function));
      expect(mockCache.off).toHaveBeenCalledWith('agents.changed', expect.any(Function));
      expect(mockCache.off).toHaveBeenCalledWith('questions.changed', expect.any(Function));
      expect(mockCache.off).toHaveBeenCalledWith('state.reset', expect.any(Function));
    });

    it('fires refresh on cache change', () => {
      const refreshSpy = vi.fn();
      provider.onDidChangeTreeData(refreshSpy);

      provider.setCache(mockCache);

      expect(refreshSpy).toHaveBeenCalled();
    });

    it('handles null cache gracefully', () => {
      provider.setCache(null);

      expect(() => provider.setCache(null)).not.toThrow();
    });
  });

  describe('getTreeItem', () => {
    it('returns the element unchanged', () => {
      const item = new EmptyStateItem('Test', 'Description');
      expect(provider.getTreeItem(item)).toBe(item);
    });
  });

  describe('getChildren - root level', () => {
    it('returns connecting message when cache not initialized', async () => {
      (mockCache.isInitialized as ReturnType<typeof vi.fn>).mockReturnValue(false);
      provider.setCache(mockCache);

      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children![0]).toBeInstanceOf(EmptyStateItem);
      expect((children![0] as EmptyStateItem).label).toBe('Connecting...');
    });

    it('returns empty state when no cache', async () => {
      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children![0]).toBeInstanceOf(EmptyStateItem);
    });

    it('returns empty state when cache has no content', async () => {
      (mockCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      provider.setCache(mockCache);

      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children![0]).toBeInstanceOf(EmptyStateItem);
      expect((children![0] as EmptyStateItem).label).toBe('No tasks');
    });

    it('shows Active section when workflow is running', async () => {
      (mockCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(createMockWorkflow({ status: 'running' }));
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      provider.setCache(mockCache);

      const children = await provider.getChildren();

      expect(children!.some(c => c instanceof SectionHeaderItem && c.section === 'active')).toBe(true);
    });

    it('shows Active section when agents are running', async () => {
      (mockCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue([createMockTask({ id: 'task-1', status: 'running' })]);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([createMockAgent({ taskId: 'task-1', status: 'running' })]);
      (mockCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      provider.setCache(mockCache);

      const children = await provider.getChildren();

      expect(children!.some(c => c instanceof SectionHeaderItem && c.section === 'active')).toBe(true);
    });

    it('shows Questions section with badge count', async () => {
      const questions = [
        createMockQuestion({ id: 'q1' }),
        createMockQuestion({ id: 'q2' }),
        createMockQuestion({ id: 'q3' }),
      ];
      (mockCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue(questions);
      provider.setCache(mockCache);

      const children = await provider.getChildren();

      const questionsSection = children!.find(c => c instanceof SectionHeaderItem && c.section === 'questions') as SectionHeaderItem;
      expect(questionsSection).toBeDefined();
      expect(questionsSection.label).toBe('Questions (3)');
    });

    it('shows Ready Tasks section', async () => {
      (mockCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue([createMockTask({ status: 'ready' })]);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      provider.setCache(mockCache);

      const children = await provider.getChildren();

      expect(children!.some(c => c instanceof SectionHeaderItem && c.section === 'ready')).toBe(true);
    });

    it('shows Blocked section', async () => {
      (mockCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue([createMockTask({ status: 'blocked' })]);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      provider.setCache(mockCache);

      const children = await provider.getChildren();

      expect(children!.some(c => c instanceof SectionHeaderItem && c.section === 'blocked')).toBe(true);
    });

    it('shows Completed section', async () => {
      (mockCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue([createMockTask({ status: 'complete' })]);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      provider.setCache(mockCache);

      const children = await provider.getChildren();

      expect(children!.some(c => c instanceof SectionHeaderItem && c.section === 'completed')).toBe(true);
    });

    it('includes pending tasks in Ready section', async () => {
      (mockCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue([createMockTask({ status: 'pending' })]);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      provider.setCache(mockCache);

      const children = await provider.getChildren();

      const readySection = children!.find(c => c instanceof SectionHeaderItem && c.section === 'ready');
      expect(readySection).toBeDefined();
    });
  });

  describe('getChildren - section children', () => {
    it('returns workflow and running tasks for Active section', async () => {
      const workflow = createMockWorkflow({ status: 'running' });
      const task = createMockTask({ id: 'task-1', status: 'running' });
      const agent = createMockAgent({ taskId: 'task-1', status: 'running' });

      (mockCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(workflow);
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue([task]);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([agent]);
      (mockCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      provider.setCache(mockCache);

      const sectionHeader = new SectionHeaderItem('active', 1, true);
      const children = await provider.getChildren(sectionHeader);

      expect(children!.some(c => c instanceof WorkflowItem)).toBe(true);
      expect(children!.some(c => c instanceof TaskTreeItem)).toBe(true);
    });

    it('returns questions for Questions section', async () => {
      const question = createMockQuestion();
      const task = createMockTask({ id: question.taskId });

      (mockCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue([task]);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([question]);
      provider.setCache(mockCache);

      const sectionHeader = new SectionHeaderItem('questions', 1, true);
      const children = await provider.getChildren(sectionHeader);

      expect(children).toHaveLength(1);
      expect(children![0]).toBeInstanceOf(QuestionTreeItem);
    });

    it('returns ready and pending tasks for Ready section', async () => {
      const tasks = [
        createMockTask({ id: 'task-1', status: 'ready', priority: 1 }),
        createMockTask({ id: 'task-2', status: 'pending', priority: 3 }),
      ];

      (mockCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue(tasks);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      provider.setCache(mockCache);

      const sectionHeader = new SectionHeaderItem('ready', 2, true);
      const children = await provider.getChildren(sectionHeader);

      expect(children).toHaveLength(2);
      // Higher priority should come first
      expect((children![0] as TaskTreeItem).task.id).toBe('task-2');
    });

    it('returns blocked tasks for Blocked section', async () => {
      const task = createMockTask({ status: 'blocked', dependencies: ['dep-1'] });

      (mockCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue([task]);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      provider.setCache(mockCache);

      const sectionHeader = new SectionHeaderItem('blocked', 1, true);
      const children = await provider.getChildren(sectionHeader);

      expect(children).toHaveLength(1);
      expect(children![0]).toBeInstanceOf(TaskTreeItem);
    });

    it('returns completed tasks sorted by completion time for Completed section', async () => {
      const tasks = [
        createMockTask({ id: 'task-1', status: 'complete', completedAt: Date.now() - 60000 }),
        createMockTask({ id: 'task-2', status: 'complete', completedAt: Date.now() }),
      ];

      (mockCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue(tasks);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      provider.setCache(mockCache);

      const sectionHeader = new SectionHeaderItem('completed', 2, true);
      const children = await provider.getChildren(sectionHeader);

      expect(children).toHaveLength(2);
      // Most recently completed should come first
      expect((children![0] as TaskTreeItem).task.id).toBe('task-2');
    });

    it('returns empty array when cache is null', async () => {
      const sectionHeader = new SectionHeaderItem('active', 0, true);
      const children = await provider.getChildren(sectionHeader);

      expect(children).toEqual([]);
    });
  });

  describe('getParent', () => {
    beforeEach(() => {
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      provider.setCache(mockCache);
    });

    it('returns active section for workflow items', () => {
      const workflow = createMockWorkflow();
      const item = new WorkflowItem(workflow);

      const parent = provider.getParent(item);

      expect(parent).toBeInstanceOf(SectionHeaderItem);
      expect((parent as SectionHeaderItem).section).toBe('active');
    });

    it('returns correct section for task items', () => {
      const task = createMockTask({ status: 'blocked' });
      const item = new TaskTreeItem(task);

      const parent = provider.getParent(item);

      expect(parent).toBeInstanceOf(SectionHeaderItem);
      expect((parent as SectionHeaderItem).section).toBe('blocked');
    });

    it('returns questions section for question items', () => {
      const question = createMockQuestion();
      const item = new QuestionTreeItem(question);

      const parent = provider.getParent(item);

      expect(parent).toBeInstanceOf(SectionHeaderItem);
      expect((parent as SectionHeaderItem).section).toBe('questions');
    });

    it('returns undefined for section headers', () => {
      const item = new SectionHeaderItem('active', 0, true);

      const parent = provider.getParent(item);

      expect(parent).toBeUndefined();
    });
  });

  describe('toggleSectionExpanded', () => {
    it('collapses expanded section', () => {
      // 'active' is expanded by default, toggle once to collapse
      provider.toggleSectionExpanded('active');

      const saved = mockContext.workspaceState.get<SectionType[]>('workflow.expandedSections');
      expect(saved).not.toContain('active');
    });

    it('expands collapsed section', () => {
      provider.toggleSectionExpanded('completed'); // Should expand since collapsed by default

      const saved = mockContext.workspaceState.get<SectionType[]>('workflow.expandedSections');
      expect(saved).toContain('completed');
    });

    it('fires refresh after toggle', async () => {
      const refreshSpy = vi.fn();
      provider.onDidChangeTreeData(refreshSpy);

      provider.toggleSectionExpanded('active');

      // Wait for debounced refresh
      await vi.waitFor(() => {
        expect(refreshSpy).toHaveBeenCalled();
      });
    });

    it('persists state to workspace storage', () => {
      provider.toggleSectionExpanded('completed');

      const saved = mockContext.workspaceState.get<SectionType[]>('workflow.expandedSections');
      expect(saved).toBeDefined();
    });
  });

  describe('refresh', () => {
    it('fires onDidChangeTreeData event after debounce', async () => {
      const spy = vi.fn();
      provider.onDidChangeTreeData(spy);

      provider.refresh();

      // Should be pending
      expect(provider.hasPendingRefresh()).toBe(true);

      // Wait for debounce
      await vi.waitFor(() => {
        expect(spy).toHaveBeenCalled();
      });
    });

    it('debounces multiple rapid refreshes', async () => {
      // Create provider with short debounce for faster testing
      provider.dispose();
      provider = new WorkflowTreeProvider(mockContext, 50);

      const spy = vi.fn();
      provider.onDidChangeTreeData(spy);

      // Trigger multiple refreshes rapidly
      provider.refresh();
      provider.refresh();
      provider.refresh();

      // Should still be pending
      expect(provider.hasPendingRefresh()).toBe(true);

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have only fired once
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('flushRefresh fires immediately', () => {
      const spy = vi.fn();
      provider.onDidChangeTreeData(spy);

      provider.flushRefresh();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(provider.hasPendingRefresh()).toBe(false);
    });
  });

  describe('debouncing', () => {
    beforeEach(() => {
      // Use shorter debounce for tests
      provider.dispose();
      provider = new WorkflowTreeProvider(mockContext, 50);
    });

    it('marks workflow section dirty on workflows.changed', () => {
      // Setup to capture handlers
      let workflowHandler: () => void = () => {};
      (mockCache.on as ReturnType<typeof vi.fn>).mockImplementation((event, handler) => {
        if (event === 'workflows.changed') {
          workflowHandler = handler;
        }
      });

      provider.setCache(mockCache);

      // Trigger event
      workflowHandler();

      expect(provider.getDirtySections()).toContain('active');
    });

    it('marks multiple sections dirty on tasks.changed', () => {
      let taskHandler: () => void = () => {};
      (mockCache.on as ReturnType<typeof vi.fn>).mockImplementation((event, handler) => {
        if (event === 'tasks.changed') {
          taskHandler = handler;
        }
      });

      provider.setCache(mockCache);
      taskHandler();

      const dirty = provider.getDirtySections();
      expect(dirty).toContain('active');
      expect(dirty).toContain('ready');
      expect(dirty).toContain('blocked');
      expect(dirty).toContain('completed');
    });

    it('marks questions section dirty on questions.changed', () => {
      let questionHandler: () => void = () => {};
      (mockCache.on as ReturnType<typeof vi.fn>).mockImplementation((event, handler) => {
        if (event === 'questions.changed') {
          questionHandler = handler;
        }
      });

      provider.setCache(mockCache);
      questionHandler();

      expect(provider.getDirtySections()).toContain('questions');
    });

    it('flushes immediately on state.reset', () => {
      const spy = vi.fn();

      let resetHandler: () => void = () => {};
      (mockCache.on as ReturnType<typeof vi.fn>).mockImplementation((event, handler) => {
        if (event === 'state.reset') {
          resetHandler = handler;
        }
      });

      provider.setCache(mockCache);
      provider.onDidChangeTreeData(spy);

      // Reset spy since setCache fires
      spy.mockClear();

      resetHandler();

      // Should fire immediately
      expect(spy).toHaveBeenCalledTimes(1);
      expect(provider.hasPendingRefresh()).toBe(false);
    });

    it('clears dirty sections after refresh executes', async () => {
      let taskHandler: () => void = () => {};
      (mockCache.on as ReturnType<typeof vi.fn>).mockImplementation((event, handler) => {
        if (event === 'tasks.changed') {
          taskHandler = handler;
        }
      });

      provider.setCache(mockCache);
      taskHandler();

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(provider.getDirtySections()).toEqual([]);
    });
  });

  describe('dispose', () => {
    it('cleans up cache listeners', () => {
      provider.setCache(mockCache);
      provider.dispose();

      expect(mockCache.off).toHaveBeenCalled();
    });

    it('handles dispose without cache', () => {
      expect(() => provider.dispose()).not.toThrow();
    });

    it('clears pending debounce timer', () => {
      provider.refresh();
      expect(provider.hasPendingRefresh()).toBe(true);

      provider.dispose();

      expect(provider.hasPendingRefresh()).toBe(false);
    });
  });
});

describe('SectionHeaderItem', () => {
  it('creates expanded section with count in description', () => {
    const item = new SectionHeaderItem('ready', 5, true);

    expect(item.label).toBe('Ready');
    expect(item.description).toBe('(5)');
    expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
    expect(item.section).toBe('ready');
    expect(item.contextValue).toBe('section.ready');
  });

  it('creates collapsed section', () => {
    const item = new SectionHeaderItem('completed', 3, false);

    expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
  });

  it('shows badge count in label for questions section', () => {
    const item = new SectionHeaderItem('questions', 7, true);

    expect(item.label).toBe('Questions (7)');
    expect(item.description).toBeUndefined();
  });

  it('shows appropriate icons for each section', () => {
    const sections: SectionType[] = ['active', 'questions', 'ready', 'blocked', 'completed'];

    for (const section of sections) {
      const item = new SectionHeaderItem(section, 1, true);
      expect(item.iconPath).toBeDefined();
    }
  });
});

describe('WorkflowItem', () => {
  it('creates workflow item with status description', () => {
    const workflow = createMockWorkflow({ status: 'running' });
    const item = new WorkflowItem(workflow);

    expect(item.label).toBe('workflow-1');
    expect(item.description).toBe('Running');
    expect(item.contextValue).toBe('workflow.running');
    expect(item.workflow).toBe(workflow);
  });

  it('creates tooltip with start time', () => {
    const workflow = createMockWorkflow({ startedAt: Date.now() });
    const item = new WorkflowItem(workflow);

    expect(item.tooltip).toBeDefined();
  });

  it('handles workflow without id', () => {
    const workflow = createMockWorkflow({ id: '' });
    const item = new WorkflowItem(workflow);

    expect(item.label).toBe('Workflow');
  });

  it('shows appropriate icons for each status', () => {
    const statuses: WorkflowState['status'][] = ['idle', 'running', 'paused', 'completed', 'error'];

    for (const status of statuses) {
      const workflow = createMockWorkflow({ status });
      const item = new WorkflowItem(workflow);
      expect(item.iconPath).toBeDefined();
    }
  });
});

describe('TaskTreeItem', () => {
  it('creates task item with title', () => {
    const task = createMockTask({ title: 'My Task' });
    const item = new TaskTreeItem(task);

    expect(item.label).toBe('My Task');
    expect(item.task).toBe(task);
  });

  it('shows elapsed time for running tasks', () => {
    const task = createMockTask({ status: 'running', startedAt: Date.now() - 65000 });
    const item = new TaskTreeItem(task);

    expect(item.description).toContain('m');
  });

  it('shows blocked dependency count', () => {
    const task = createMockTask({ status: 'blocked', dependencies: ['dep-1', 'dep-2'] });
    const item = new TaskTreeItem(task);

    expect(item.description).toContain('blocked by 2');
  });

  it('shows high priority indicator', () => {
    const task = createMockTask({ priority: 4 });
    const item = new TaskTreeItem(task);

    expect(item.description).toContain('high priority');
  });

  it('shows spinner icon when agent is running', () => {
    const task = createMockTask();
    const agent = createMockAgent({ status: 'running' });
    const item = new TaskTreeItem(task, agent);

    expect(item.iconPath).toBeDefined();
  });

  it('shows question icon when agent is waiting', () => {
    const task = createMockTask();
    const agent = createMockAgent({ status: 'waiting' });
    const item = new TaskTreeItem(task, agent);

    expect(item.iconPath).toBeDefined();
  });

  it('includes error in tooltip when present', () => {
    const task = createMockTask({ error: 'Something went wrong' });
    const item = new TaskTreeItem(task);

    const tooltipValue = (item.tooltip as vscode.MarkdownString)?.value;
    expect(tooltipValue).toContain('Error');
  });

  it('sets command to show workflow detail', () => {
    const task = createMockTask({ id: 'task-123' });
    const item = new TaskTreeItem(task);

    expect(item.command?.command).toBe('coven.showWorkflowDetail');
    expect(item.command?.arguments).toContain('task-123');
  });

  it('shows appropriate icons for each status', () => {
    const statuses: DaemonTask['status'][] = ['pending', 'ready', 'running', 'complete', 'failed', 'blocked'];

    for (const status of statuses) {
      const task = createMockTask({ status });
      const item = new TaskTreeItem(task);
      expect(item.iconPath).toBeDefined();
    }
  });
});

describe('QuestionTreeItem', () => {
  it('creates question item with task title as label', () => {
    const question = createMockQuestion();
    const task = createMockTask({ title: 'Related Task' });
    const item = new QuestionTreeItem(question, task);

    expect(item.label).toBe('Related Task');
    expect(item.question).toBe(question);
    expect(item.task).toBe(task);
  });

  it('uses task id when task not provided', () => {
    const question = createMockQuestion({ taskId: 'task-xyz' });
    const item = new QuestionTreeItem(question);

    expect(item.label).toBe('Task task-xyz');
  });

  it('truncates long question text in description', () => {
    const longText = 'This is a very long question that should be truncated because it exceeds the maximum length allowed';
    const question = createMockQuestion({ text: longText });
    const item = new QuestionTreeItem(question);

    expect(item.description!.length).toBeLessThan(longText.length);
    expect(item.description).toContain('...');
  });

  it('shows question icon', () => {
    const question = createMockQuestion();
    const item = new QuestionTreeItem(question);

    expect(item.iconPath).toBeDefined();
    expect(item.contextValue).toBe('question');
  });

  it('includes options in tooltip', () => {
    const question = createMockQuestion({ options: ['Yes', 'No', 'Maybe'] });
    const item = new QuestionTreeItem(question);

    const tooltipValue = (item.tooltip as vscode.MarkdownString)?.value;
    expect(tooltipValue).toContain('Options');
    expect(tooltipValue).toContain('Yes');
  });

  it('sets command to answer question', () => {
    const question = createMockQuestion({ id: 'q-123' });
    const item = new QuestionTreeItem(question);

    expect(item.command?.command).toBe('coven.answerQuestion');
    expect(item.command?.arguments).toContain('q-123');
  });
});

describe('EmptyStateItem', () => {
  it('creates empty state with label and description', () => {
    const item = new EmptyStateItem('No items', 'Add something');

    expect(item.label).toBe('No items');
    expect(item.description).toBe('Add something');
    expect(item.contextValue).toBe('emptyState');
    expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
  });

  it('shows inbox icon', () => {
    const item = new EmptyStateItem('Empty');

    expect(item.iconPath).toBeDefined();
  });
});
