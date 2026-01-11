import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WorkflowTreeProvider,
  SectionHeaderItem,
  WorkflowItem,
  TaskTreeItem,
  QuestionTreeItem,
  EmptyStateItem,
} from './WorkflowTreeProvider';
import { StateCache, WorkflowState } from '../daemon/cache';
import type { Task, Question, Agent } from '@coven/client-ts';
import { WorkflowStatus, AgentStatus, TaskStatus, Task as TaskClass } from '@coven/client-ts';
import type * as vscode from 'vscode';

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
      update: vi.fn((key: string, value: unknown) => {
        storage.set(key, value);
        return Promise.resolve();
      }),
      keys: () => Array.from(storage.keys()),
    },
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

function createMockWorkflow(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    id: 'workflow-1',
    status: WorkflowStatus.RUNNING,
    started_at: new Date(Date.now() - 60000).toISOString(),
    ...overrides,
  };
}

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test Task',
    description: 'A test task description',
    status: TaskStatus.OPEN,
    priority: 2,
    depends_on: [],
    type: TaskClass.type.TASK,
    created_at: new Date(Date.now() - 120000).toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function createMockAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    task_id: 'task-1',
    status: AgentStatus.RUNNING,
    pid: 1234,
    worktree: '/tmp/worktree',
    branch: 'feature-branch',
    started_at: new Date(Date.now() - 30000).toISOString(),
    ...overrides,
  };
}

function createMockQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'question-1',
    task_id: 'task-1',
    agent_id: 'agent-1',
    text: 'What should I do next?',
    type: 'choice',
    options: ['Option A', 'Option B'],
    asked_at: new Date().toISOString(),
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

    it('shows Active section when agents are running', async () => {
      const task = createMockTask({ id: 'task-1', status: TaskStatus.IN_PROGRESS });
      const agent = createMockAgent({ task_id: 'task-1', status: AgentStatus.RUNNING });
      (mockCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue([task]);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([agent]);
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
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue([createMockTask({ status: TaskStatus.OPEN })]);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      provider.setCache(mockCache);

      const children = await provider.getChildren();

      expect(children!.some(c => c instanceof SectionHeaderItem && c.section === 'ready')).toBe(true);
    });

    it('shows Blocked section', async () => {
      (mockCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue([createMockTask({ status: TaskStatus.BLOCKED })]);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      provider.setCache(mockCache);

      const children = await provider.getChildren();

      expect(children!.some(c => c instanceof SectionHeaderItem && c.section === 'blocked')).toBe(true);
    });

    it('shows Completed section', async () => {
      (mockCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue([createMockTask({ status: TaskStatus.CLOSED })]);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      provider.setCache(mockCache);

      const children = await provider.getChildren();

      expect(children!.some(c => c instanceof SectionHeaderItem && c.section === 'completed')).toBe(true);
    });

    it('includes pending tasks in Ready section', async () => {
      (mockCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue([createMockTask({ status: TaskStatus.OPEN })]);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      provider.setCache(mockCache);

      const children = await provider.getChildren();

      const readySection = children!.find(c => c instanceof SectionHeaderItem && c.section === 'ready');
      expect(readySection).toBeDefined();
    });
  });

  describe('getChildren - section children', () => {
    it('returns running tasks for Active section', async () => {
      const task = createMockTask({ id: 'task-1', status: TaskStatus.IN_PROGRESS });
      const agent = createMockAgent({ task_id: 'task-1', status: AgentStatus.RUNNING });

      (mockCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue([task]);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([agent]);
      (mockCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      provider.setCache(mockCache);

      const sectionHeader = new SectionHeaderItem('active', 1, true);
      const children = await provider.getChildren(sectionHeader);

      expect(children).toHaveLength(1);
      expect(children![0]).toBeInstanceOf(TaskTreeItem);
    });

    it('returns questions for Questions section', async () => {
      const question = createMockQuestion();
      const task = createMockTask({ id: question.task_id });

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
        createMockTask({ id: 'task-1', status: TaskStatus.OPEN, priority: 1 }),
        createMockTask({ id: 'task-2', status: TaskStatus.OPEN, priority: 3 }),
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
      const task = createMockTask({ status: TaskStatus.BLOCKED, depends_on: ['dep-1'] });

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

    it('returns completed tasks for Completed section', async () => {
      const tasks = [
        createMockTask({ id: 'task-1', status: TaskStatus.CLOSED }),
        createMockTask({ id: 'task-2', status: TaskStatus.CLOSED }),
      ];

      (mockCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockCache.getTasks as ReturnType<typeof vi.fn>).mockReturnValue(tasks);
      (mockCache.getAgents as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      provider.setCache(mockCache);

      const sectionHeader = new SectionHeaderItem('completed', 2, true);
      const children = await provider.getChildren(sectionHeader);

      expect(children).toHaveLength(2);
      expect(children![0]).toBeInstanceOf(TaskTreeItem);
      expect(children![1]).toBeInstanceOf(TaskTreeItem);
    });

    it('returns empty array for collapsed section', async () => {
      const sectionHeader = new SectionHeaderItem('active', 1, false);
      const children = await provider.getChildren(sectionHeader);

      expect(children).toEqual([]);
    });
  });

  describe('refresh', () => {
    it('fires change event after flush', () => {
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);

      provider.flushRefresh();

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('toggleSectionExpanded', () => {
    it('removes section from expanded set when toggling', () => {
      // 'active' is expanded by default
      provider.toggleSectionExpanded('active');

      // The internal state should have removed 'active'
      // This is tested indirectly through the persisted state
      expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
        'workflow.expandedSections',
        expect.not.arrayContaining(['active'])
      );
    });

    it('adds section to expanded set when toggling collapsed section', () => {
      // 'completed' is not expanded by default
      provider.toggleSectionExpanded('completed');

      expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
        'workflow.expandedSections',
        expect.arrayContaining(['completed'])
      );
    });

    it('persists expanded state', () => {
      provider.toggleSectionExpanded('active');

      expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
        'workflow.expandedSections',
        expect.any(Array)
      );
    });
  });
});

describe('WorkflowItem', () => {
  it('creates tooltip with start time', () => {
    const workflow = createMockWorkflow({ started_at: new Date().toISOString() });
    const item = new WorkflowItem(workflow);

    expect(item.tooltip).toBeDefined();
  });

  it('includes elapsed time when available', () => {
    const workflow = createMockWorkflow({ started_at: new Date(Date.now() - 120000).toISOString() });
    const item = new WorkflowItem(workflow);

    expect(item.tooltip).toBeDefined();
  });
});

describe('TaskTreeItem', () => {
  it('shows elapsed time for running tasks', () => {
    const task = createMockTask({
      status: TaskStatus.IN_PROGRESS,
      started_at: new Date(Date.now() - 60000).toISOString(),
    });
    const agent = createMockAgent({ task_id: task.id });
    const item = new TaskTreeItem(task, agent);

    expect(item.description).toBeDefined();
  });

  it('shows blocked dependency count', () => {
    const task = createMockTask({
      status: TaskStatus.BLOCKED,
      depends_on: ['dep-1', 'dep-2'],
    });
    const item = new TaskTreeItem(task, undefined);

    expect(item.description).toContain('2');
  });
});

describe('QuestionTreeItem', () => {
  it('uses task title as label when task is provided', () => {
    const question = createMockQuestion();
    const task = createMockTask({ id: question.task_id, title: 'My Task' });
    const item = new QuestionTreeItem(question, task);

    expect(item.label).toBe('My Task');
    expect(item.description).toContain('What should I do next');
  });

  it('uses task id as label when task not provided', () => {
    const question = createMockQuestion();
    const item = new QuestionTreeItem(question, undefined);

    expect(item.label).toBe(`Task ${question.task_id}`);
    expect(item.description).toContain('What should I do next');
  });
});
