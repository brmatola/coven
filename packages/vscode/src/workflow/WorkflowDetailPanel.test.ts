import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { WorkflowDetailPanel } from './WorkflowDetailPanel';
import { DaemonClient } from '../daemon/client';
import { SSEClient } from '../daemon/sse';

// Mock daemon client
vi.mock('../daemon/client', () => ({
  DaemonClient: vi.fn().mockImplementation(() => ({
    getState: vi.fn(),
  })),
}));

// Mock logger
vi.mock('../shared/logger', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('WorkflowDetailPanel', () => {
  let mockDaemonClient: {
    getState: ReturnType<typeof vi.fn>;
  };
  let mockSSEClient: {
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    connectionState: string;
    eventListeners: Map<string, Set<(...args: unknown[]) => void>>;
  };
  let mockPanel: ReturnType<typeof createMockPanel>;
  // Map from workflowId to handlers
  const messageHandlers = new Map<string, (message: unknown) => void>();
  const disposeHandlers = new Map<string, () => void>();
  let createdPanels: WorkflowDetailPanel[] = [];
  let currentWorkflowId = 'workflow-1';

  function createMockPanel(workflowId: string) {
    return {
      webview: {
        html: '',
        onDidReceiveMessage: vi.fn(
          (callback: (message: unknown) => void, _thisArg?: unknown, _disposables?: unknown[]) => {
            messageHandlers.set(workflowId, callback);
            return { dispose: vi.fn() };
          }
        ),
        postMessage: vi.fn().mockResolvedValue(true),
        asWebviewUri: vi.fn((uri: unknown) => uri),
        cspSource: 'mock-csp',
      },
      reveal: vi.fn(),
      dispose: vi.fn(),
      onDidDispose: vi.fn(
        (callback: () => void, _thisArg?: unknown, _disposables?: unknown[]) => {
          disposeHandlers.set(workflowId, callback);
          return { dispose: vi.fn() };
        }
      ),
      title: '',
    };
  }

  function createMockSSEClient() {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    return {
      eventListeners: listeners,
      connectionState: 'connected',
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!listeners.has(event)) {
          listeners.set(event, new Set());
        }
        listeners.get(event)!.add(handler);
      }),
      off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        listeners.get(event)?.delete(handler);
      }),
      emit(event: string, ...args: unknown[]) {
        listeners.get(event)?.forEach((handler) => handler(...args));
      },
      listenerCount(event: string) {
        return listeners.get(event)?.size ?? 0;
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    messageHandlers.clear();
    disposeHandlers.clear();
    createdPanels = [];
    currentWorkflowId = 'workflow-1';

    mockDaemonClient = {
      getState: vi.fn().mockResolvedValue({
        workflow: {
          id: 'workflow-1',
          status: 'running',
          startedAt: Date.now(),
        },
        tasks: [
          { id: 'task-1', title: 'First Task', status: 'done' },
          { id: 'task-2', title: 'Second Task', status: 'working' },
          { id: 'task-3', title: 'Third Task', status: 'ready' },
        ],
        agents: [],
        questions: [],
        timestamp: Date.now(),
      }),
    };

    mockSSEClient = createMockSSEClient();
    mockPanel = createMockPanel('workflow-1');

    vi.mocked(vscode.window.createWebviewPanel).mockImplementation(
      (_viewType, _title, _showOptions, _options) => {
        // Create a new mock panel for the current workflow ID
        mockPanel = createMockPanel(currentWorkflowId);
        return mockPanel as unknown as vscode.WebviewPanel;
      }
    );
  });

  afterEach(() => {
    // Clean up panels by triggering dispose for each workflow
    disposeHandlers.forEach((handler) => {
      handler();
    });
  });

  function createPanel(workflowId = 'workflow-1'): WorkflowDetailPanel | null {
    currentWorkflowId = workflowId;
    const panel = WorkflowDetailPanel.createOrShow(
      new vscode.Uri('/test'),
      mockDaemonClient as unknown as DaemonClient,
      mockSSEClient as unknown as SSEClient,
      workflowId
    );
    if (panel) {
      createdPanels.push(panel);
    }
    return panel;
  }

  function getMessageHandler(workflowId = 'workflow-1'): ((message: unknown) => void) | undefined {
    return messageHandlers.get(workflowId);
  }

  function getDisposeHandler(workflowId = 'workflow-1'): (() => void) | undefined {
    return disposeHandlers.get(workflowId);
  }

  describe('createOrShow', () => {
    it('should create a new panel', () => {
      const panel = createPanel();

      expect(panel).toBeDefined();
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'covenWorkflowDetail',
        expect.stringContaining('Workflow:'),
        expect.any(Number),
        expect.objectContaining({
          enableScripts: true,
          retainContextWhenHidden: true,
        })
      );
    });

    it('should return existing panel if already open', () => {
      const panel1 = createPanel();

      const panel2 = createPanel();

      expect(panel1).toBe(panel2);
      expect(mockPanel.reveal).toHaveBeenCalled();
    });

    it('should create different panels for different workflows', () => {
      const panel1 = createPanel('workflow-1');

      // Reset mock for second call with new messageHandler/disposeHandler
      const secondMockPanel = createMockPanel();
      vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
        secondMockPanel as unknown as vscode.WebviewPanel
      );

      const panel2 = createPanel('workflow-2');

      expect(panel1).not.toBe(panel2);
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
    });
  });

  describe('get', () => {
    it('should return existing panel', () => {
      createPanel();

      const panel = WorkflowDetailPanel.get('workflow-1');
      expect(panel).toBeDefined();
    });

    it('should return undefined for non-existent panel', () => {
      const panel = WorkflowDetailPanel.get('non-existent');
      expect(panel).toBeUndefined();
    });
  });

  describe('ready message', () => {
    it('should fetch workflow on ready', async () => {
      createPanel();

      // Simulate ready message
      getMessageHandler()?.({ type: 'ready' });

      // Wait for async operation
      await vi.waitFor(() => {
        expect(mockDaemonClient.getState).toHaveBeenCalled();
      });
    });

    it('should send state after fetch', async () => {
      createPanel();

      getMessageHandler()?.({ type: 'ready' });

      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              workflow: expect.objectContaining({
                id: 'workflow-1',
                status: 'running',
              }),
              isLoading: false,
              error: null,
            }),
          })
        );
      });
    });

    it('should handle fetch error', async () => {
      mockDaemonClient.getState.mockRejectedValue(new Error('Connection failed'));

      createPanel();

      getMessageHandler()?.({ type: 'ready' });

      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              workflow: null,
              isLoading: false,
              error: expect.stringContaining('Failed to load workflow'),
            }),
          })
        );
      });
    });
  });

  describe('workflow actions', () => {
    it('should handle pause action', async () => {
      createPanel();

      // First fetch workflow and wait for it to load
      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              workflow: expect.objectContaining({ status: 'running' }),
            }),
          })
        );
      });

      // Then pause
      getMessageHandler()?.({ type: 'pause' });

      await vi.waitFor(() => {
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
          'Workflow pause requested'
        );
      });
    });

    it('should show warning when pausing non-running workflow', async () => {
      mockDaemonClient.getState.mockResolvedValue({
        workflow: { id: 'workflow-1', status: 'paused' },
        tasks: [],
        agents: [],
        questions: [],
        timestamp: Date.now(),
      });

      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.getState).toHaveBeenCalled();
      });

      getMessageHandler()?.({ type: 'pause' });

      await vi.waitFor(() => {
        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
          'Workflow cannot be paused'
        );
      });
    });

    it('should handle resume action', async () => {
      mockDaemonClient.getState.mockResolvedValue({
        workflow: { id: 'workflow-1', status: 'paused' },
        tasks: [],
        agents: [],
        questions: [],
        timestamp: Date.now(),
      });

      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              workflow: expect.objectContaining({ status: 'paused' }),
            }),
          })
        );
      });

      getMessageHandler()?.({ type: 'resume' });

      await vi.waitFor(() => {
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
          'Workflow resume requested'
        );
      });
    });

    it('should handle cancel action with confirmation', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
        'Cancel Workflow' as unknown as vscode.MessageItem
      );

      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              workflow: expect.objectContaining({ status: 'running' }),
            }),
          })
        );
      });

      getMessageHandler()?.({ type: 'cancel' });

      await vi.waitFor(() => {
        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
          'Cancel this workflow? Running tasks will be stopped.',
          { modal: true },
          'Cancel Workflow'
        );
      });
    });

    it('should not cancel if user does not confirm', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.getState).toHaveBeenCalled();
      });

      getMessageHandler()?.({ type: 'cancel' });

      await vi.waitFor(() => {
        expect(vscode.window.showWarningMessage).toHaveBeenCalled();
      });

      // Should not show success message
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalledWith(
        'Workflow cancellation requested'
      );
    });

    it('should handle retry action', async () => {
      mockDaemonClient.getState.mockResolvedValue({
        workflow: { id: 'workflow-1', status: 'failed' },
        tasks: [],
        agents: [],
        questions: [],
        timestamp: Date.now(),
      });

      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              workflow: expect.objectContaining({ status: 'failed' }),
            }),
          })
        );
      });

      getMessageHandler()?.({ type: 'retry' });

      await vi.waitFor(() => {
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
          'Workflow retry requested'
        );
      });
    });

    it('should handle viewOutput action', async () => {
      createPanel();

      getMessageHandler()?.({ type: 'viewOutput', payload: { stepId: 'task-1' } });

      await vi.waitFor(() => {
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
          'coven.viewFamiliarOutput',
          'task-1'
        );
      });
    });
  });

  describe('SSE events', () => {
    it('should subscribe to SSE events on creation', () => {
      createPanel();

      expect(mockSSEClient.on).toHaveBeenCalledWith('event', expect.any(Function));
      expect(mockSSEClient.listenerCount('event')).toBe(1);
    });

    it('should update workflow status on workflow.completed event', async () => {
      createPanel();

      // First fetch the workflow and wait for it to load
      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              workflow: expect.objectContaining({ status: 'running' }),
            }),
          })
        );
      });

      // Clear postMessage calls to isolate SSE event handling
      mockPanel.webview.postMessage.mockClear();

      // Emit SSE event
      mockSSEClient.emit('event', {
        type: 'workflow.completed',
        data: { workflowId: 'workflow-1', status: 'completed' },
        timestamp: Date.now(),
      });

      // Should update state with completed status
      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              workflow: expect.objectContaining({
                status: 'completed',
              }),
            }),
          })
        );
      });
    });

    it('should update step status on task.completed event', async () => {
      createPanel();

      // First fetch the workflow
      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.getState).toHaveBeenCalled();
      });

      vi.mocked(mockPanel.webview.postMessage).mockClear();

      // Emit SSE event for step status
      mockSSEClient.emit('event', {
        type: 'task.completed',
        data: { workflowId: 'workflow-1', stepId: 'task-2', status: 'completed' },
        timestamp: Date.now(),
      });

      // Should update state
      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalled();
      });
    });

    it('should ignore events for other workflows', async () => {
      createPanel();

      // First fetch the workflow
      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.getState).toHaveBeenCalled();
      });

      vi.mocked(mockPanel.webview.postMessage).mockClear();

      // Emit SSE event for different workflow
      mockSSEClient.emit('event', {
        type: 'workflow.completed',
        data: { workflowId: 'other-workflow', status: 'completed' },
        timestamp: Date.now(),
      });

      // Should not update state
      expect(mockPanel.webview.postMessage).not.toHaveBeenCalled();
    });

    it('should unsubscribe from SSE events on dispose', () => {
      createPanel();

      expect(mockSSEClient.listenerCount('event')).toBe(1);

      // Trigger dispose
      getDisposeHandler()?.();

      expect(mockSSEClient.off).toHaveBeenCalledWith('event', expect.any(Function));
      expect(mockSSEClient.listenerCount('event')).toBe(0);
    });
  });

  describe('available actions', () => {
    it('should return pause and cancel for running workflow', async () => {
      createPanel();

      getMessageHandler()?.({ type: 'ready' });

      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              availableActions: expect.arrayContaining(['pause', 'cancel']),
            }),
          })
        );
      });
    });

    it('should return resume and cancel for paused workflow', async () => {
      mockDaemonClient.getState.mockResolvedValue({
        workflow: { id: 'workflow-1', status: 'paused' },
        tasks: [],
        agents: [],
        questions: [],
        timestamp: Date.now(),
      });

      createPanel();

      getMessageHandler()?.({ type: 'ready' });

      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              availableActions: expect.arrayContaining(['resume', 'cancel']),
            }),
          })
        );
      });
    });

    it('should return retry for failed workflow', async () => {
      mockDaemonClient.getState.mockResolvedValue({
        workflow: { id: 'workflow-1', status: 'failed' },
        tasks: [],
        agents: [],
        questions: [],
        timestamp: Date.now(),
      });

      createPanel();

      getMessageHandler()?.({ type: 'ready' });

      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              availableActions: ['retry'],
            }),
          })
        );
      });
    });

    it('should return no actions for completed workflow', async () => {
      mockDaemonClient.getState.mockResolvedValue({
        workflow: { id: 'workflow-1', status: 'completed' },
        tasks: [],
        agents: [],
        questions: [],
        timestamp: Date.now(),
      });

      createPanel();

      getMessageHandler()?.({ type: 'ready' });

      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              availableActions: [],
            }),
          })
        );
      });
    });
  });

  describe('step status mapping', () => {
    it('should map task statuses to step statuses correctly', async () => {
      mockDaemonClient.getState.mockResolvedValue({
        workflow: { id: 'workflow-1', status: 'running' },
        tasks: [
          { id: 'task-1', title: 'Done Task', status: 'done' },
          { id: 'task-2', title: 'Working Task', status: 'working' },
          { id: 'task-3', title: 'Ready Task', status: 'ready' },
          { id: 'task-4', title: 'Blocked Task', status: 'blocked' },
          { id: 'task-5', title: 'Review Task', status: 'review' },
        ],
        agents: [],
        questions: [],
        timestamp: Date.now(),
      });

      createPanel();

      getMessageHandler()?.({ type: 'ready' });

      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              workflow: expect.objectContaining({
                steps: expect.arrayContaining([
                  expect.objectContaining({ id: 'task-1', status: 'completed' }),
                  expect.objectContaining({ id: 'task-2', status: 'running' }),
                  expect.objectContaining({ id: 'task-3', status: 'pending' }),
                  expect.objectContaining({ id: 'task-4', status: 'pending' }),
                  expect.objectContaining({ id: 'task-5', status: 'completed' }),
                ]),
              }),
            }),
          })
        );
      });
    });
  });

  describe('dispose', () => {
    it('should remove panel from static map on dispose', () => {
      createPanel();

      expect(WorkflowDetailPanel.get('workflow-1')).toBeDefined();

      getDisposeHandler()?.();

      expect(WorkflowDetailPanel.get('workflow-1')).toBeUndefined();
    });
  });
});
