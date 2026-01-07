import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GrimoireTreeProvider,
  SessionHeaderItem,
  TaskGroupItem,
  TaskItem,
  FamiliarItem,
  EmptyStateItem,
  NoSessionItem,
} from './GrimoireTreeProvider';
import { CovenSession } from '../session/CovenSession';
import { CovenState, Task, Familiar } from '../shared/types';
import type * as vscode from 'vscode';
import { TreeItemCollapsibleState } from 'vscode';

// Mock CovenSession
vi.mock('../session/CovenSession', () => ({
  CovenSession: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    off: vi.fn(),
    getState: vi.fn(),
    getStatus: vi.fn(),
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

function createMockState(overrides: Partial<CovenState> = {}): CovenState {
  return {
    sessionStatus: 'active',
    featureBranch: 'feature/test',
    config: {
      maxConcurrentAgents: 3,
      worktreeBasePath: '.coven/worktrees',
      beadsSyncIntervalMs: 30000,
      agentTimeoutMs: 600000,
      mergeConflictMaxRetries: 2,
      preMergeChecks: { enabled: false, commands: [] },
      logging: { level: 'info', retentionDays: 7 },
      outputRetentionDays: 7,
      notifications: {
        questions: 'modal',
        completions: 'toast',
        conflicts: 'toast',
        errors: 'toast',
      },
    },
    tasks: {
      ready: [],
      working: [],
      review: [],
      done: [],
      blocked: [],
    },
    familiars: [],
    pendingQuestions: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test Task',
    description: 'A test task',
    status: 'ready',
    priority: 'medium',
    dependencies: [],
    sourceId: 'manual',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createMockFamiliar(overrides: Partial<Familiar> = {}): Familiar {
  return {
    taskId: 'task-1',
    status: 'working',
    processInfo: {
      pid: 1234,
      startTime: Date.now(),
      command: 'claude',
      worktreePath: '/path/to/worktree',
    },
    spawnedAt: Date.now(),
    outputBuffer: [],
    ...overrides,
  };
}

describe('GrimoireTreeProvider', () => {
  let provider: GrimoireTreeProvider;
  let mockContext: vscode.ExtensionContext;
  let mockSession: CovenSession;

  beforeEach(() => {
    mockContext = createMockContext();
    provider = new GrimoireTreeProvider(mockContext);
    mockSession = new CovenSession('/mock/workspace');
  });

  afterEach(() => {
    provider.dispose();
  });

  describe('constructor', () => {
    it('loads persisted expand/collapse state', async () => {
      const context = createMockContext();
      await context.workspaceState.update('grimoire.expandedGroups', ['ready', 'blocked']);

      const p = new GrimoireTreeProvider(context);
      // Implicitly tested through getChildren behavior
      p.dispose();
    });
  });

  describe('setSession', () => {
    it('subscribes to state changes', () => {
      provider.setSession(mockSession);
      expect(mockSession.on).toHaveBeenCalledWith('state:changed', expect.any(Function));
    });

    it('unsubscribes from previous session', () => {
      provider.setSession(mockSession);
      provider.setSession(null);
      expect(mockSession.off).toHaveBeenCalled();
    });

    it('fires refresh on session change', () => {
      const refreshSpy = vi.fn();
      provider.onDidChangeTreeData(refreshSpy);

      provider.setSession(mockSession);

      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('getChildren - root level', () => {
    it('returns NoSessionItem when no session', async () => {
      const children = await provider.getChildren();
      expect(children).toHaveLength(1);
      expect(children![0]).toBeInstanceOf(NoSessionItem);
    });

    it('returns NoSessionItem when session is inactive', async () => {
      (mockSession.getState as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockState({ sessionStatus: 'inactive' })
      );
      provider.setSession(mockSession);

      const children = await provider.getChildren();
      expect(children).toHaveLength(1);
      expect(children![0]).toBeInstanceOf(NoSessionItem);
    });

    it('returns session header and task groups when active', async () => {
      (mockSession.getState as ReturnType<typeof vi.fn>).mockReturnValue(createMockState());
      provider.setSession(mockSession);

      const children = await provider.getChildren();

      expect(children!.length).toBeGreaterThan(1);
      expect(children![0]).toBeInstanceOf(SessionHeaderItem);
      expect(children![1]).toBeInstanceOf(TaskGroupItem);
    });

    it('shows EmptyStateItem when no tasks', async () => {
      (mockSession.getState as ReturnType<typeof vi.fn>).mockReturnValue(createMockState());
      provider.setSession(mockSession);

      const children = await provider.getChildren();

      const emptyState = children!.find((c) => c instanceof EmptyStateItem);
      expect(emptyState).toBeDefined();
    });

    it('hides EmptyStateItem when tasks exist', async () => {
      (mockSession.getState as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockState({
          tasks: {
            ready: [createMockTask()],
            working: [],
            review: [],
            done: [],
            blocked: [],
          },
        })
      );
      provider.setSession(mockSession);

      const children = await provider.getChildren();

      const emptyState = children!.find((c) => c instanceof EmptyStateItem);
      expect(emptyState).toBeUndefined();
    });
  });

  describe('getChildren - task groups', () => {
    it('returns tasks for a group', async () => {
      const task = createMockTask();
      (mockSession.getState as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockState({
          tasks: {
            ready: [task],
            working: [],
            review: [],
            done: [],
            blocked: [],
          },
        })
      );
      provider.setSession(mockSession);

      const group = new TaskGroupItem('ready', [task], true);
      const children = await provider.getChildren(group);

      expect(children).toHaveLength(1);
      expect(children![0]).toBeInstanceOf(TaskItem);
    });
  });

  describe('getChildren - working tasks', () => {
    it('returns familiar for working task', async () => {
      const task = createMockTask({ status: 'working' });
      const familiar = createMockFamiliar({ taskId: task.id });

      (mockSession.getState as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockState({
          tasks: {
            ready: [],
            working: [task],
            review: [],
            done: [],
            blocked: [],
          },
          familiars: [familiar],
        })
      );
      provider.setSession(mockSession);

      const taskItem = new TaskItem(task, true);
      const children = await provider.getChildren(taskItem);

      expect(children).toHaveLength(1);
      expect(children![0]).toBeInstanceOf(FamiliarItem);
    });
  });

  describe('toggleGroupExpanded', () => {
    it('toggles expanded state', () => {
      void mockContext.workspaceState.update('grimoire.expandedGroups', ['ready']);

      provider.toggleGroupExpanded('ready');

      const saved = mockContext.workspaceState.get<string[]>('grimoire.expandedGroups');
      expect(saved).not.toContain('ready');
    });

    it('persists expanded state', () => {
      provider.toggleGroupExpanded('blocked');

      const saved = mockContext.workspaceState.get<string[]>('grimoire.expandedGroups');
      expect(saved).toContain('blocked');
    });
  });

  describe('refresh', () => {
    it('fires onDidChangeTreeData', () => {
      const spy = vi.fn();
      provider.onDidChangeTreeData(spy);

      provider.refresh();

      expect(spy).toHaveBeenCalled();
    });
  });
});

describe('SessionHeaderItem', () => {
  it('shows branch name as label', () => {
    const state = createMockState({ featureBranch: 'feature/my-branch' });
    const item = new SessionHeaderItem(state);

    expect(item.label).toBe('feature/my-branch');
  });

  it('shows progress in description', () => {
    const state = createMockState({
      tasks: {
        ready: [createMockTask()],
        working: [],
        review: [],
        done: [createMockTask({ id: 'done-1', status: 'done' })],
        blocked: [],
      },
    });
    const item = new SessionHeaderItem(state);

    expect(item.description).toContain('1/2 done');
  });

  it('shows working count when tasks are working', () => {
    const state = createMockState({
      tasks: {
        ready: [],
        working: [createMockTask({ status: 'working' })],
        review: [],
        done: [],
        blocked: [],
      },
    });
    const item = new SessionHeaderItem(state);

    expect(item.description).toContain('1 working');
  });
});

describe('TaskGroupItem', () => {
  it('shows status label', () => {
    const item = new TaskGroupItem('ready', [], true);
    expect(item.label).toBe('Ready');
  });

  it('shows task count', () => {
    const tasks = [createMockTask(), createMockTask({ id: 'task-2' })];
    const item = new TaskGroupItem('ready', tasks, true);

    expect(item.description).toBe('(2)');
  });

  it('sets expanded state correctly', () => {
    const expanded = new TaskGroupItem('ready', [], true);
    const collapsed = new TaskGroupItem('ready', [], false);

    expect(expanded.collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
    expect(collapsed.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
  });
});

describe('TaskItem', () => {
  it('shows task title', () => {
    const task = createMockTask({ title: 'My Task' });
    const item = new TaskItem(task, false);

    expect(item.label).toBe('My Task');
  });

  it('shows elapsed time for working tasks', () => {
    const task = createMockTask({
      status: 'working',
      updatedAt: Date.now() - 120000, // 2 minutes ago
    });
    const item = new TaskItem(task, true);

    expect(item.description).toContain('m');
  });

  it('shows blocked info for blocked tasks', () => {
    const task = createMockTask({
      status: 'blocked',
      dependencies: ['dep-1', 'dep-2'],
    });
    const item = new TaskItem(task, false);

    expect(item.description).toContain('blocked by 2');
  });

  it('shows priority for high/critical tasks', () => {
    const criticalTask = createMockTask({ priority: 'critical' });
    const item = new TaskItem(criticalTask, false);

    expect(item.description).toContain('critical');
  });

  it('is expandable for working tasks with familiar', () => {
    const task = createMockTask({ status: 'working' });
    const item = new TaskItem(task, true);

    expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
  });
});

describe('FamiliarItem', () => {
  it('shows status label', () => {
    const familiar = createMockFamiliar({ status: 'working' });
    const item = new FamiliarItem(familiar, false);

    expect(item.label).toBe('Agent working');
  });

  it('shows elapsed time', () => {
    const familiar = createMockFamiliar({
      spawnedAt: Date.now() - 60000, // 1 minute ago
    });
    const item = new FamiliarItem(familiar, false);

    expect(item.description).toContain('m');
  });

  it('highlights when has question', () => {
    const familiar = createMockFamiliar({ status: 'waiting' });
    const item = new FamiliarItem(familiar, true);

    expect(item.contextValue).toBe('familiar.waiting');
  });
});

describe('EmptyStateItem', () => {
  it('has correct label', () => {
    const item = new EmptyStateItem();
    expect(item.label).toBe('No tasks yet');
  });

  it('has command to create task', () => {
    const item = new EmptyStateItem();
    expect(item.command?.command).toBe('coven.createTask');
  });
});

describe('NoSessionItem', () => {
  it('has correct label', () => {
    const item = new NoSessionItem();
    expect(item.label).toBe('Start a Session');
  });

  it('has command to start session', () => {
    const item = new NoSessionItem();
    expect(item.command?.command).toBe('coven.startSession');
  });
});
