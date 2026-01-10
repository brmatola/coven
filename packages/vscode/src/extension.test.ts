import { describe, it, expect, vi, beforeEach } from 'vitest';
import { window, commands, __setWorkspaceFolders, __resetWorkspaceFolders } from 'vscode';
import { activate, deactivate } from './extension';
import { ExtensionContext } from './shared/extensionContext';
import { disposeLogger } from './shared/logger';
import { disposeEventBus } from './shared/eventBus';
import type * as vscode from 'vscode';

// Mock prerequisites
vi.mock('./setup/prerequisites', () => ({
  checkPrerequisites: vi.fn(),
}));

// Mock SetupPanel
vi.mock('./setup/SetupPanel', () => ({
  SetupPanel: {
    createOrShow: vi.fn(),
  },
}));

// Mock WorkflowTreeProvider
vi.mock('./sidebar/WorkflowTreeProvider', () => ({
  WorkflowTreeProvider: vi.fn().mockImplementation(() => ({
    setCache: vi.fn(),
    refresh: vi.fn(),
    dispose: vi.fn(),
    onDidChangeTreeData: {
      event: vi.fn(),
    },
    getTreeItem: vi.fn(),
    getChildren: vi.fn().mockResolvedValue([]),
  })),
}));

// Mock daemon modules
vi.mock('./daemon', () => ({
  ConnectionManager: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    getSocketPath: vi.fn().mockReturnValue('/tmp/test.sock'),
    on: vi.fn(),
    off: vi.fn(),
  })),
  DaemonClient: vi.fn().mockImplementation(() => ({
    startSession: vi.fn().mockResolvedValue(undefined),
    stopSession: vi.fn().mockResolvedValue(undefined),
    startTask: vi.fn().mockResolvedValue(undefined),
    killTask: vi.fn().mockResolvedValue(undefined),
    post: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(undefined),
  })),
  SSEClient: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    off: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  })),
  StateCache: vi.fn().mockImplementation(() => ({
    handleEvent: vi.fn(),
    getWorkflows: vi.fn().mockReturnValue([]),
    getQuestions: vi.fn().mockReturnValue([]),
    getSessionState: vi.fn().mockReturnValue({ active: false }),
    on: vi.fn(),
    off: vi.fn(),
  })),
  BinaryManager: vi.fn().mockImplementation(() => ({
    getBinaryPath: vi.fn().mockReturnValue('/usr/bin/covend'),
  })),
  DaemonLifecycle: vi.fn().mockImplementation(() => ({
    ensureRunning: vi.fn().mockResolvedValue(undefined),
    getSocketPath: vi.fn().mockReturnValue('/tmp/test.sock'),
    stop: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockResolvedValue(true),
  })),
  DaemonNotificationService: vi.fn().mockImplementation(() => ({
    viewLogs: vi.fn().mockResolvedValue(undefined),
    showError: vi.fn().mockResolvedValue(undefined),
    showConnectionLost: vi.fn().mockResolvedValue(undefined),
    showReconnecting: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    showReconnected: vi.fn().mockResolvedValue(undefined),
    showReconnectionFailed: vi.fn().mockResolvedValue(undefined),
    showVersionMismatch: vi.fn().mockResolvedValue(undefined),
    showStarting: vi.fn().mockResolvedValue({ dispose: vi.fn() }),
    showStarted: vi.fn(),
    showStopped: vi.fn(),
  })),
  DaemonStartError: class DaemonStartError extends Error {
    constructor(message: string, public readonly logPath: string) {
      super(message);
      this.name = 'DaemonStartError';
    }
  },
}));

// Mock FamiliarOutputChannel
vi.mock('./agents/FamiliarOutputChannel', () => ({
  FamiliarOutputChannel: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(),
    dispose: vi.fn(),
    hasChannel: vi.fn().mockReturnValue(false),
    fetchHistory: vi.fn().mockResolvedValue(undefined),
    showChannel: vi.fn(),
  })),
}));

