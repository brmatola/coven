import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { WorkflowDetailPanel } from './WorkflowDetailPanel';
import { DaemonClient } from '../daemon/client';
import type { SSEClient } from '@coven/client-ts';

// Mock daemon client
vi.mock('../daemon/client', () => ({
  DaemonClient: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    getAgentOutput: vi.fn(),
  })),
}));

// Mock logger
vi.mock('../shared/logger', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('WorkflowDetailPanel', () => {
  let mockDaemonClient: {
    get: ReturnType<typeof vi.fn>;
    getAgentOutput: ReturnType<typeof vi.fn>;
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
      get: vi.fn().mockResolvedValue({
        workflow_id: 'workflow-1',
        task_id: 'task-1',
        grimoire_name: 'test-grimoire',
        status: 'running',
        current_step: 0,
        worktree_path: '/tmp/worktree',
        started_at: new Date(Date.now()).toISOString(),
        steps: [
          { id: 'task-1', name: 'First Task', type: 'spell', status: 'completed', depth: 0 },
          { id: 'task-2', name: 'Second Task', type: 'spell', status: 'running', depth: 0 },
          { id: 'task-3', name: 'Third Task', type: 'spell', status: 'pending', depth: 0 },
        ],
        available_actions: ['pause', 'cancel'],
      }),
      getAgentOutput: vi.fn().mockResolvedValue({
        lines: [{ line: 'line 1' }, { line: 'line 2' }, { line: 'line 3' }],
        total_lines: 3,
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
        expect(mockDaemonClient.get).toHaveBeenCalled();
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
      mockDaemonClient.get.mockRejectedValue(new Error('Connection failed'));

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
      mockDaemonClient.get.mockResolvedValue({
        workflow_id: 'workflow-1',
        task_id: 'task-1',
        grimoire_name: 'test-grimoire',
        status: 'paused',
        current_step: 0,
        worktree_path: '/tmp/worktree',
        steps: [],
        available_actions: ['resume', 'cancel'],
      });

      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.get).toHaveBeenCalled();
      });

      getMessageHandler()?.({ type: 'pause' });

      await vi.waitFor(() => {
        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
          'Workflow cannot be paused'
        );
      });
    });

    it('should handle resume action', async () => {
      mockDaemonClient.get.mockResolvedValue({
        workflow_id: 'workflow-1',
        task_id: 'task-1',
        grimoire_name: 'test-grimoire',
        status: 'paused',
        current_step: 0,
        worktree_path: '/tmp/worktree',
        steps: [],
        available_actions: ['resume', 'cancel'],
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
        expect(mockDaemonClient.get).toHaveBeenCalled();
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
      mockDaemonClient.get.mockResolvedValue({
        workflow_id: 'workflow-1',
        task_id: 'task-1',
        grimoire_name: 'test-grimoire',
        status: 'failed',
        current_step: 0,
        worktree_path: '/tmp/worktree',
        steps: [],
        available_actions: ['retry'],
        error: 'Something went wrong',
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
        expect(mockDaemonClient.get).toHaveBeenCalled();
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
        expect(mockDaemonClient.get).toHaveBeenCalled();
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
      mockDaemonClient.get.mockResolvedValue({
        workflow_id: 'workflow-1',
        task_id: 'task-1',
        grimoire_name: 'test-grimoire',
        status: 'paused',
        current_step: 0,
        worktree_path: '/tmp/worktree',
        steps: [],
        available_actions: ['resume', 'cancel'],
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
      mockDaemonClient.get.mockResolvedValue({
        workflow_id: 'workflow-1',
        task_id: 'task-1',
        grimoire_name: 'test-grimoire',
        status: 'failed',
        current_step: 0,
        worktree_path: '/tmp/worktree',
        steps: [],
        available_actions: ['retry'],
        error: 'Something went wrong',
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
      mockDaemonClient.get.mockResolvedValue({
        workflow_id: 'workflow-1',
        task_id: 'task-1',
        grimoire_name: 'test-grimoire',
        status: 'completed',
        current_step: 0,
        worktree_path: '/tmp/worktree',
        steps: [],
        available_actions: [],
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
      mockDaemonClient.get.mockResolvedValue({
        workflow_id: 'workflow-1',
        task_id: 'task-1',
        grimoire_name: 'test-grimoire',
        status: 'running',
        current_step: 1,
        worktree_path: '/tmp/worktree',
        steps: [
          { id: 'task-1', name: 'Done Task', type: 'spell', status: 'completed', depth: 0 },
          { id: 'task-2', name: 'Working Task', type: 'spell', status: 'running', depth: 0 },
          { id: 'task-3', name: 'Ready Task', type: 'spell', status: 'pending', depth: 0 },
          { id: 'task-4', name: 'Blocked Task', type: 'spell', status: 'pending', depth: 0 },
          { id: 'task-5', name: 'Review Task', type: 'spell', status: 'completed', depth: 0 },
        ],
        available_actions: ['pause', 'cancel'],
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

  describe('output streaming', () => {
    /** Helper to load workflow and wait for it to be ready */
    async function loadWorkflow(): Promise<void> {
      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              workflow: expect.objectContaining({
                id: 'workflow-1',
              }),
              isLoading: false,
            }),
          })
        );
      });
    }

    describe('selectStep message', () => {
      it('should fetch historical output when selecting a completed step', async () => {
        createPanel();

        // First load the workflow
        await loadWorkflow();
        mockPanel.webview.postMessage.mockClear();

        // Select a step
        getMessageHandler()?.({ type: 'selectStep', payload: { stepId: 'task-1' } });

        await vi.waitFor(() => {
          expect(mockDaemonClient.getAgentOutput).toHaveBeenCalledWith('task-1');
        });

        // Verify output state is included in state update
        await vi.waitFor(() => {
          expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              type: 'state',
              payload: expect.objectContaining({
                output: expect.objectContaining({
                  stepId: 'task-1',
                  lines: ['line 1', 'line 2', 'line 3'],
                  isLoading: false,
                  isStreaming: false,
                }),
              }),
            })
          );
        });
      });

      it('should clear output when selecting step with no stepId', async () => {
        createPanel();

        await loadWorkflow();
        mockPanel.webview.postMessage.mockClear();

        // Select with no stepId to clear
        getMessageHandler()?.({ type: 'selectStep', payload: {} });

        await vi.waitFor(() => {
          expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              type: 'state',
              payload: expect.objectContaining({
                output: expect.objectContaining({
                  stepId: null,
                  lines: [],
                }),
              }),
            })
          );
        });
      });

      it('should ignore selection for non-existent step', async () => {
        createPanel();

        await loadWorkflow();
        mockDaemonClient.getAgentOutput.mockClear();

        // Select non-existent step
        getMessageHandler()?.({ type: 'selectStep', payload: { stepId: 'non-existent' } });

        // Should not fetch output
        await new Promise((r) => setTimeout(r, 50));
        expect(mockDaemonClient.getAgentOutput).not.toHaveBeenCalled();
      });

      it('should handle fetch error gracefully', async () => {
        createPanel();
        await loadWorkflow();

        // Set up error for next call
        mockDaemonClient.getAgentOutput.mockRejectedValueOnce(new Error('Not found'));
        mockPanel.webview.postMessage.mockClear();

        // Select step - should not throw
        getMessageHandler()?.({ type: 'selectStep', payload: { stepId: 'task-1' } });

        await vi.waitFor(() => {
          expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              type: 'state',
              payload: expect.objectContaining({
                output: expect.objectContaining({
                  stepId: 'task-1',
                  lines: [],
                  isLoading: false,
                }),
              }),
            })
          );
        });
      });
    });

    describe('agent.spawned event', () => {
      it('should start streaming when agent spawns for selected step', async () => {
        createPanel();
        await loadWorkflow();

        // Select a step first
        getMessageHandler()?.({ type: 'selectStep', payload: { stepId: 'task-2' } });
        await vi.waitFor(() => {
          expect(mockDaemonClient.getAgentOutput).toHaveBeenCalled();
        });

        mockPanel.webview.postMessage.mockClear();

        // Emit agent.spawned event for the selected step
        mockSSEClient.emit('event', {
          type: 'agent.started',
          data: { task_id: 'task-2', step_task_id: 'task-2', pid: 1234, status: 'running' },
          timestamp: Date.now(),
        });

        await vi.waitFor(() => {
          expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              type: 'state',
              payload: expect.objectContaining({
                output: expect.objectContaining({
                  stepId: 'task-2',
                  isStreaming: true,
                  lines: [],
                }),
              }),
            })
          );
        });
      });

      it('should not affect output when agent spawns for different step', async () => {
        createPanel();
        await loadWorkflow();

        // Select a step
        getMessageHandler()?.({ type: 'selectStep', payload: { stepId: 'task-1' } });
        await vi.waitFor(() => {
          expect(mockDaemonClient.getAgentOutput).toHaveBeenCalled();
        });

        mockPanel.webview.postMessage.mockClear();

        // Emit agent.spawned for different task
        mockSSEClient.emit('event', {
          type: 'agent.started',
          data: { task_id: 'task-3', step_task_id: 'task-3', pid: 1234, status: 'running' },
          timestamp: Date.now(),
        });

        // Should not update state for output
        await new Promise((r) => setTimeout(r, 50));
        // No output-related state update should have been triggered
      });
    });

    describe('agent.output event', () => {
      it('should append output for selected step', async () => {
        createPanel();
        await loadWorkflow();

        // Select step and emit agent spawned
        getMessageHandler()?.({ type: 'selectStep', payload: { stepId: 'task-2' } });
        await vi.waitFor(() => {
          expect(mockDaemonClient.getAgentOutput).toHaveBeenCalled();
        });

        mockSSEClient.emit('event', {
          type: 'agent.started',
          data: { task_id: 'task-2', step_task_id: 'task-2', pid: 1234, status: 'running' },
          timestamp: Date.now(),
        });

        mockPanel.webview.postMessage.mockClear();

        // Emit output
        mockSSEClient.emit('event', {
          type: 'agent.output',
          data: { task_id: 'task-2', output: 'Hello\nWorld' },
          timestamp: Date.now(),
        });

        await vi.waitFor(() => {
          expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              type: 'state',
              payload: expect.objectContaining({
                output: expect.objectContaining({
                  lines: expect.arrayContaining(['Hello', 'World']),
                  isStreaming: true,
                }),
              }),
            })
          );
        });
      });

      it('should ignore output for non-selected step', async () => {
        createPanel();
        await loadWorkflow();

        // Select task-1 and wait for output to be fetched and state updated
        getMessageHandler()?.({ type: 'selectStep', payload: { stepId: 'task-1' } });
        await vi.waitFor(() => {
          expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              payload: expect.objectContaining({
                output: expect.objectContaining({
                  stepId: 'task-1',
                  lines: ['line 1', 'line 2', 'line 3'],
                }),
              }),
            })
          );
        });

        mockPanel.webview.postMessage.mockClear();

        // Emit output for different task
        mockSSEClient.emit('event', {
          type: 'agent.output',
          data: { task_id: 'task-2', output: 'Should be ignored' },
          timestamp: Date.now(),
        });

        // Should not trigger state update for this output
        await new Promise((r) => setTimeout(r, 50));
        expect(mockPanel.webview.postMessage).not.toHaveBeenCalled();
      });
    });

    describe('agent.completed event', () => {
      it('should stop streaming when agent completes for selected step', async () => {
        createPanel();
        await loadWorkflow();

        // Select and start streaming
        getMessageHandler()?.({ type: 'selectStep', payload: { stepId: 'task-2' } });
        await vi.waitFor(() => {
          expect(mockDaemonClient.getAgentOutput).toHaveBeenCalled();
        });

        mockSSEClient.emit('event', {
          type: 'agent.started',
          data: { task_id: 'task-2', step_task_id: 'task-2', pid: 1234, status: 'running' },
          timestamp: Date.now(),
        });

        mockPanel.webview.postMessage.mockClear();

        // Complete the agent
        mockSSEClient.emit('event', {
          type: 'agent.completed',
          data: { agentId: 'agent-1', taskId: 'task-2', exitCode: 0 },
          timestamp: Date.now(),
        });

        await vi.waitFor(() => {
          expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              type: 'state',
              payload: expect.objectContaining({
                output: expect.objectContaining({
                  isStreaming: false,
                }),
              }),
            })
          );
        });
      });

      it('should stop streaming when agent fails for selected step', async () => {
        createPanel();
        await loadWorkflow();

        // Select and start streaming
        getMessageHandler()?.({ type: 'selectStep', payload: { stepId: 'task-2' } });
        await vi.waitFor(() => {
          expect(mockDaemonClient.getAgentOutput).toHaveBeenCalled();
        });

        mockSSEClient.emit('event', {
          type: 'agent.started',
          data: { task_id: 'task-2', step_task_id: 'task-2', pid: 1234, status: 'running' },
          timestamp: Date.now(),
        });

        mockPanel.webview.postMessage.mockClear();

        // Fail the agent
        mockSSEClient.emit('event', {
          type: 'agent.failed',
          data: { agentId: 'agent-1', taskId: 'task-2', error: 'Something went wrong' },
          timestamp: Date.now(),
        });

        await vi.waitFor(() => {
          expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              type: 'state',
              payload: expect.objectContaining({
                output: expect.objectContaining({
                  isStreaming: false,
                }),
              }),
            })
          );
        });
      });
    });

    describe('toggleAutoScroll message', () => {
      it('should toggle auto-scroll state', async () => {
        createPanel();
        await loadWorkflow();

        mockPanel.webview.postMessage.mockClear();

        // Toggle auto-scroll off
        getMessageHandler()?.({ type: 'toggleAutoScroll', payload: { autoScroll: false } });

        await vi.waitFor(() => {
          expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              type: 'state',
              payload: expect.objectContaining({
                output: expect.objectContaining({
                  autoScroll: false,
                }),
              }),
            })
          );
        });
      });

      it('should toggle auto-scroll when no payload', async () => {
        createPanel();
        await loadWorkflow();

        // First verify auto-scroll is true by default
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            payload: expect.objectContaining({
              output: expect.objectContaining({
                autoScroll: true,
              }),
            }),
          })
        );

        mockPanel.webview.postMessage.mockClear();

        // Toggle without payload
        getMessageHandler()?.({ type: 'toggleAutoScroll' });

        await vi.waitFor(() => {
          expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              type: 'state',
              payload: expect.objectContaining({
                output: expect.objectContaining({
                  autoScroll: false,
                }),
              }),
            })
          );
        });
      });
    });

    describe('clearOutput message', () => {
      it('should clear output lines', async () => {
        createPanel();
        await loadWorkflow();

        // Select step to get output
        getMessageHandler()?.({ type: 'selectStep', payload: { stepId: 'task-1' } });
        await vi.waitFor(() => {
          expect(mockDaemonClient.getAgentOutput).toHaveBeenCalled();
        });

        // Verify we have output
        await vi.waitFor(() => {
          expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              payload: expect.objectContaining({
                output: expect.objectContaining({
                  lines: ['line 1', 'line 2', 'line 3'],
                }),
              }),
            })
          );
        });

        mockPanel.webview.postMessage.mockClear();

        // Clear output
        getMessageHandler()?.({ type: 'clearOutput' });

        await vi.waitFor(() => {
          expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              type: 'state',
              payload: expect.objectContaining({
                output: expect.objectContaining({
                  lines: [],
                }),
              }),
            })
          );
        });
      });
    });

    describe('streaming for active agents', () => {
      it('should start streaming immediately for steps with active agents', async () => {
        createPanel();
        await loadWorkflow();

        // Simulate agent spawning before step selection
        mockSSEClient.emit('event', {
          type: 'agent.started',
          data: { task_id: 'task-2', step_task_id: 'task-2', pid: 1234, status: 'running' },
          timestamp: Date.now(),
        });

        mockPanel.webview.postMessage.mockClear();
        mockDaemonClient.getAgentOutput.mockClear();

        // Now select the step with active agent
        getMessageHandler()?.({ type: 'selectStep', payload: { stepId: 'task-2' } });

        await vi.waitFor(() => {
          expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              type: 'state',
              payload: expect.objectContaining({
                output: expect.objectContaining({
                  stepId: 'task-2',
                  isStreaming: true,
                  isLoading: false,
                }),
              }),
            })
          );
        });

        // Should not fetch historical output for active agents
        expect(mockDaemonClient.getAgentOutput).not.toHaveBeenCalled();
      });
    });
  });
});
