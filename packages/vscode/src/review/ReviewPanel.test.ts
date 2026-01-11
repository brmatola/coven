import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { ReviewPanel } from './ReviewPanel';
import { DaemonClient } from '../daemon/client';
import type { SSEClient } from '@coven/client-ts';

// Mock daemon client
vi.mock('../daemon/client', () => ({
  DaemonClient: vi.fn().mockImplementation(() => ({
    getWorkflowReview: vi.fn(),
    approveWorkflow: vi.fn(),
    rejectWorkflow: vi.fn(),
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

describe('ReviewPanel', () => {
  let mockDaemonClient: {
    getWorkflowReview: ReturnType<typeof vi.fn>;
    approveWorkflow: ReturnType<typeof vi.fn>;
    rejectWorkflow: ReturnType<typeof vi.fn>;
  };
  let mockSSEClient: {
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    connectionState: string;
    eventListeners: Map<string, Set<(...args: unknown[]) => void>>;
  };
  let mockPanel: ReturnType<typeof createMockPanel>;
  const messageHandlers = new Map<string, (message: unknown) => void>();
  const disposeHandlers = new Map<string, () => void>();
  let createdPanels: ReviewPanel[] = [];
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

  function getMessageHandler(workflowId = 'workflow-1'): ((message: unknown) => void) | undefined {
    return messageHandlers.get(workflowId);
  }

  function getDisposeHandler(workflowId = 'workflow-1'): (() => void) | undefined {
    return disposeHandlers.get(workflowId);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    messageHandlers.clear();
    disposeHandlers.clear();
    createdPanels = [];
    currentWorkflowId = 'workflow-1';

    mockDaemonClient = {
      getWorkflowReview: vi.fn().mockResolvedValue({
        workflow_id: 'workflow-1',
        task_id: 'task-1',
        task_title: 'Implement feature X',
        task_description: 'Add new functionality',
        acceptance_criteria: 'Feature works correctly',
        changes: {
          base_branch: 'main',
          head_branch: 'feature/x',
          worktree_path: '/tmp/worktree-1',
          files: [
            { path: 'src/feature.ts', lines_added: 50, lines_deleted: 10, change_type: 'modified' },
            { path: 'src/new.ts', lines_added: 100, lines_deleted: 0, change_type: 'added' },
          ],
          total_lines_added: 150,
          total_lines_deleted: 10,
          commit_count: 3,
        },
        step_outputs: [
          { stepId: 'step-1', stepName: 'Implement', summary: 'Added feature', exit_code: 0 },
          { stepId: 'step-2', stepName: 'Test', summary: 'All tests pass', exit_code: 0 },
        ],
        started_at: Date.now() - 60000,
        completed_at: Date.now(),
        duration_ms: 60000,
      }),
      approveWorkflow: vi.fn().mockResolvedValue(undefined),
      rejectWorkflow: vi.fn().mockResolvedValue(undefined),
    };

    mockSSEClient = createMockSSEClient();
    mockPanel = createMockPanel('workflow-1');

    vi.mocked(vscode.window.createWebviewPanel).mockImplementation(
      (_viewType, _title, _showOptions, _options) => {
        mockPanel = createMockPanel(currentWorkflowId);
        return mockPanel as unknown as vscode.WebviewPanel;
      }
    );
  });

  afterEach(() => {
    disposeHandlers.forEach((handler) => {
      handler();
    });
  });

  function createPanel(workflowId = 'workflow-1'): ReviewPanel | null {
    currentWorkflowId = workflowId;
    const panel = ReviewPanel.createOrShow(
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

  describe('createOrShow', () => {
    it('should create a new panel', () => {
      const panel = createPanel();

      expect(panel).toBeDefined();
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'covenReview',
        expect.stringContaining('Review:'),
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

      const secondMockPanel = createMockPanel('workflow-2');
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

      const panel = ReviewPanel.get('workflow-1');
      expect(panel).toBeDefined();
    });

    it('should return undefined for non-existent panel', () => {
      const panel = ReviewPanel.get('non-existent');
      expect(panel).toBeUndefined();
    });
  });

  describe('ready message', () => {
    it('should fetch workflow review on ready', async () => {
      createPanel();

      getMessageHandler()?.({ type: 'ready' });

      await vi.waitFor(() => {
        expect(mockDaemonClient.getWorkflowReview).toHaveBeenCalledWith('workflow-1');
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
              workflowId: 'workflow-1',
              taskId: 'task-1',
              title: 'Implement feature X',
              totalLinesAdded: 150,
              totalLinesDeleted: 10,
              isLoading: false,
            }),
          })
        );
      });
    });

    it('should update panel title after fetch', async () => {
      createPanel();

      getMessageHandler()?.({ type: 'ready' });

      // Wait for state to be sent (which happens after title is set)
      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              title: 'Implement feature X',
              isLoading: false,
            }),
          })
        );
      });

      expect(mockPanel.title).toBe('Review: Implement feature X');
    });

    it('should handle fetch error', async () => {
      mockDaemonClient.getWorkflowReview.mockRejectedValue(new Error('Connection failed'));

      createPanel();

      getMessageHandler()?.({ type: 'ready' });

      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              error: expect.stringContaining('Failed to load review'),
              isLoading: false,
            }),
          })
        );
      });
    });

    it('should include step outputs in state', async () => {
      createPanel();

      getMessageHandler()?.({ type: 'ready' });

      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              stepOutputs: expect.arrayContaining([
                expect.objectContaining({ stepName: 'Implement' }),
                expect.objectContaining({ stepName: 'Test' }),
              ]),
            }),
          })
        );
      });
    });

    it('should build agent summary from step outputs', async () => {
      createPanel();

      getMessageHandler()?.({ type: 'ready' });

      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              agentSummary: expect.stringContaining('Implement'),
            }),
          })
        );
      });
    });
  });

  describe('approve action', () => {
    it('should approve workflow', async () => {
      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.getWorkflowReview).toHaveBeenCalled();
      });

      getMessageHandler()?.({ type: 'approve', payload: { feedback: 'Looks good!' } });

      await vi.waitFor(() => {
        expect(mockDaemonClient.approveWorkflow).toHaveBeenCalledWith('workflow-1', 'Looks good!');
      });

      await vi.waitFor(() => {
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
          'Workflow approved and merged successfully'
        );
      });
    });

    it('should approve workflow without feedback', async () => {
      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.getWorkflowReview).toHaveBeenCalled();
      });

      getMessageHandler()?.({ type: 'approve' });

      await vi.waitFor(() => {
        expect(mockDaemonClient.approveWorkflow).toHaveBeenCalledWith('workflow-1', undefined);
      });
    });

    it('should show error on approve failure', async () => {
      mockDaemonClient.approveWorkflow.mockRejectedValue(new Error('Network error'));

      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.getWorkflowReview).toHaveBeenCalled();
      });

      getMessageHandler()?.({ type: 'approve' });

      await vi.waitFor(() => {
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
          expect.stringContaining('Failed to approve')
        );
      });
    });
  });

  describe('reject action', () => {
    it('should reject workflow after confirmation', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
        'Reject' as unknown as vscode.MessageItem
      );

      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.getWorkflowReview).toHaveBeenCalled();
      });

      getMessageHandler()?.({ type: 'reject', payload: { reason: 'Not ready' } });

      await vi.waitFor(() => {
        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
          expect.stringContaining('Are you sure'),
          { modal: true },
          'Reject'
        );
      });

      await vi.waitFor(() => {
        expect(mockDaemonClient.rejectWorkflow).toHaveBeenCalledWith('workflow-1', 'Not ready');
      });
    });

    it('should not reject if user cancels', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.getWorkflowReview).toHaveBeenCalled();
      });

      getMessageHandler()?.({ type: 'reject' });

      await vi.waitFor(() => {
        expect(vscode.window.showWarningMessage).toHaveBeenCalled();
      });

      expect(mockDaemonClient.rejectWorkflow).not.toHaveBeenCalled();
    });

    it('should show error on reject failure', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
        'Reject' as unknown as vscode.MessageItem
      );
      mockDaemonClient.rejectWorkflow.mockRejectedValue(new Error('Cleanup failed'));

      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.getWorkflowReview).toHaveBeenCalled();
      });

      getMessageHandler()?.({ type: 'reject' });

      await vi.waitFor(() => {
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
          expect.stringContaining('Failed to reject')
        );
      });
    });
  });

  describe('viewDiff action', () => {
    it('should open diff view', async () => {
      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      // Wait for state to be fully loaded
      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              worktreePath: '/tmp/worktree-1',
              isLoading: false,
            }),
          })
        );
      });

      getMessageHandler()?.({ type: 'viewDiff', payload: { filePath: 'src/feature.ts' } });

      await vi.waitFor(() => {
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
          'vscode.diff',
          expect.any(Object),
          expect.any(Object),
          expect.stringContaining('src/feature.ts')
        );
      });
    });

    it('should show error if worktree path not available', async () => {
      mockDaemonClient.getWorkflowReview.mockResolvedValue({
        workflowId: 'workflow-1',
        taskId: 'task-1',
        taskTitle: 'Test',
        taskDescription: '',
        changes: {
          workflowId: 'workflow-1',
          taskId: 'task-1',
          baseBranch: 'main',
          headBranch: 'feature/x',
          worktreePath: '', // Empty worktree path
          files: [],
          totalLinesAdded: 0,
          totalLinesDeleted: 0,
          commitCount: 0,
        },
        stepOutputs: [],
      });

      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.getWorkflowReview).toHaveBeenCalled();
      });

      getMessageHandler()?.({ type: 'viewDiff', payload: { filePath: 'file.ts' } });

      await vi.waitFor(() => {
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
          'Worktree path not available'
        );
      });
    });
  });

  describe('viewAllChanges action', () => {
    it('should open source control view', async () => {
      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      // Wait for state to be fully loaded
      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              worktreePath: '/tmp/worktree-1',
              isLoading: false,
            }),
          })
        );
      });

      getMessageHandler()?.({ type: 'viewAllChanges' });

      await vi.waitFor(() => {
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
          'git.openRepository',
          '/tmp/worktree-1'
        );
      });
    });
  });

  describe('runChecks action', () => {
    it('should show checking state', async () => {
      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.getWorkflowReview).toHaveBeenCalled();
      });

      mockPanel.webview.postMessage.mockClear();

      getMessageHandler()?.({ type: 'runChecks' });

      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              status: 'checking',
            }),
          })
        );
      });
    });
  });

  describe('overrideChecks action', () => {
    it('should approve with override after confirmation', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
        'Override and Approve' as unknown as vscode.MessageItem
      );

      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.getWorkflowReview).toHaveBeenCalled();
      });

      getMessageHandler()?.({ type: 'overrideChecks', payload: { reason: 'Tests flaky' } });

      await vi.waitFor(() => {
        expect(mockDaemonClient.approveWorkflow).toHaveBeenCalledWith(
          'workflow-1',
          '[Override: Tests flaky]'
        );
      });
    });

    it('should not override if user cancels', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.getWorkflowReview).toHaveBeenCalled();
      });

      getMessageHandler()?.({ type: 'overrideChecks', payload: { reason: 'Tests flaky' } });

      await vi.waitFor(() => {
        expect(vscode.window.showWarningMessage).toHaveBeenCalled();
      });

      expect(mockDaemonClient.approveWorkflow).not.toHaveBeenCalled();
    });
  });

  describe('SSE events', () => {
    it('should subscribe to SSE events on creation', () => {
      createPanel();

      expect(mockSSEClient.on).toHaveBeenCalledWith('event', expect.any(Function));
      expect(mockSSEClient.listenerCount('event')).toBe(1);
    });

    it('should refresh on workflow.completed event', async () => {
      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.getWorkflowReview).toHaveBeenCalled();
      });

      mockDaemonClient.getWorkflowReview.mockClear();

      mockSSEClient.emit('event', {
        type: 'workflow.completed',
        data: { workflow_id: 'workflow-1' },
        timestamp: Date.now(),
      });

      await vi.waitFor(() => {
        expect(mockDaemonClient.getWorkflowReview).toHaveBeenCalled();
      });
    });

    it('should refresh on workflow.failed event', async () => {
      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.getWorkflowReview).toHaveBeenCalled();
      });

      mockDaemonClient.getWorkflowReview.mockClear();

      mockSSEClient.emit('event', {
        type: 'workflow.failed',
        data: { workflow_id: 'workflow-1' },
        timestamp: Date.now(),
      });

      await vi.waitFor(() => {
        expect(mockDaemonClient.getWorkflowReview).toHaveBeenCalled();
      });
    });

    it('should ignore events for other workflows', async () => {
      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.getWorkflowReview).toHaveBeenCalled();
      });

      mockDaemonClient.getWorkflowReview.mockClear();

      mockSSEClient.emit('event', {
        type: 'workflow.completed',
        data: { workflow_id: 'other-workflow' },
        timestamp: Date.now(),
      });

      // Should not refetch
      expect(mockDaemonClient.getWorkflowReview).not.toHaveBeenCalled();
    });

    it('should unsubscribe from SSE events on dispose', () => {
      createPanel();

      expect(mockSSEClient.listenerCount('event')).toBe(1);

      getDisposeHandler()?.();

      expect(mockSSEClient.off).toHaveBeenCalledWith('event', expect.any(Function));
      expect(mockSSEClient.listenerCount('event')).toBe(0);
    });
  });

  describe('dispose', () => {
    it('should remove panel from static map on dispose', () => {
      createPanel();

      expect(ReviewPanel.get('workflow-1')).toBeDefined();

      getDisposeHandler()?.();

      expect(ReviewPanel.get('workflow-1')).toBeUndefined();
    });
  });

  describe('closeAll', () => {
    it('should close all panels', () => {
      createPanel('workflow-1');

      const secondMockPanel = createMockPanel('workflow-2');
      vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
        secondMockPanel as unknown as vscode.WebviewPanel
      );
      createPanel('workflow-2');

      expect(ReviewPanel.get('workflow-1')).toBeDefined();
      expect(ReviewPanel.get('workflow-2')).toBeDefined();

      ReviewPanel.closeAll();

      expect(ReviewPanel.get('workflow-1')).toBeUndefined();
      expect(ReviewPanel.get('workflow-2')).toBeUndefined();
    });
  });

  describe('merge conflict handling', () => {
    it('should detect merge conflict error and update state', async () => {
      const conflictError = new Error('Merge conflict detected');

      // Mock getWorkflowReview to return worktree path
      mockDaemonClient.getWorkflowReview.mockResolvedValue({
        workflow_id: 'workflow-1',
        task_id: 'task-1',
        task_title: 'Test Task',
        task_description: 'Description',
        changes: {
          base_branch: 'main',
          head_branch: 'feature/x',
          worktree_path: '/tmp/worktree-1',
          files: [],
          total_lines_added: 0,
          total_lines_deleted: 0,
          commit_count: 1,
        },
        step_outputs: [],
      });

      mockDaemonClient.approveWorkflow.mockRejectedValue(conflictError);

      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.getWorkflowReview).toHaveBeenCalled();
      });

      mockPanel.webview.postMessage.mockClear();

      getMessageHandler()?.({ type: 'approve' });

      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              status: 'conflict',
              mergeConflict: expect.objectContaining({
                worktreePath: '/tmp/worktree-1',
              }),
            }),
          })
        );
      });
    });

    it('should open worktree in new window', async () => {
      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      // Wait for state to be fully loaded with worktree path
      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              worktreePath: '/tmp/worktree-1',
              isLoading: false,
            }),
          })
        );
      });

      getMessageHandler()?.({ type: 'openWorktree' });

      await vi.waitFor(() => {
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
          'vscode.openFolder',
          expect.any(Object),
          { forceNewWindow: true }
        );
      });
    });

    it('should show error if worktree path not available for openWorktree', async () => {
      mockDaemonClient.getWorkflowReview.mockResolvedValue({
        workflowId: 'workflow-1',
        taskId: 'task-1',
        taskTitle: 'Test',
        taskDescription: '',
        changes: {
          workflowId: 'workflow-1',
          taskId: 'task-1',
          baseBranch: 'main',
          headBranch: 'feature/x',
          worktreePath: '',
          files: [],
          totalLinesAdded: 0,
          totalLinesDeleted: 0,
          commitCount: 0,
        },
        stepOutputs: [],
      });

      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.getWorkflowReview).toHaveBeenCalled();
      });

      getMessageHandler()?.({ type: 'openWorktree' });

      await vi.waitFor(() => {
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Worktree path not available');
      });
    });

    it('should retry merge successfully', async () => {
      const conflictError = new Error('Merge conflict detected');
      mockDaemonClient.approveWorkflow
        .mockRejectedValueOnce(conflictError)
        .mockResolvedValueOnce(undefined);

      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      // Wait for state to be fully loaded
      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              worktreePath: '/tmp/worktree-1',
              isLoading: false,
            }),
          })
        );
      });

      // First approve triggers conflict
      getMessageHandler()?.({ type: 'approve' });
      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            payload: expect.objectContaining({
              status: 'conflict',
            }),
          })
        );
      });

      mockPanel.webview.postMessage.mockClear();

      // Retry merge succeeds
      getMessageHandler()?.({ type: 'retryMerge' });

      await vi.waitFor(() => {
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
          'Merge completed successfully'
        );
      });
    });

    it('should show error when retry merge fails with non-conflict error', async () => {
      const conflictError = new Error('Merge conflict detected');
      const retryError = new Error('Permission denied');
      mockDaemonClient.approveWorkflow
        .mockRejectedValueOnce(conflictError)
        .mockRejectedValueOnce(retryError);

      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      // Wait for state to be fully loaded
      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              worktreePath: '/tmp/worktree-1',
              isLoading: false,
            }),
          })
        );
      });

      // First approve triggers conflict
      getMessageHandler()?.({ type: 'approve' });
      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            payload: expect.objectContaining({
              status: 'conflict',
            }),
          })
        );
      });

      mockPanel.webview.postMessage.mockClear();

      // Retry merge fails with different error
      getMessageHandler()?.({ type: 'retryMerge' });

      await vi.waitFor(() => {
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
          expect.stringContaining('Permission denied')
        );
      });
    });

    it('should show error when retryMerge called without conflict state', async () => {
      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      await vi.waitFor(() => {
        expect(mockDaemonClient.getWorkflowReview).toHaveBeenCalled();
      });

      // Try to retry without conflict
      getMessageHandler()?.({ type: 'retryMerge' });

      await vi.waitFor(() => {
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No merge conflict to retry');
      });
    });

    it('should open conflict file in editor', async () => {
      createPanel();

      getMessageHandler()?.({ type: 'ready' });
      // Wait for state to be fully loaded
      await vi.waitFor(() => {
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'state',
            payload: expect.objectContaining({
              worktreePath: '/tmp/worktree-1',
              isLoading: false,
            }),
          })
        );
      });

      getMessageHandler()?.({ type: 'openConflictFile', payload: { filePath: 'src/index.ts' } });

      await vi.waitFor(() => {
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
          'vscode.open',
          expect.any(Object)
        );
      });
    });
  });
});
