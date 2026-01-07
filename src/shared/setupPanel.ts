import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  PrerequisitesStatus,
  ToolStatus,
  InitStatus,
  checkPrerequisites,
  refreshPrerequisites,
} from './prerequisites';

const execAsync = promisify(exec);

export class SetupPanel {
  public static currentPanel: SetupPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _status: PrerequisitesStatus;

  public static createOrShow(
    extensionUri: vscode.Uri,
    status: PrerequisitesStatus
  ): SetupPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (SetupPanel.currentPanel) {
      SetupPanel.currentPanel._panel.reveal(column);
      SetupPanel.currentPanel._status = status;
      SetupPanel.currentPanel._update();
      return SetupPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'covenSetup',
      'Coven Setup',
      column,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
      }
    );

    SetupPanel.currentPanel = new SetupPanel(panel, extensionUri, status);
    return SetupPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    status: PrerequisitesStatus
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._status = status;

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message: { command: string }) => {
        switch (message.command) {
          case 'initOpenspec':
            await this._initOpenspec();
            break;
          case 'initBeads':
            await this._initBeads();
            break;
          case 'refresh':
            await this._refresh();
            break;
        }
      },
      null,
      this._disposables
    );
  }

  public dispose(): void {
    SetupPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      d?.dispose();
    }
  }

  private async _initOpenspec(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    try {
      await execAsync('openspec init --tools claude', { cwd: workspaceRoot });
      vscode.window.showInformationMessage('OpenSpec initialized successfully');
      await this._refresh();
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to initialize OpenSpec: ${String(err)}`);
    }
  }

  private async _initBeads(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    try {
      await execAsync('bd init', { cwd: workspaceRoot });
      vscode.window.showInformationMessage('Beads initialized successfully');
      await this._refresh();
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to initialize Beads: ${String(err)}`);
    }
  }

  private async _refresh(): Promise<void> {
    refreshPrerequisites();
    this._status = await checkPrerequisites();
    this._update();

    if (this._status.allMet) {
      vscode.window.showInformationMessage('All prerequisites met! You can now start a session.');
      this._panel.dispose();
    }
  }

  private _update(): void {
    this._panel.webview.html = this._getHtmlForWebview();
  }

  private _getHtmlForWebview(): string {
    const toolsHtml = this._status.tools.map((t) => this._renderToolStatus(t)).join('');
    const initsHtml = this._status.inits.map((i) => this._renderInitStatus(i)).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Coven Setup</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
    }
    h1 { margin-bottom: 8px; }
    h2 { margin-top: 24px; margin-bottom: 12px; }
    .status-item {
      display: flex;
      align-items: center;
      padding: 8px 12px;
      margin: 4px 0;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 4px;
    }
    .status-icon { margin-right: 8px; font-size: 16px; }
    .status-ok { color: var(--vscode-testing-iconPassed); }
    .status-missing { color: var(--vscode-testing-iconFailed); }
    .status-name { flex: 1; }
    .status-version { color: var(--vscode-descriptionForeground); font-size: 12px; }
    a { color: var(--vscode-textLink-foreground); }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      margin-right: 8px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .actions { margin-top: 24px; }
  </style>
</head>
<body>
  <h1>Coven Setup</h1>
  <p>Complete the following prerequisites to start using Coven.</p>

  <h2>CLI Tools</h2>
  ${toolsHtml}

  <h2>Repository Initialization</h2>
  ${initsHtml}

  <div class="actions">
    <button onclick="refresh()">Check Again</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function initOpenspec() { vscode.postMessage({ command: 'initOpenspec' }); }
    function initBeads() { vscode.postMessage({ command: 'initBeads' }); }
    function refresh() { vscode.postMessage({ command: 'refresh' }); }
  </script>
</body>
</html>`;
  }

  private _renderToolStatus(tool: ToolStatus): string {
    const icon = tool.available ? '&#10003;' : '&#10007;';
    const iconClass = tool.available ? 'status-ok' : 'status-missing';
    const version = tool.version ? `<span class="status-version">${tool.version}</span>` : '';
    const installLink = !tool.available && tool.installUrl
      ? `<a href="${tool.installUrl}" target="_blank">Install</a>`
      : '';

    return `<div class="status-item">
      <span class="status-icon ${iconClass}">${icon}</span>
      <span class="status-name">${tool.name}</span>
      ${version}
      ${installLink}
    </div>`;
  }

  private _renderInitStatus(init: InitStatus): string {
    const icon = init.initialized ? '&#10003;' : '&#10007;';
    const iconClass = init.initialized ? 'status-ok' : 'status-missing';
    const initButton = !init.initialized
      ? `<button onclick="init${init.name.charAt(0).toUpperCase() + init.name.slice(1)}()">Initialize</button>`
      : '';

    return `<div class="status-item">
      <span class="status-icon ${iconClass}">${icon}</span>
      <span class="status-name">${init.name}</span>
      ${initButton}
    </div>`;
  }
}
