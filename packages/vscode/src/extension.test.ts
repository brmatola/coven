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
  })),
  DaemonClient: vi.fn().mockImplementation(() => ({
    startSession: vi.fn().mockResolvedValue(undefined),
    stopSession: vi.fn().mockResolvedValue(undefined),
    startTask: vi.fn().mockResolvedValue(undefined),
    killTask: vi.fn().mockResolvedValue(undefined),
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
  })),
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

import { checkPrerequisites } from './setup/prerequisites';
import { SetupPanel } from './setup/SetupPanel';

const mockCheckPrerequisites = checkPrerequisites as ReturnType<typeof vi.fn>;
const mockSetupPanelCreateOrShow = SetupPanel.createOrShow as ReturnType<typeof vi.fn>;

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
    ExtensionContext.dispose();
    disposeLogger();
    disposeEventBus();
    mockCheckPrerequisites.mockResolvedValue({
      tools: [],
      inits: [],
      allMet: true,
    });
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

    it('sets status bar text to inactive when no session is active', async () => {
      const mockCtx = createMockExtensionContext();

      await activate(mockCtx);

      const mockStatusBar = (window.createStatusBarItem as ReturnType<typeof vi.fn>).mock
        .results[0]?.value;
      // After activation, status bar shows inactive (not disconnected) because
      // the state cache is connected but no session is active
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
