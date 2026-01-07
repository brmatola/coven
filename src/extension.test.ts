import { describe, it, expect, vi, beforeEach } from 'vitest';
import { window, commands } from 'vscode';
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

import { checkPrerequisites } from './setup/prerequisites';
import { SetupPanel } from './setup/SetupPanel';

const mockCheckPrerequisites = checkPrerequisites as ReturnType<typeof vi.fn>;
const mockSetupPanelCreateOrShow = SetupPanel.createOrShow as ReturnType<typeof vi.fn>;

function createMockExtensionContext(): vscode.ExtensionContext {
  return {
    extensionUri: { fsPath: '/mock/extension' } as vscode.Uri,
    subscriptions: [],
    workspaceState: {} as vscode.Memento,
    globalState: {} as vscode.Memento & { setKeysForSync: (keys: readonly string[]) => void },
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
  });
});
