import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { TaskDetailPanel } from './TaskDetailPanel';
import { BeadsTaskSource } from './BeadsTaskSource';
import { Task, TaskStatus } from '../shared/types';

// Store message handler for testing
let messageHandler: ((msg: unknown) => void) | null = null;
let disposeHandler: (() => void) | null = null;

// Mock webview
const mockWebview = {
  html: '',
  postMessage: vi.fn().mockResolvedValue(true),
  onDidReceiveMessage: vi.fn((handler) => {
    messageHandler = handler;
    return { dispose: vi.fn() };
  }),
  asWebviewUri: vi.fn((uri) => uri),
  cspSource: 'https://test',
};

// Mock panel
const mockPanel = {
  webview: mockWebview,
  title: '',
  onDidDispose: vi.fn((handler) => {
    disposeHandler = handler;
    return { dispose: vi.fn() };
  }),
  reveal: vi.fn(),
  dispose: vi.fn(),
};

// Mock vscode module
vi.mock('vscode', () => {
  return {
    window: {
      createWebviewPanel: vi.fn(() => mockPanel),
      showErrorMessage: vi.fn(),
      showWarningMessage: vi.fn().mockResolvedValue(undefined),
      showInformationMessage: vi.fn(),
      activeTextEditor: { viewColumn: 1 },
    },
    Uri: {
      joinPath: vi.fn((uri, ...segments) => ({
        fsPath: `${uri?.fsPath ?? '/ext'}/${segments.join('/')}`,
        toString: () => `${uri?.fsPath ?? '/ext'}/${segments.join('/')}`,
      })),
    },
    ViewColumn: {
      One: 1,
      Two: 2,
      Active: -1,
    },
  };
});

