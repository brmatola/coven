import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CovenStatusBar } from './CovenStatusBar';
import { CovenSession } from '../session/CovenSession';
import { CovenState } from '../shared/types';
import { window } from 'vscode';

// Mock CovenSession
vi.mock('../session/CovenSession', () => ({
  CovenSession: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    off: vi.fn(),
    getState: vi.fn(),
  })),
}));

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
      agentPermissions: {
        allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
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

describe('CovenStatusBar', () => {
  let statusBar: CovenStatusBar;
  let mockSession: CovenSession;

  beforeEach(() => {
    vi.clearAllMocks();
    statusBar = new CovenStatusBar();
    mockSession = new CovenSession('/mock/workspace');
  });

  afterEach(() => {
    statusBar.dispose();
  });

  describe('constructor', () => {
    it('creates status bar item', () => {
      expect(window.createStatusBarItem).toHaveBeenCalled();
    });

    it('shows inactive state initially', () => {
      const item = statusBar.getStatusBarItem();
      expect(item.text).toBe('$(circle-outline) Coven: Inactive');
    });

    it('shows status bar item', () => {
      const item = statusBar.getStatusBarItem();
      expect(item.show).toHaveBeenCalled();
    });
  });

  describe('setSession', () => {
    beforeEach(() => {
      // Ensure session has a default state
      (mockSession.getState as ReturnType<typeof vi.fn>).mockReturnValue(createMockState());
    });

    it('subscribes to state changes', () => {
      statusBar.setSession(mockSession);
      expect(mockSession.on).toHaveBeenCalledWith('state:changed', expect.any(Function));
    });

    it('unsubscribes from previous session', () => {
      statusBar.setSession(mockSession);
      statusBar.setSession(null);
      expect(mockSession.off).toHaveBeenCalled();
    });

    it('updates to inactive when session is null', () => {
      statusBar.setSession(mockSession);
      statusBar.setSession(null);

      const item = statusBar.getStatusBarItem();
      expect(item.text).toBe('$(circle-outline) Coven: Inactive');
    });

    it('updates based on initial session state', () => {
      (mockSession.getState as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockState({ sessionStatus: 'active' })
      );

      statusBar.setSession(mockSession);

      const item = statusBar.getStatusBarItem();
      expect(item.text).toContain('Coven: Active');
    });
  });

  describe('state updates', () => {
    it('shows starting state', () => {
      (mockSession.getState as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockState({ sessionStatus: 'starting' })
      );

      statusBar.setSession(mockSession);

      const item = statusBar.getStatusBarItem();
      expect(item.text).toBe('$(sync~spin) Coven: Starting...');
    });

    it('shows stopping state', () => {
      (mockSession.getState as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockState({ sessionStatus: 'stopping' })
      );

      statusBar.setSession(mockSession);

      const item = statusBar.getStatusBarItem();
      expect(item.text).toBe('$(sync~spin) Coven: Stopping...');
    });

    it('shows paused state', () => {
      (mockSession.getState as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockState({ sessionStatus: 'paused' })
      );

      statusBar.setSession(mockSession);

      const item = statusBar.getStatusBarItem();
      expect(item.text).toBe('$(debug-pause) Coven: Paused');
    });

    it('shows working task count', () => {
      (mockSession.getState as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockState({
          tasks: {
            ready: [],
            working: [
              {
                id: 'task-1',
                title: 'Task 1',
                description: '',
                status: 'working',
                priority: 'medium',
                dependencies: [],
                sourceId: 'manual',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
              {
                id: 'task-2',
                title: 'Task 2',
                description: '',
                status: 'working',
                priority: 'medium',
                dependencies: [],
                sourceId: 'manual',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
            ],
            review: [],
            done: [],
            blocked: [],
          },
        })
      );

      statusBar.setSession(mockSession);

      const item = statusBar.getStatusBarItem();
      expect(item.text).toContain('2 working');
    });

    it('shows review task count', () => {
      (mockSession.getState as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockState({
          tasks: {
            ready: [],
            working: [],
            review: [
              {
                id: 'task-1',
                title: 'Task 1',
                description: '',
                status: 'review',
                priority: 'medium',
                dependencies: [],
                sourceId: 'manual',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
            ],
            done: [],
            blocked: [],
          },
        })
      );

      statusBar.setSession(mockSession);

      const item = statusBar.getStatusBarItem();
      expect(item.text).toContain('1 review');
    });

    it('shows pending questions count', () => {
      (mockSession.getState as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockState({
          pendingQuestions: [
            {
              familiarId: 'task-1',
              taskId: 'task-1',
              question: 'Test?',
              askedAt: Date.now(),
            },
          ],
        })
      );

      statusBar.setSession(mockSession);

      const item = statusBar.getStatusBarItem();
      expect(item.text).toContain('1 awaiting response');
    });
  });

  describe('dispose', () => {
    beforeEach(() => {
      // Ensure session has a default state
      (mockSession.getState as ReturnType<typeof vi.fn>).mockReturnValue(createMockState());
    });

    it('disposes status bar item', () => {
      const item = statusBar.getStatusBarItem();
      statusBar.dispose();

      expect(item.dispose).toHaveBeenCalled();
    });

    it('unsubscribes from session', () => {
      statusBar.setSession(mockSession);
      statusBar.dispose();

      expect(mockSession.off).toHaveBeenCalled();
    });
  });

  describe('getStatusBarItem', () => {
    it('returns the status bar item', () => {
      const item = statusBar.getStatusBarItem();
      expect(item).toBeDefined();
      expect(item.show).toBeDefined();
    });
  });
});
