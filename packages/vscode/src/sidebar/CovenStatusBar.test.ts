import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CovenStatusBar } from './CovenStatusBar';
import { StateCache, SessionState, WorkflowState } from '../daemon/cache';
import { WorkflowStatus } from '@coven/client-ts';
import { window } from 'vscode';

// Mock StateCache
vi.mock('../daemon/cache', () => ({
  StateCache: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    off: vi.fn(),
    getSessionState: vi.fn(),
    getWorkflow: vi.fn(),
    getQuestions: vi.fn(),
  })),
}));

function createMockSessionState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    active: true,
    ...overrides,
  };
}

function createMockWorkflowState(
  overrides: Partial<WorkflowState> = {}
): WorkflowState {
  return {
    id: 'wf-1',
    status: WorkflowStatus.RUNNING,
    ...overrides,
  };
}

describe('CovenStatusBar', () => {
  let statusBar: CovenStatusBar;
  let mockStateCache: StateCache;

  beforeEach(() => {
    vi.clearAllMocks();
    statusBar = new CovenStatusBar();
    mockStateCache = new StateCache();
  });

  afterEach(() => {
    statusBar.dispose();
  });

  describe('constructor', () => {
    it('creates status bar item', () => {
      expect(window.createStatusBarItem).toHaveBeenCalled();
    });

    it('shows disconnected state initially', () => {
      const item = statusBar.getStatusBarItem();
      expect(item.text).toBe('$(circle-outline) covend: disconnected');
    });

    it('shows status bar item', () => {
      const item = statusBar.getStatusBarItem();
      expect(item.show).toHaveBeenCalled();
    });
  });

  describe('setStateCache', () => {
    beforeEach(() => {
      // Ensure cache has default state
      (mockStateCache.getSessionState as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockSessionState()
      );
      (mockStateCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockStateCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
    });

    it('subscribes to workflow changes', () => {
      statusBar.setStateCache(mockStateCache);
      expect(mockStateCache.on).toHaveBeenCalledWith('workflows.changed', expect.any(Function));
    });

    it('unsubscribes from previous cache', () => {
      statusBar.setStateCache(mockStateCache);
      statusBar.setStateCache(null);
      expect(mockStateCache.off).toHaveBeenCalled();
    });

    it('updates to disconnected when cache is null', () => {
      statusBar.setStateCache(mockStateCache);
      statusBar.setStateCache(null);

      const item = statusBar.getStatusBarItem();
      expect(item.text).toBe('$(circle-outline) covend: disconnected');
    });

    it('updates based on initial session state', () => {
      (mockStateCache.getSessionState as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockSessionState({ active: true })
      );

      statusBar.setStateCache(mockStateCache);

      const item = statusBar.getStatusBarItem();
      expect(item.text).toContain('covend:');
    });
  });

  describe('state updates', () => {
    beforeEach(() => {
      (mockStateCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockStateCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
    });

    it('shows inactive state when session not active', () => {
      (mockStateCache.getSessionState as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockSessionState({ active: false })
      );

      statusBar.setStateCache(mockStateCache);

      const item = statusBar.getStatusBarItem();
      expect(item.text).toBe('$(circle-outline) Coven: Inactive');
    });

    it('shows active workflow count', () => {
      (mockStateCache.getSessionState as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockSessionState({ active: true })
      );
      (mockStateCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockWorkflowState({ id: 'wf-1', status: WorkflowStatus.RUNNING })
      );

      statusBar.setStateCache(mockStateCache);

      const item = statusBar.getStatusBarItem();
      expect(item.text).toContain('1 active');
    });

    it('shows pending workflow count', () => {
      (mockStateCache.getSessionState as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockSessionState({ active: true })
      );
      (mockStateCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockWorkflowState({ id: 'wf-1', status: WorkflowStatus.PENDING_MERGE })
      );

      statusBar.setStateCache(mockStateCache);

      const item = statusBar.getStatusBarItem();
      expect(item.text).toContain('1 pending');
    });

    it('shows pending questions count', () => {
      (mockStateCache.getSessionState as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockSessionState({ active: true })
      );
      (mockStateCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'q-1', task_id: 'task-1', text: 'Test?', asked_at: new Date().toISOString() },
      ]);

      statusBar.setStateCache(mockStateCache);

      const item = statusBar.getStatusBarItem();
      expect(item.text).toContain('1 awaiting response');
    });
  });

  describe('dispose', () => {
    beforeEach(() => {
      // Ensure cache has default state
      (mockStateCache.getSessionState as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockSessionState()
      );
      (mockStateCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockStateCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
    });

    it('disposes status bar item', () => {
      const item = statusBar.getStatusBarItem();
      statusBar.dispose();

      expect(item.dispose).toHaveBeenCalled();
    });

    it('unsubscribes from cache', () => {
      statusBar.setStateCache(mockStateCache);
      statusBar.dispose();

      expect(mockStateCache.off).toHaveBeenCalled();
    });
  });

  describe('getStatusBarItem', () => {
    it('returns the status bar item', () => {
      const item = statusBar.getStatusBarItem();
      expect(item).toBeDefined();
      expect(item.show).toBeDefined();
    });
  });

  describe('setNotInitialized', () => {
    it('shows not initialized text with warning icon', () => {
      statusBar.setNotInitialized();

      const item = statusBar.getStatusBarItem();
      expect(item.text).toBe('$(warning) Coven: not initialized');
    });

    it('sets command to show setup', () => {
      statusBar.setNotInitialized();

      const item = statusBar.getStatusBarItem();
      expect(item.command).toBe('coven.showSetup');
    });

    it('shows tooltip with initialization instructions', () => {
      statusBar.setNotInitialized();

      const item = statusBar.getStatusBarItem();
      expect(item.tooltip).toBeDefined();
    });
  });

  describe('setConnected', () => {
    beforeEach(() => {
      (mockStateCache.getSessionState as ReturnType<typeof vi.fn>).mockReturnValue(
        createMockSessionState()
      );
      (mockStateCache.getWorkflow as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockStateCache.getQuestions as ReturnType<typeof vi.fn>).mockReturnValue([]);
    });

    it('updates from session when cache is set', () => {
      statusBar.setStateCache(mockStateCache);
      statusBar.setConnected();

      const item = statusBar.getStatusBarItem();
      expect(item.text).toContain('covend:');
    });

    it('shows connected text when no cache', () => {
      statusBar.setConnected();

      const item = statusBar.getStatusBarItem();
      expect(item.text).toBe('$(broadcast) covend: 0 active, 0 pending');
    });
  });

  describe('setDisconnected', () => {
    it('shows disconnected text with warning icon', () => {
      statusBar.setDisconnected();

      const item = statusBar.getStatusBarItem();
      expect(item.text).toBe('$(warning) covend: disconnected');
    });

    it('sets command to start session', () => {
      statusBar.setDisconnected();

      const item = statusBar.getStatusBarItem();
      expect(item.command).toBe('coven.startSession');
    });

    it('shows tooltip with connection lost message', () => {
      statusBar.setDisconnected();

      const item = statusBar.getStatusBarItem();
      expect(item.tooltip).toBeDefined();
    });
  });
});