// Mock logger
vi.mock('../shared/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test Task',
    description: 'Test description',
    status: 'ready' as TaskStatus,
    priority: 2,
    dependencies: [],
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('TaskDetailPanel', () => {
  let mockBeadsTaskSource: Partial<BeadsTaskSource>;
  let extensionUri: vscode.Uri;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    messageHandler = null;
    disposeHandler = null;
    mockPanel.title = '';

    // Setup mock BeadsTaskSource
    mockBeadsTaskSource = {
      getTask: vi.fn().mockReturnValue(undefined),
      updateTask: vi.fn().mockResolvedValue(true),
      updateTaskStatus: vi.fn().mockResolvedValue({}),
      closeTask: vi.fn().mockResolvedValue(true),
      on: vi.fn().mockReturnThis(),
      off: vi.fn().mockReturnThis(),
      emit: vi.fn(),
    };

    // Setup extension URI
    extensionUri = {
      fsPath: '/test/extension',
      toString: () => '/test/extension',
    } as vscode.Uri;
  });

  afterEach(() => {
    // Clean up any panels by triggering dispose
    if (disposeHandler) {
      disposeHandler();
    }
  });

  describe('createOrShow', () => {
    it('should show error when task not found', async () => {
      vi.mocked(mockBeadsTaskSource.getTask!).mockReturnValue(undefined);

      const result = await TaskDetailPanel.createOrShow(
        extensionUri,
        mockBeadsTaskSource as BeadsTaskSource,
        'nonexistent-task'
      );

      expect(result).toBeNull();
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Task not found: nonexistent-task'
      );
    });

    it('should create panel when task exists', async () => {
      const task = createMockTask();
      vi.mocked(mockBeadsTaskSource.getTask!).mockReturnValue(task);

      const panel = await TaskDetailPanel.createOrShow(
        extensionUri,
        mockBeadsTaskSource as BeadsTaskSource,
        'task-1'
      );

      expect(panel).not.toBeNull();
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'covenTaskDetail',
        'Task: Test Task',
        1,
        expect.objectContaining({
          enableScripts: true,
          retainContextWhenHidden: true,
        })
      );
    });

    it('should truncate long task titles', async () => {
      const task = createMockTask({
        title: 'This is a very long task title that should be truncated',
      });
      vi.mocked(mockBeadsTaskSource.getTask!).mockReturnValue(task);

      await TaskDetailPanel.createOrShow(
        extensionUri,
        mockBeadsTaskSource as BeadsTaskSource,
        'task-1'
      );

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'covenTaskDetail',
        'Task: This is a very long task title...',
        expect.any(Number),
        expect.any(Object)
      );
    });

    it('should reveal existing panel instead of creating new one', async () => {
      const task = createMockTask();
      vi.mocked(mockBeadsTaskSource.getTask!).mockReturnValue(task);

      // Create first panel
      const panel1 = await TaskDetailPanel.createOrShow(
        extensionUri,
        mockBeadsTaskSource as BeadsTaskSource,
        'task-1'
      );

      // Try to create second panel for same task
      const panel2 = await TaskDetailPanel.createOrShow(
        extensionUri,
        mockBeadsTaskSource as BeadsTaskSource,
        'task-1'
      );

      expect(panel1).toBe(panel2);
      expect(mockPanel.reveal).toHaveBeenCalled();
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    });

    it('should register sync listener on beadsTaskSource', async () => {
      const task = createMockTask();
      vi.mocked(mockBeadsTaskSource.getTask!).mockReturnValue(task);

      await TaskDetailPanel.createOrShow(
        extensionUri,
        mockBeadsTaskSource as BeadsTaskSource,
        'task-1'
      );

      expect(mockBeadsTaskSource.on).toHaveBeenCalledWith('sync', expect.any(Function));
    });
  });

  describe('get', () => {
    it('should return undefined for non-existent panel', () => {
      const result = TaskDetailPanel.get('nonexistent-panel-id');
      expect(result).toBeUndefined();
    });

    it('should return panel for existing task', async () => {
      const task = createMockTask();
      vi.mocked(mockBeadsTaskSource.getTask!).mockReturnValue(task);

      await TaskDetailPanel.createOrShow(
        extensionUri,
        mockBeadsTaskSource as BeadsTaskSource,
        'task-1'
      );

      const result = TaskDetailPanel.get('task-1');
      expect(result).toBeDefined();
    });
  });

  describe('message handling', () => {
    beforeEach(async () => {
      const task = createMockTask();
      vi.mocked(mockBeadsTaskSource.getTask!).mockReturnValue(task);

      await TaskDetailPanel.createOrShow(
        extensionUri,
        mockBeadsTaskSource as BeadsTaskSource,
        'task-1'
      );
    });

    it('should handle ready message and send state', () => {
      messageHandler?.({ type: 'ready' });

      expect(mockWebview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'state',
          payload: expect.objectContaining({
            task: expect.objectContaining({ id: 'task-1' }),
            isLoading: false,
            isSaving: false,
          }),
        })
      );
    });

    it('should handle save message and update task', async () => {
      const update = { title: 'Updated Title' };
      messageHandler?.({ type: 'save', payload: update });

      // Wait for async handling
      await vi.waitFor(() => {
        expect(mockBeadsTaskSource.updateTask).toHaveBeenCalledWith('task-1', update);
      });
    });

    it('should handle save failure', async () => {
      vi.mocked(mockBeadsTaskSource.updateTask!).mockResolvedValue(false);

      messageHandler?.({ type: 'save', payload: { title: 'Updated' } });

      await vi.waitFor(() => {
        expect(mockWebview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            payload: expect.objectContaining({
              error: 'Failed to save changes',
            }),
          })
        );
      });
    });

    it('should handle startTask message', async () => {
      messageHandler?.({ type: 'startTask' });

      await vi.waitFor(() => {
        expect(mockBeadsTaskSource.updateTaskStatus).toHaveBeenCalledWith('task-1', 'working');
      });
    });

    it('should show warning when starting non-ready task', async () => {
      const task = createMockTask({ status: 'working' as TaskStatus });
      vi.mocked(mockBeadsTaskSource.getTask!).mockReturnValue(task);

      messageHandler?.({ type: 'startTask' });

      await vi.waitFor(() => {
        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('Task cannot be started');
      });
    });

    it('should handle deleteTask message with confirmation', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Delete' as unknown as undefined);

      messageHandler?.({ type: 'deleteTask' });

      await vi.waitFor(() => {
        expect(mockBeadsTaskSource.closeTask).toHaveBeenCalledWith('task-1', 'Deleted from Coven');
      });
    });

    it('should not delete task when user cancels', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

      messageHandler?.({ type: 'deleteTask' });

      await vi.waitFor(() => {
        expect(vscode.window.showWarningMessage).toHaveBeenCalled();
      });

      expect(mockBeadsTaskSource.closeTask).not.toHaveBeenCalled();
    });

    it('should handle unrecognized message type', () => {
      messageHandler?.({ type: 'unknown-type' });
      // Should not throw, just log warning
    });
  });

  describe('blocking tasks', () => {
    it('should include blocking task info in state', async () => {
      const blockingTask = createMockTask({ id: 'blocking-1', title: 'Blocker' });
      const task = createMockTask({ dependencies: ['blocking-1'] });

      vi.mocked(mockBeadsTaskSource.getTask!)
        .mockImplementation((id) => {
          if (id === 'task-1') return task;
          if (id === 'blocking-1') return blockingTask;
          return undefined;
        });

      await TaskDetailPanel.createOrShow(
        extensionUri,
        mockBeadsTaskSource as BeadsTaskSource,
        'task-1'
      );

      messageHandler?.({ type: 'ready' });

      expect(mockWebview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            blockingTasks: expect.arrayContaining([
              expect.objectContaining({
                id: 'blocking-1',
                title: 'Blocker',
              }),
            ]),
          }),
        })
      );
    });
  });

  describe('dispose', () => {
    it('should remove panel from registry on dispose', async () => {
      const task = createMockTask();
      vi.mocked(mockBeadsTaskSource.getTask!).mockReturnValue(task);

      await TaskDetailPanel.createOrShow(
        extensionUri,
        mockBeadsTaskSource as BeadsTaskSource,
        'task-1'
      );

      expect(TaskDetailPanel.get('task-1')).toBeDefined();

      // Trigger dispose
      disposeHandler?.();

      expect(TaskDetailPanel.get('task-1')).toBeUndefined();
    });

    it('should unregister task change listener on dispose', async () => {
      const task = createMockTask();
      vi.mocked(mockBeadsTaskSource.getTask!).mockReturnValue(task);

      await TaskDetailPanel.createOrShow(
        extensionUri,
        mockBeadsTaskSource as BeadsTaskSource,
        'task-1'
      );

      disposeHandler?.();

      expect(mockBeadsTaskSource.off).toHaveBeenCalledWith('sync', expect.any(Function));
    });
  });
});
