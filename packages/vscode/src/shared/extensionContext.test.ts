import { describe, it, expect, beforeEach } from 'vitest';
import { ExtensionContext } from './extensionContext';
import { disposeLogger } from './logger';
import { disposeEventBus } from './eventBus';
import type * as vscode from 'vscode';

// Create a mock VS Code extension context
function createMockContext(): vscode.ExtensionContext {
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

describe('ExtensionContext', () => {
  beforeEach(() => {
    // Reset all singletons
    ExtensionContext.dispose();
    disposeLogger();
    disposeEventBus();
  });

  describe('initialize()', () => {
    it('creates an ExtensionContext instance', () => {
      const mockCtx = createMockContext();

      const ctx = ExtensionContext.initialize(mockCtx);

      expect(ctx).toBeDefined();
      expect(ctx.extensionUri).toBe(mockCtx.extensionUri);
    });

    it('throws if called twice', () => {
      const mockCtx = createMockContext();
      ExtensionContext.initialize(mockCtx);

      expect(() => ExtensionContext.initialize(mockCtx)).toThrow(
        'ExtensionContext already initialized'
      );
    });

    it('provides access to subscriptions array', () => {
      const mockCtx = createMockContext();
      const ctx = ExtensionContext.initialize(mockCtx);

      expect(ctx.subscriptions).toBe(mockCtx.subscriptions);
    });

    it('provides a logger instance', () => {
      const mockCtx = createMockContext();
      const ctx = ExtensionContext.initialize(mockCtx);

      expect(ctx.logger).toBeDefined();
      expect(typeof ctx.logger.info).toBe('function');
    });
  });

  describe('get()', () => {
    it('returns the initialized context', () => {
      const mockCtx = createMockContext();
      const initialized = ExtensionContext.initialize(mockCtx);

      const retrieved = ExtensionContext.get();

      expect(retrieved).toBe(initialized);
    });

    it('throws if not initialized', () => {
      expect(() => ExtensionContext.get()).toThrow(
        'ExtensionContext not initialized'
      );
    });
  });

  describe('isInitialized()', () => {
    it('returns false before initialization', () => {
      expect(ExtensionContext.isInitialized()).toBe(false);
    });

    it('returns true after initialization', () => {
      ExtensionContext.initialize(createMockContext());

      expect(ExtensionContext.isInitialized()).toBe(true);
    });

    it('returns false after dispose', () => {
      ExtensionContext.initialize(createMockContext());
      ExtensionContext.dispose();

      expect(ExtensionContext.isInitialized()).toBe(false);
    });
  });

  describe('dispose()', () => {
    it('clears the singleton instance', () => {
      ExtensionContext.initialize(createMockContext());

      ExtensionContext.dispose();

      expect(ExtensionContext.isInitialized()).toBe(false);
    });

    it('allows re-initialization after dispose', () => {
      const mockCtx1 = createMockContext();
      const mockCtx2 = createMockContext();
      mockCtx2.extensionUri = { fsPath: '/different/path' } as vscode.Uri;

      ExtensionContext.initialize(mockCtx1);
      ExtensionContext.dispose();
      const newCtx = ExtensionContext.initialize(mockCtx2);

      expect(newCtx.extensionUri.fsPath).toBe('/different/path');
    });

    it('does not throw when called multiple times', () => {
      ExtensionContext.initialize(createMockContext());
      ExtensionContext.dispose();

      expect(() => ExtensionContext.dispose()).not.toThrow();
    });
  });

  describe('statusBarItem', () => {
    it('is null by default', () => {
      const ctx = ExtensionContext.initialize(createMockContext());

      expect(ctx.statusBarItem).toBeNull();
    });

    it('can be set and retrieved', () => {
      const ctx = ExtensionContext.initialize(createMockContext());
      const mockStatusBar = { text: 'test' } as vscode.StatusBarItem;

      ctx.statusBarItem = mockStatusBar;

      expect(ctx.statusBarItem).toBe(mockStatusBar);
    });
  });
});
