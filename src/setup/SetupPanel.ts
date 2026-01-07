import * as vscode from 'vscode';
import { WebviewPanel } from '../shared/webview/WebviewPanel';
import { SetupState, SetupMessageToExtension } from './types';
import { checkPrerequisites, refreshPrerequisites, initOpenspec, initBeads } from './prerequisites';

export class SetupPanel extends WebviewPanel<SetupState, SetupMessageToExtension> {
  public static currentPanel: SetupPanel | undefined;

  public static async createOrShow(extensionUri: vscode.Uri): Promise<SetupPanel> {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (SetupPanel.currentPanel) {
      SetupPanel.currentPanel.reveal(column);
      await SetupPanel.currentPanel.refreshState();
      return SetupPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel('covenSetup', 'Coven Setup', column, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webviews')],
      retainContextWhenHidden: true,
    });

    SetupPanel.currentPanel = new SetupPanel(panel, extensionUri);
    await SetupPanel.currentPanel.refreshState();
    return SetupPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    super(panel, extensionUri);
  }

  protected getWebviewName(): string {
    return 'setup';
  }

  protected async onMessage(message: SetupMessageToExtension): Promise<void> {
    switch (message.type) {
      case 'initOpenspec':
        await this.handleInitOpenspec();
        break;
      case 'initBeads':
        await this.handleInitBeads();
        break;
      case 'refresh':
        await this.refreshState();
        break;
    }
  }

  public override dispose(): void {
    SetupPanel.currentPanel = undefined;
    super.dispose();
  }

  private async refreshState(): Promise<void> {
    refreshPrerequisites();
    const state = await checkPrerequisites();
    this.updateState(state);

    if (state.allMet) {
      await vscode.window.showInformationMessage(
        'All prerequisites met! You can now start a session.'
      );
      this.dispose();
    }
  }

  private async handleInitOpenspec(): Promise<void> {
    try {
      await initOpenspec();
      await vscode.window.showInformationMessage('OpenSpec initialized successfully');
      await this.refreshState();
    } catch (err) {
      await vscode.window.showErrorMessage(`Failed to initialize OpenSpec: ${String(err)}`);
    }
  }

  private async handleInitBeads(): Promise<void> {
    try {
      await initBeads();
      await vscode.window.showInformationMessage('Beads initialized successfully');
      await this.refreshState();
    } catch (err) {
      await vscode.window.showErrorMessage(`Failed to initialize Beads: ${String(err)}`);
    }
  }
}
