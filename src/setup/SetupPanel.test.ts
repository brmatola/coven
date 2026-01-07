import { describe, it, expect, vi, beforeEach } from 'vitest';
import { window, Uri } from 'vscode';
import { SetupPanel } from './SetupPanel';
import { disposeLogger } from '../shared/logger';

// Mock prerequisites module
vi.mock('./prerequisites', () => ({
  checkPrerequisites: vi.fn(),
  refreshPrerequisites: vi.fn(),
  initOpenspec: vi.fn(),
  initBeads: vi.fn(),
}));

import { checkPrerequisites, refreshPrerequisites, initOpenspec, initBeads } from './prerequisites';

const mockCheckPrerequisites = checkPrerequisites as ReturnType<typeof vi.fn>;
const mockInitOpenspec = initOpenspec as ReturnType<typeof vi.fn>;
const mockInitBeads = initBeads as ReturnType<typeof vi.fn>;

function createMockPrerequisitesResult(allMet: boolean) {
  return {
    tools: [
      { name: 'git', available: true, version: 'git 2.40.0', installUrl: 'https://git-scm.com' },
    ],
    inits: [{ name: 'openspec', initialized: allMet }],
    allMet,
  };
}

describe('SetupPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    SetupPanel.currentPanel = undefined;
    disposeLogger();
    mockCheckPrerequisites.mockResolvedValue(createMockPrerequisitesResult(false));
  });

  describe('createOrShow()', () => {
    it('creates a new webview panel', async () => {
      const extensionUri = new Uri('/mock/extension');

      await SetupPanel.createOrShow(extensionUri);

      expect(window.createWebviewPanel).toHaveBeenCalledWith(
        'covenSetup',
        'Coven Setup',
        expect.any(Number),
        expect.objectContaining({
          enableScripts: true,
          retainContextWhenHidden: true,
        })
      );
    });

    it('sets currentPanel after creation', async () => {
      const extensionUri = new Uri('/mock/extension');

      const panel = await SetupPanel.createOrShow(extensionUri);

      expect(SetupPanel.currentPanel).toBe(panel);
    });

    it('returns existing panel if already open', async () => {
      const extensionUri = new Uri('/mock/extension');

      const first = await SetupPanel.createOrShow(extensionUri);
      const second = await SetupPanel.createOrShow(extensionUri);

      expect(first).toBe(second);
      expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
    });

    it('reveals existing panel when called again', async () => {
      const extensionUri = new Uri('/mock/extension');

      await SetupPanel.createOrShow(extensionUri);
      const mockPanel = (window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.results[0]
        ?.value;

      await SetupPanel.createOrShow(extensionUri);

      expect(mockPanel.reveal).toHaveBeenCalled();
    });

    it('checks prerequisites on creation', async () => {
      const extensionUri = new Uri('/mock/extension');

      await SetupPanel.createOrShow(extensionUri);

      expect(refreshPrerequisites).toHaveBeenCalled();
      expect(checkPrerequisites).toHaveBeenCalled();
    });
  });

  describe('dispose()', () => {
    it('clears currentPanel when disposed', async () => {
      const extensionUri = new Uri('/mock/extension');
      const panel = await SetupPanel.createOrShow(extensionUri);

      panel.dispose();

      expect(SetupPanel.currentPanel).toBeUndefined();
    });
  });

  describe('getWebviewName()', () => {
    it('returns "setup" for webview asset loading', async () => {
      const extensionUri = new Uri('/mock/extension');
      await SetupPanel.createOrShow(extensionUri);

      // The webview name is used internally - we verify by checking the HTML
      // contains references to the setup webview path
      const mockPanel = (window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.results[0]
        ?.value;
      expect(mockPanel.webview.html).toContain('setup');
    });
  });

  describe('message handling', () => {
    it('handles initOpenspec message', async () => {
      mockInitOpenspec.mockResolvedValue(undefined);
      const extensionUri = new Uri('/mock/extension');
      await SetupPanel.createOrShow(extensionUri);

      // Get the message handler that was registered
      const mockPanel = (window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.results[0]
        ?.value;
      const messageHandler = mockPanel.webview.onDidReceiveMessage.mock.calls[0]?.[0];

      // Simulate receiving initOpenspec message
      await messageHandler({ type: 'initOpenspec' });

      expect(initOpenspec).toHaveBeenCalled();
    });

    it('handles initBeads message', async () => {
      mockInitBeads.mockResolvedValue(undefined);
      const extensionUri = new Uri('/mock/extension');
      await SetupPanel.createOrShow(extensionUri);

      const mockPanel = (window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.results[0]
        ?.value;
      const messageHandler = mockPanel.webview.onDidReceiveMessage.mock.calls[0]?.[0];

      await messageHandler({ type: 'initBeads' });

      expect(initBeads).toHaveBeenCalled();
    });

    it('handles refresh message', async () => {
      const extensionUri = new Uri('/mock/extension');
      await SetupPanel.createOrShow(extensionUri);

      const mockPanel = (window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.results[0]
        ?.value;
      const messageHandler = mockPanel.webview.onDidReceiveMessage.mock.calls[0]?.[0];

      // Clear call counts but keep the mock implementation
      mockCheckPrerequisites.mockClear();
      (refreshPrerequisites as ReturnType<typeof vi.fn>).mockClear();

      await messageHandler({ type: 'refresh' });

      expect(refreshPrerequisites).toHaveBeenCalled();
      expect(checkPrerequisites).toHaveBeenCalled();
    });

    it('shows success message after initOpenspec', async () => {
      mockInitOpenspec.mockResolvedValue(undefined);
      const extensionUri = new Uri('/mock/extension');
      await SetupPanel.createOrShow(extensionUri);

      const mockPanel = (window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.results[0]
        ?.value;
      const messageHandler = mockPanel.webview.onDidReceiveMessage.mock.calls[0]?.[0];

      await messageHandler({ type: 'initOpenspec' });

      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'OpenSpec initialized successfully'
      );
    });

    it('shows error message when initOpenspec fails', async () => {
      mockInitOpenspec.mockRejectedValue(new Error('Init failed'));
      const extensionUri = new Uri('/mock/extension');
      await SetupPanel.createOrShow(extensionUri);

      const mockPanel = (window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.results[0]
        ?.value;
      const messageHandler = mockPanel.webview.onDidReceiveMessage.mock.calls[0]?.[0];

      await messageHandler({ type: 'initOpenspec' });

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize OpenSpec')
      );
    });
  });

  describe('session-config phase transition', () => {
    it('transitions to session-config phase when all prerequisites are met', async () => {
      mockCheckPrerequisites.mockResolvedValue(createMockPrerequisitesResult(true));
      const extensionUri = new Uri('/mock/extension');

      await SetupPanel.createOrShow(extensionUri);

      const mockPanel = (window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.results[0]
        ?.value;

      // Panel should remain open and transition to session-config phase
      expect(SetupPanel.currentPanel).toBeDefined();
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'state',
          payload: expect.objectContaining({
            phase: 'session-config',
            allMet: true,
          }),
        })
      );
    });
  });
});