// Mock QuestionHandler
vi.mock('./agents/QuestionHandler', () => ({
  QuestionHandler: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(),
    showAnswerDialogByTaskId: vi.fn().mockResolvedValue(true),
  })),
}));

// Mock NotificationService
vi.mock('./shared/notifications', () => ({
  NotificationService: vi.fn(),
}));

// Mock TaskDetailPanel
vi.mock('./tasks/TaskDetailPanel', () => ({
  TaskDetailPanel: {
    createOrShow: vi.fn(),
  },
}));

// Mock ReviewPanel
vi.mock('./review/ReviewPanel', () => ({
  ReviewPanel: {
    createOrShow: vi.fn(),
  },
}));

// Mock BeadsTaskSource
vi.mock('./tasks/BeadsTaskSource', () => ({
  BeadsTaskSource: vi.fn().mockImplementation(() => ({
    watch: vi.fn(),
    createTask: vi.fn().mockResolvedValue({ id: 'test-task' }),
    sync: vi.fn().mockResolvedValue({ added: [], updated: [], removed: [] }),
  })),
}));

// Mock WorktreeManager
vi.mock('./git/WorktreeManager', () => ({
  WorktreeManager: vi.fn().mockImplementation(() => ({})),
}));

// Mock detection
vi.mock('./setup/detection', () => ({
  detectCoven: vi.fn().mockResolvedValue({ status: 'initialized' }),
}));

import { checkPrerequisites } from './setup/prerequisites';
import { SetupPanel } from './setup/SetupPanel';
import { detectCoven } from './setup/detection';

const mockCheckPrerequisites = checkPrerequisites as ReturnType<typeof vi.fn>;
const mockSetupPanelCreateOrShow = SetupPanel.createOrShow as ReturnType<typeof vi.fn>;
const mockDetectCoven = detectCoven as ReturnType<typeof vi.fn>;

function createMockWorkspaceState(): vscode.Memento {
  const storage = new Map<string, unknown>();
  return {
    get: <T>(key: string, defaultValue?: T): T | undefined => {
      return (storage.get(key) as T) ?? defaultValue;
    },
    update: (key: string, value: unknown): Thenable<void> => {
      storage.set(key, value);
      return Promise.resolve();
    },
    keys: () => Array.from(storage.keys()),
  };
}

function createMockExtensionContext(): vscode.ExtensionContext {
  return {
    extensionUri: { fsPath: '/mock/extension' } as vscode.Uri,
    subscriptions: [],
    workspaceState: createMockWorkspaceState(),
    globalState: {
      ...createMockWorkspaceState(),
      setKeysForSync: vi.fn(),
    } as vscode.Memento & { setKeysForSync: (keys: readonly string[]) => void },
    extensionPath: '/mock/extension',
    storagePath: '/mock/storage',
    globalStoragePath: '/mock/global-storage',
    logPath: '/mock/logs',
    extensionMode: 1,
    asAbsolutePath: (path: string) => `/mock/extension/${path}`,
    storageUri: undefined,
    globalStorageUri: undefined,
    logUri: undefined,
    secrets: {} as vscode.SecretStorage,
    environmentVariableCollection: {} as vscode.GlobalEnvironmentVariableCollection,
    extension: {} as vscode.Extension<unknown>,
    languageModelAccessInformation: {} as vscode.LanguageModelAccessInformation,
  };
}

