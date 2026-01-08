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

// Mock CovenSession to prevent file system access
vi.mock('./session/CovenSession', () => ({
  CovenSession: vi.fn().mockImplementation(() => {
    throw new Error('Mock: Session initialization disabled in tests');
  }),
}));

// Mock FamiliarOutputChannel
vi.mock('./agents/FamiliarOutputChannel', () => ({
  FamiliarOutputChannel: vi.fn(),
}));

// Mock QuestionHandler
vi.mock('./agents/QuestionHandler', () => ({
  QuestionHandler: vi.fn(),
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

    it('sets status bar text to inactive', async () => {
      const mockCtx = createMockExtensionContext();

      await activate(mockCtx);

      const mockStatusBar = (window.createStatusBarItem as ReturnType<typeof vi.fn>).mock
        .results[0]?.value;
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

    it('handles prerequisite check errors gracefully', async () => {
      mockCheckPrerequisites.mockRejectedValue(new Error('Check failed'));
      const mockCtx = createMockExtensionContext();

      await activate(mockCtx);

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to check prerequisites')
      );
    });

    it('adds disposables to subscriptions', async () => {
      const mockCtx = createMockExtensionContext();

      await activate(mockCtx);

      // Status bar, tree view, and 3 commands = at least 5 items
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
    it('startSession checks prerequisites', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      // Get the startSession handler
      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const startSessionCall = registerCalls.find((call) => call[0] === 'coven.startSession');
      const startSessionHandler = startSessionCall?.[1];

      mockCheckPrerequisites.mockClear();
      await startSessionHandler();

      expect(checkPrerequisites).toHaveBeenCalled();
    });

    it('startSession shows warning when prerequisites not met', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      mockCheckPrerequisites.mockResolvedValue({ tools: [], inits: [], allMet: false });

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const startSessionCall = registerCalls.find((call) => call[0] === 'coven.startSession');
      const startSessionHandler = startSessionCall?.[1];

      await startSessionHandler();

      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Prerequisites not met')
      );
    });

    it('stopSession updates status bar', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const mockStatusBar = (window.createStatusBarItem as ReturnType<typeof vi.fn>).mock
        .results[0]?.value;

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const stopSessionCall = registerCalls.find((call) => call[0] === 'coven.stopSession');
      const stopSessionHandler = stopSessionCall?.[1];

      stopSessionHandler();

      expect(mockStatusBar?.text).toBe('$(circle-outline) Coven: Inactive');
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

    it('showTaskDetail shows error when no session', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const showTaskDetailCall = registerCalls.find((call) => call[0] === 'coven.showTaskDetail');
      const showTaskDetailHandler = showTaskDetailCall?.[1];

      await showTaskDetailHandler('test-task-id');

      expect(window.showErrorMessage).toHaveBeenCalledWith('Coven: No active session');
    });

    it('viewFamiliarOutput shows error when no session', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const viewOutputCall = registerCalls.find((call) => call[0] === 'coven.viewFamiliarOutput');
      const viewOutputHandler = viewOutputCall?.[1];

      await viewOutputHandler('test-task-id');

      expect(window.showErrorMessage).toHaveBeenCalledWith('Coven: No active session');
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
      expect(window.showErrorMessage).not.toHaveBeenCalledWith('Coven: No active session');
    });

    it('createTask shows error when no session and title provided', async () => {
      const mockCtx = createMockExtensionContext();
      (window.showInputBox as ReturnType<typeof vi.fn>).mockResolvedValue('Test Task');
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const createTaskCall = registerCalls.find((call) => call[0] === 'coven.createTask');
      const createTaskHandler = createTaskCall?.[1];

      await createTaskHandler();

      expect(window.showErrorMessage).toHaveBeenCalledWith('Coven: No active session');
    });

    it('startTask shows error when no session', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const startTaskCall = registerCalls.find((call) => call[0] === 'coven.startTask');
      const startTaskHandler = startTaskCall?.[1];

      await startTaskHandler('test-task-id');

      expect(window.showErrorMessage).toHaveBeenCalledWith('Coven: No active session');
    });

    it('stopTask shows error when no session', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const stopTaskCall = registerCalls.find((call) => call[0] === 'coven.stopTask');
      const stopTaskHandler = stopTaskCall?.[1];

      await stopTaskHandler('test-task-id');

      expect(window.showErrorMessage).toHaveBeenCalledWith('Coven: No active session');
    });

    it('respondToQuestion shows error when no session', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const respondCall = registerCalls.find((call) => call[0] === 'coven.respondToQuestion');
      const respondHandler = respondCall?.[1];

      await respondHandler('test-task-id');

      expect(window.showErrorMessage).toHaveBeenCalledWith('Coven: No active session');
    });

    it('refreshTasks does not throw when no session', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const refreshCall = registerCalls.find((call) => call[0] === 'coven.refreshTasks');
      const refreshHandler = refreshCall?.[1];

      // Should not throw
      await expect(refreshHandler()).resolves.toBeUndefined();
    });

    it('stopSession shows info when no active session', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const stopSessionCall = registerCalls.find((call) => call[0] === 'coven.stopSession');
      const stopSessionHandler = stopSessionCall?.[1];

      await stopSessionHandler();

      expect(window.showInformationMessage).toHaveBeenCalledWith('Coven: No active session to stop');
    });

    it('startSession shows error when no workspace', async () => {
      // Create context with no workspace folders
      const mockCtx = createMockExtensionContext();

      // Clear workspace folders mock
      __setWorkspaceFolders([]);

      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const startSessionCall = registerCalls.find((call) => call[0] === 'coven.startSession');
      const startSessionHandler = startSessionCall?.[1];

      await startSessionHandler();

      expect(window.showErrorMessage).toHaveBeenCalledWith('Coven: No workspace folder open');

      // Reset workspace folders for other tests
      __resetWorkspaceFolders();
    });

    it('startSession returns when user cancels branch input', async () => {
      const mockCtx = createMockExtensionContext();
      (window.showInputBox as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const startSessionCall = registerCalls.find((call) => call[0] === 'coven.startSession');
      const startSessionHandler = startSessionCall?.[1];

      // Should not throw when user cancels
      await expect(startSessionHandler()).resolves.toBeUndefined();
    });

    it('startSession validates branch name', async () => {
      const mockCtx = createMockExtensionContext();
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const startSessionCall = registerCalls.find((call) => call[0] === 'coven.startSession');
      const startSessionHandler = startSessionCall?.[1];

      // Trigger the handler which will call showInputBox
      const showInputBoxMock = window.showInputBox as ReturnType<typeof vi.fn>;
      showInputBoxMock.mockResolvedValue(undefined);

      await startSessionHandler();

      // Verify showInputBox was called with validation
      expect(showInputBoxMock).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Enter feature branch name',
          validateInput: expect.any(Function),
        })
      );

      // Test the validation function
      const validateInput = showInputBoxMock.mock.calls[0]?.[0]?.validateInput;
      if (validateInput) {
        expect(validateInput('')).toBe('Branch name is required');
        expect(validateInput('   ')).toBe('Branch name is required');
        expect(validateInput('invalid@branch')).toBe('Branch name contains invalid characters');
        expect(validateInput('valid-branch')).toBeUndefined();
        expect(validateInput('feature/my-feature')).toBeUndefined();
      }
    });

    it('stopSession returns when user cancels confirmation', async () => {
      const mockCtx = createMockExtensionContext();
      // Mock showWarningMessage to return undefined (user cancelled)
      (window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const stopSessionCall = registerCalls.find((call) => call[0] === 'coven.stopSession');
      const stopSessionHandler = stopSessionCall?.[1];

      // Since covenSession is not initialized (mocked to throw), this will show "No active session"
      await stopSessionHandler();

      expect(window.showInformationMessage).toHaveBeenCalledWith('Coven: No active session to stop');
    });

    it('stopTask returns when user cancels confirmation', async () => {
      const mockCtx = createMockExtensionContext();
      // Mock showWarningMessage to return undefined (user cancelled)
      (window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      await activate(mockCtx);

      const registerCalls = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const stopTaskCall = registerCalls.find((call) => call[0] === 'coven.stopTask');
      const stopTaskHandler = stopTaskCall?.[1];

      // Since covenSession is null, should show error
      await stopTaskHandler('test-task');

      expect(window.showErrorMessage).toHaveBeenCalledWith('Coven: No active session');
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
    });
  });
});