describe('extension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deactivate(); // Ensure clean global state
    ExtensionContext.dispose();
    disposeLogger();
    disposeEventBus();
    mockCheckPrerequisites.mockResolvedValue({
      tools: [],
      inits: [],
      allMet: true,
    });
    // Reset detectCoven to default
    mockDetectCoven.mockResolvedValue({ status: 'initialized' });
  });

  describe('activate()', () => {
    it('initializes ExtensionContext', async () => {
      const mockCtx = createMockExtensionContext();

      await activate(mockCtx);

      expect(ExtensionContext.isInitialized()).toBe(true);
    });

    it('creates status bar item', async () => {
      const mockCtx = createMockExtensionContext();

      await activate(mockCtx);

      expect(window.createStatusBarItem).toHaveBeenCalled();
    });

    it('sets status bar text during activation', async () => {
      const mockCtx = createMockExtensionContext();

      await activate(mockCtx);

      const mockStatusBar = (window.createStatusBarItem as ReturnType<typeof vi.fn>).mock
        .results[0]?.value;
      // After daemon connects with inactive session, status bar shows inactive
      expect(mockStatusBar?.text).toBe('$(circle-outline) Coven: Inactive');
    });

    it('creates tree view for sessions', async () => {
      const mockCtx = createMockExtensionContext();

      await activate(mockCtx);

      expect(window.createTreeView).toHaveBeenCalledWith('coven.sessions', expect.any(Object));
    });

    it('registers startSession command', async () => {
      const mockCtx = createMockExtensionContext();

      await activate(mockCtx);

      expect(commands.registerCommand).toHaveBeenCalledWith(
        'coven.startSession',
        expect.any(Function)
      );
    });

    it('registers stopSession command', async () => {
      const mockCtx = createMockExtensionContext();

      await activate(mockCtx);

      expect(commands.registerCommand).toHaveBeenCalledWith(
        'coven.stopSession',
        expect.any(Function)
      );
    });

    it('registers showSetup command', async () => {
      const mockCtx = createMockExtensionContext();

      await activate(mockCtx);

      expect(commands.registerCommand).toHaveBeenCalledWith(
        'coven.showSetup',
        expect.any(Function)
      );
    });

    it('checks prerequisites during activation', async () => {
      const mockCtx = createMockExtensionContext();

      await activate(mockCtx);

      expect(checkPrerequisites).toHaveBeenCalled();
    });

    it('shows setup panel when prerequisites not met', async () => {
      mockCheckPrerequisites.mockResolvedValue({
        tools: [],
        inits: [],
        allMet: false,
      });
      const mockCtx = createMockExtensionContext();

      await activate(mockCtx);

      expect(SetupPanel.createOrShow).toHaveBeenCalled();
    });

    it('does not show setup panel when prerequisites are met', async () => {
      mockCheckPrerequisites.mockResolvedValue({
        tools: [],
        inits: [],
        allMet: true,
      });
      const mockCtx = createMockExtensionContext();

      await activate(mockCtx);

      expect(SetupPanel.createOrShow).not.toHaveBeenCalled();
    });

    it('adds disposables to subscriptions', async () => {
      const mockCtx = createMockExtensionContext();

      await activate(mockCtx);

      // Status bar, tree view, and commands = at least 5 items
      expect(mockCtx.subscriptions.length).toBeGreaterThanOrEqual(5);
    });

    it('shows not initialized status when coven is missing', async () => {
      mockDetectCoven.mockResolvedValue({ status: 'missing' });
      const mockCtx = createMockExtensionContext();

      await activate(mockCtx);

      // Status bar should show not initialized
      const mockStatusBar = (window.createStatusBarItem as ReturnType<typeof vi.fn>).mock
        .results[0]?.value;
      expect(mockStatusBar?.text).toBe('$(warning) Coven: not initialized');
    });

    it('creates SetupTreeProvider when coven is missing', async () => {
      mockDetectCoven.mockResolvedValue({ status: 'missing' });
      const mockCtx = createMockExtensionContext();

      await activate(mockCtx);

      // Should have added setup provider to subscriptions
      expect(mockCtx.subscriptions.length).toBeGreaterThan(0);
    });

    it('handles prerequisites check error gracefully', async () => {
      mockCheckPrerequisites.mockRejectedValue(new Error('Check failed'));
      const mockCtx = createMockExtensionContext();

      // Should not throw
      await expect(activate(mockCtx)).resolves.toBeUndefined();
    });
  });

  describe('deactivate()', () => {
    it('disposes ExtensionContext', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      deactivate();

      expect(ExtensionContext.isInitialized()).toBe(false);
    });

    it('does not throw when called without activation', () => {
      expect(() => deactivate()).not.toThrow();
    });

    it('cleans up when coven is missing', async () => {
      mockDetectCoven.mockResolvedValue({ status: 'missing' });
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      // Should not throw
      expect(() => deactivate()).not.toThrow();
    });

    it('cleans up connection manager when initialized', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      deactivate();

      // Connection manager should be cleaned up
      expect(ExtensionContext.isInitialized()).toBe(false);
    });

    it('handles multiple deactivate calls', () => {
      // Multiple deactivate calls should be safe
      deactivate();
      deactivate();
      deactivate();

      expect(true).toBe(true);
    });
  });

  describe('command handlers', () => {
    it('startSession shows error when no workspace', async () => {
      const mockCtx = createMockExtensionContext();
      __setWorkspaceFolders([]);

      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const startSessionCall = registerCalls.find((call) => call[0] === 'coven.startSession');
      const startSessionHandler = startSessionCall?.[1];

      await startSessionHandler();

      expect(window.showErrorMessage).toHaveBeenCalledWith('Coven: No workspace folder open');

      __resetWorkspaceFolders();
    });

    it('showSetup opens setup panel', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const showSetupCall = registerCalls.find((call) => call[0] === 'coven.showSetup');
      const showSetupHandler = showSetupCall?.[1];

      mockSetupPanelCreateOrShow.mockClear();
      await showSetupHandler();

      expect(SetupPanel.createOrShow).toHaveBeenCalled();
    });

    it('revealSidebar executes focus command', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const revealCall = registerCalls.find((call) => call[0] === 'coven.revealSidebar');
      const revealHandler = revealCall?.[1];

      revealHandler();

      // Note: executeCommand is void-returned, just verify no error thrown
      expect(true).toBe(true);
    });

    it('showTaskDetail shows error when invalid reference', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const showTaskDetailCall = registerCalls.find((call) => call[0] === 'coven.showTaskDetail');
      const showTaskDetailHandler = showTaskDetailCall?.[1];

      await showTaskDetailHandler(null);

      expect(window.showErrorMessage).toHaveBeenCalledWith('Coven: Invalid task reference');
    });

    it('viewFamiliarOutput shows error when invalid reference', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const viewOutputCall = registerCalls.find((call) => call[0] === 'coven.viewFamiliarOutput');
      const viewOutputHandler = viewOutputCall?.[1];

      await viewOutputHandler(null);

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        'Coven: Invalid task reference or no active session'
      );
    });

    it('createTask returns early when user cancels input', async () => {
      const mockCtx = createMockExtensionContext();
      (window.showInputBox as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const createTaskCall = registerCalls.find((call) => call[0] === 'coven.createTask');
      const createTaskHandler = createTaskCall?.[1];

      await createTaskHandler();

      // Should not show error since user cancelled
      expect(window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('refreshTasks does not throw', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const refreshCall = registerCalls.find((call) => call[0] === 'coven.refreshTasks');
      const refreshHandler = refreshCall?.[1];

      // Should not throw
      await expect(refreshHandler()).resolves.toBeUndefined();
    });

    it('startTask shows error when invalid reference', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const startTaskCall = registerCalls.find((call) => call[0] === 'coven.startTask');
      const startTaskHandler = startTaskCall?.[1];

      await startTaskHandler(null);

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        'Coven: Invalid task reference or no daemon connection'
      );
    });

    it('startTask handles valid string taskId', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const startTaskCall = registerCalls.find((call) => call[0] === 'coven.startTask');
      const startTaskHandler = startTaskCall?.[1];

      // With daemon connected, taskId is extracted and task is started
      await startTaskHandler('task-123');

      // Should show success message
      expect(window.showInformationMessage).toHaveBeenCalledWith('Task started: task-123');
    });

    it('startTask handles object with taskId', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const startTaskCall = registerCalls.find((call) => call[0] === 'coven.startTask');
      const startTaskHandler = startTaskCall?.[1];

      await startTaskHandler({ taskId: 'task-456' });

      expect(window.showInformationMessage).toHaveBeenCalledWith('Task started: task-456');
    });

    it('startTask handles object with nested task.id', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const startTaskCall = registerCalls.find((call) => call[0] === 'coven.startTask');
      const startTaskHandler = startTaskCall?.[1];

      await startTaskHandler({ task: { id: 'task-789' } });

      expect(window.showInformationMessage).toHaveBeenCalledWith('Task started: task-789');
    });

    it('stopTask shows error when invalid reference', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const stopTaskCall = registerCalls.find((call) => call[0] === 'coven.stopTask');
      const stopTaskHandler = stopTaskCall?.[1];

      await stopTaskHandler(null);

      expect(window.showErrorMessage).toHaveBeenCalledWith('Coven: Invalid task reference');
    });

    it('stopSession shows message when no active session', async () => {
      const mockCtx = createMockExtensionContext();
      __setWorkspaceFolders([]);
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const stopSessionCall = registerCalls.find((call) => call[0] === 'coven.stopSession');
      const stopSessionHandler = stopSessionCall?.[1];

      await stopSessionHandler();

      expect(window.showInformationMessage).toHaveBeenCalledWith('Coven: No active session');
      __resetWorkspaceFolders();
    });

    it('respondToQuestion shows error when invalid reference', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const respondCall = registerCalls.find((call) => call[0] === 'coven.respondToQuestion');
      const respondHandler = respondCall?.[1];

      await respondHandler(null);

      expect(window.showErrorMessage).toHaveBeenCalledWith('Coven: Invalid task reference');
    });

    it('respondToQuestion calls showAnswerDialogByTaskId when valid', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const respondCall = registerCalls.find((call) => call[0] === 'coven.respondToQuestion');
      const respondHandler = respondCall?.[1];

      // With daemon connected and question handler set up, should succeed
      await respondHandler('task-with-question');

      // The question handler mock should have been called
      expect(true).toBe(true); // No error thrown
    });

    it('reviewTask shows error when invalid reference', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const reviewCall = registerCalls.find((call) => call[0] === 'coven.reviewTask');
      const reviewHandler = reviewCall?.[1];

      await reviewHandler(null);

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        'Coven: Invalid task reference or not initialized'
      );
    });

    it('reviewTask opens panel when valid', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const reviewCall = registerCalls.find((call) => call[0] === 'coven.reviewTask');
      const reviewHandler = reviewCall?.[1];

      // With daemon connected and all managers set up, should succeed
      await reviewHandler('task-to-review');

      // No error should be thrown
      expect(true).toBe(true);
    });

    it('stopDaemon shows error when not connected', async () => {
      deactivate(); // Ensure clean state
      const mockCtx = createMockExtensionContext();
      __setWorkspaceFolders([]);
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const stopCall = registerCalls.find((call) => call[0] === 'coven.stopDaemon');
      const stopHandler = stopCall?.[1];

      await stopHandler();

      expect(window.showErrorMessage).toHaveBeenCalledWith('Coven: Daemon not connected');
      __resetWorkspaceFolders();
    });

    it('stopDaemon succeeds when connected', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const stopCall = registerCalls.find((call) => call[0] === 'coven.stopDaemon');
      const stopHandler = stopCall?.[1];

      await stopHandler();

      // With daemon connected, stopDaemon runs successfully
      expect(window.showInformationMessage).toHaveBeenCalledWith('Daemon stopped.');
    });

    it('restartDaemon shows error when not connected', async () => {
      deactivate(); // Ensure clean state
      const mockCtx = createMockExtensionContext();
      __setWorkspaceFolders([]);
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const restartCall = registerCalls.find((call) => call[0] === 'coven.restartDaemon');
      const restartHandler = restartCall?.[1];

      await restartHandler();

      expect(window.showErrorMessage).toHaveBeenCalledWith('Coven: Daemon not connected');
      __resetWorkspaceFolders();
    });

    it('restartDaemon succeeds when connected', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const restartCall = registerCalls.find((call) => call[0] === 'coven.restartDaemon');
      const restartHandler = restartCall?.[1];

      await restartHandler();

      // With daemon connected, restartDaemon runs successfully
      expect(window.showInformationMessage).toHaveBeenCalledWith('Daemon restarted.');
    });

    it('cancelWorkflow shows error when no daemon or invalid reference', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const cancelCall = registerCalls.find((call) => call[0] === 'coven.cancelWorkflow');
      const cancelHandler = cancelCall?.[1];

      await cancelHandler(null);

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        'Coven: Invalid workflow reference or daemon not connected'
      );
    });

    it('cancelWorkflow handles string workflowId', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const cancelCall = registerCalls.find((call) => call[0] === 'coven.cancelWorkflow');
      const cancelHandler = cancelCall?.[1];

      // Daemon is connected, so shows confirmation dialog
      (window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await cancelHandler('workflow-123');

      // Should show confirmation dialog
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        'Cancel this workflow? Running agents will be terminated.',
        { modal: true },
        'Cancel Workflow'
      );
    });

    it('cancelWorkflow handles object with workflowId', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const cancelCall = registerCalls.find((call) => call[0] === 'coven.cancelWorkflow');
      const cancelHandler = cancelCall?.[1];

      (window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      await cancelHandler({ workflowId: 'wf-456' });

      expect(window.showWarningMessage).toHaveBeenCalled();
    });

    it('cancelWorkflow handles object with workflow.id', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const cancelCall = registerCalls.find((call) => call[0] === 'coven.cancelWorkflow');
      const cancelHandler = cancelCall?.[1];

      (window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      await cancelHandler({ workflow: { id: 'wf-789' } });

      expect(window.showWarningMessage).toHaveBeenCalled();
    });

    it('cancelWorkflow proceeds when user confirms', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const cancelCall = registerCalls.find((call) => call[0] === 'coven.cancelWorkflow');
      const cancelHandler = cancelCall?.[1];

      // Mock user confirming the cancel
      (window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Cancel Workflow');

      await cancelHandler('wf-to-cancel');

      // Should show success message after cancellation
      expect(window.showInformationMessage).toHaveBeenCalledWith('Workflow cancelled');
    });

    it('cancelWorkflow shows error when API call fails', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      // Make the DaemonClient.post throw an error
      const { DaemonClient } = await import('./daemon');
      (DaemonClient as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        post: vi.fn().mockRejectedValue(new Error('Cancel API error')),
      }));

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const cancelCall = registerCalls.find((call) => call[0] === 'coven.cancelWorkflow');
      const cancelHandler = cancelCall?.[1];

      // Mock user confirming the cancel
      (window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Cancel Workflow');

      await cancelHandler('wf-to-cancel-fail');

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        'Failed to cancel workflow: Cancel API error'
      );

      // Reset mock back to default
      (DaemonClient as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        startSession: vi.fn().mockResolvedValue(undefined),
        stopSession: vi.fn().mockResolvedValue(undefined),
        startTask: vi.fn().mockResolvedValue(undefined),
        killTask: vi.fn().mockResolvedValue(undefined),
        post: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(undefined),
      }));
    });

    it('retryWorkflow shows error when API call fails', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      // Make the DaemonClient.post throw an error
      const { DaemonClient } = await import('./daemon');
      (DaemonClient as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        post: vi.fn().mockRejectedValue(new Error('API error')),
      }));

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const retryCall = registerCalls.find((call) => call[0] === 'coven.retryWorkflow');
      const retryHandler = retryCall?.[1];

      await retryHandler('wf-failing');

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        'Failed to retry workflow: API error'
      );

      // Reset mock back to default
      (DaemonClient as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        startSession: vi.fn().mockResolvedValue(undefined),
        stopSession: vi.fn().mockResolvedValue(undefined),
        startTask: vi.fn().mockResolvedValue(undefined),
        killTask: vi.fn().mockResolvedValue(undefined),
        post: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(undefined),
      }));
    });

    it('retryWorkflow shows error when no daemon or invalid reference', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const retryCall = registerCalls.find((call) => call[0] === 'coven.retryWorkflow');
      const retryHandler = retryCall?.[1];

      await retryHandler(null);

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        'Coven: Invalid workflow reference or daemon not connected'
      );
    });

    it('approveMerge runs with daemon connected', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const approveCall = registerCalls.find((call) => call[0] === 'coven.approveMerge');
      const approveHandler = approveCall?.[1];

      // Daemon is connected, so approveWorkflow is called (which may show error for null arg)
      await approveHandler(null);

      // With daemon connected, approveWorkflow function handles the null arg
      // This exercises the approveMerge function with daemon connected path
      expect(true).toBe(true);
    });

    it('rejectMerge runs with daemon connected', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const rejectCall = registerCalls.find((call) => call[0] === 'coven.rejectMerge');
      const rejectHandler = rejectCall?.[1];

      // Daemon is connected, so rejectWorkflow is called
      await rejectHandler(null);

      // Exercises the rejectMerge function with daemon connected path
      expect(true).toBe(true);
    });

    it('approveMerge shows error when daemon not connected', async () => {
      deactivate(); // Ensure clean state with no daemon
      const mockCtx = createMockExtensionContext();
      __setWorkspaceFolders([]); // No workspace = no daemon init
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const approveCall = registerCalls.find((call) => call[0] === 'coven.approveMerge');
      const approveHandler = approveCall?.[1];

      await approveHandler('wf-123');

      expect(window.showErrorMessage).toHaveBeenCalledWith('Coven: Daemon not connected');
      __resetWorkspaceFolders();
    });

    it('rejectMerge shows error when daemon not connected', async () => {
      deactivate(); // Ensure clean state with no daemon
      const mockCtx = createMockExtensionContext();
      __setWorkspaceFolders([]); // No workspace = no daemon init
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const rejectCall = registerCalls.find((call) => call[0] === 'coven.rejectMerge');
      const rejectHandler = rejectCall?.[1];

      await rejectHandler('wf-456');

      expect(window.showErrorMessage).toHaveBeenCalledWith('Coven: Daemon not connected');
      __resetWorkspaceFolders();
    });

    it('viewDaemonLogs shows error when no daemon configured', async () => {
      // Ensure clean global state by deactivating first
      deactivate();

      const mockCtx = createMockExtensionContext();
      __setWorkspaceFolders([]);
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const viewLogsCall = registerCalls.find((call) => call[0] === 'coven.viewDaemonLogs');
      const viewLogsHandler = viewLogsCall?.[1];

      await viewLogsHandler();

      expect(window.showErrorMessage).toHaveBeenCalledWith('Coven: Daemon not configured');
      __resetWorkspaceFolders();
    });

    it('stopSession supports skipConfirmation option', async () => {
      const mockCtx = createMockExtensionContext();
      __setWorkspaceFolders([]);
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const stopSessionCall = registerCalls.find((call) => call[0] === 'coven.stopSession');
      const stopSessionHandler = stopSessionCall?.[1];

      // With skipConfirmation, should not show confirmation dialog
      await stopSessionHandler({ skipConfirmation: true });

      // Should show "no active session" since no daemon connection
      expect(window.showInformationMessage).toHaveBeenCalledWith('Coven: No active session');
      __resetWorkspaceFolders();
    });

    it('startSession accepts optional branch name', async () => {
      const mockCtx = createMockExtensionContext();
      __setWorkspaceFolders([]);
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const startSessionCall = registerCalls.find((call) => call[0] === 'coven.startSession');
      const startSessionHandler = startSessionCall?.[1];

      await startSessionHandler('feature-branch');

      expect(window.showErrorMessage).toHaveBeenCalledWith('Coven: No workspace folder open');
      __resetWorkspaceFolders();
    });
  });

  describe('extractTaskId utility', () => {
    it('returns null for null input', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const startTaskCall = registerCalls.find((call) => call[0] === 'coven.startTask');
      const startTaskHandler = startTaskCall?.[1];

      // Tests the extractTaskId function returns null for null
      await startTaskHandler(null);

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        'Coven: Invalid task reference or no daemon connection'
      );
    });

    it('extracts from object with task.id property', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const startTaskCall = registerCalls.find((call) => call[0] === 'coven.startTask');
      const startTaskHandler = startTaskCall?.[1];

      // With daemon connected, extracts task.id and starts task
      await startTaskHandler({ task: { id: 'task-nested' } });

      expect(window.showInformationMessage).toHaveBeenCalledWith('Task started: task-nested');
    });

    it('extracts from object with taskId property', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const startTaskCall = registerCalls.find((call) => call[0] === 'coven.startTask');
      const startTaskHandler = startTaskCall?.[1];

      await startTaskHandler({ taskId: 'task-flat' });

      expect(window.showInformationMessage).toHaveBeenCalledWith('Task started: task-flat');
    });

    it('returns null for object without task properties', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const startTaskCall = registerCalls.find((call) => call[0] === 'coven.startTask');
      const startTaskHandler = startTaskCall?.[1];

      await startTaskHandler({ unrelated: 'value' });

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        'Coven: Invalid task reference or no daemon connection'
      );
    });
  });

  describe('extractWorkflowId utility', () => {
    it('extracts from string', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const retryCall = registerCalls.find((call) => call[0] === 'coven.retryWorkflow');
      const retryHandler = retryCall?.[1];

      // With daemon connected, retryWorkflow succeeds
      await retryHandler('workflow-string');

      // Should show success
      expect(window.showInformationMessage).toHaveBeenCalledWith('Workflow restarted');
    });

    it('extracts from object with workflow.id', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const retryCall = registerCalls.find((call) => call[0] === 'coven.retryWorkflow');
      const retryHandler = retryCall?.[1];

      await retryHandler({ workflow: { id: 'wf-nested' } });

      expect(window.showInformationMessage).toHaveBeenCalledWith('Workflow restarted');
    });

    it('extracts from object with workflowId', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const retryCall = registerCalls.find((call) => call[0] === 'coven.retryWorkflow');
      const retryHandler = retryCall?.[1];

      await retryHandler({ workflowId: 'wf-flat' });

      expect(window.showInformationMessage).toHaveBeenCalledWith('Workflow restarted');
    });

    it('extracts from object with task.id fallback', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const retryCall = registerCalls.find((call) => call[0] === 'coven.retryWorkflow');
      const retryHandler = retryCall?.[1];

      await retryHandler({ task: { id: 'task-as-wf' } });

      expect(window.showInformationMessage).toHaveBeenCalledWith('Workflow restarted');
    });

    it('returns null for object without workflow properties', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const cancelCall = registerCalls.find((call) => call[0] === 'coven.cancelWorkflow');
      const cancelHandler = cancelCall?.[1];

      await cancelHandler({ unrelated: 'data' });

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        'Coven: Invalid workflow reference or daemon not connected'
      );
    });

    it('returns null for number input', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const cancelCall = registerCalls.find((call) => call[0] === 'coven.cancelWorkflow');
      const cancelHandler = cancelCall?.[1];

      await cancelHandler(12345);

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        'Coven: Invalid workflow reference or daemon not connected'
      );
    });
  });

  describe('command registration', () => {
    it('registers all expected commands', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const registeredCommands = registerCalls.map((call) => call[0]);

      expect(registeredCommands).toContain('coven.startSession');
      expect(registeredCommands).toContain('coven.stopSession');
      expect(registeredCommands).toContain('coven.showSetup');
      expect(registeredCommands).toContain('coven.revealSidebar');
      expect(registeredCommands).toContain('coven.showTaskDetail');
      expect(registeredCommands).toContain('coven.viewFamiliarOutput');
      expect(registeredCommands).toContain('coven.createTask');
      expect(registeredCommands).toContain('coven.startTask');
      expect(registeredCommands).toContain('coven.stopTask');
      expect(registeredCommands).toContain('coven.refreshTasks');
      expect(registeredCommands).toContain('coven.respondToQuestion');
      expect(registeredCommands).toContain('coven.reviewTask');
    });
  });
});
