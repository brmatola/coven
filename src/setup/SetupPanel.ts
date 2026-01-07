import * as vscode from 'vscode';
import { WebviewPanel } from '../shared/webview/WebviewPanel';
import { MessageRouter } from '../shared/messageRouter';
import { SetupState, SetupMessageToExtension } from './types';
import { checkPrerequisites, refreshPrerequisites, initOpenspec, initBeads } from './prerequisites';
import { getLogger } from '../shared/logger';

export class SetupPanel extends WebviewPanel<SetupState, SetupMessageToExtension> {
  public static currentPanel: SetupPanel | undefined;
  private readonly router: MessageRouter<SetupMessageToExtension>;

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
    this.router = new MessageRouter<SetupMessageToExtension>()
      .on('initOpenspec', () => this.handleInitOpenspec())
      .on('initBeads', () => this.handleInitBeads())
      .on('refresh', () => this.refreshState());
  }

  protected getWebviewName(): string {
    return 'setup';
  }

  protected async onMessage(message: SetupMessageToExtension): Promise<void> {
    const handled = await this.router.route(message);
    if (!handled) {
      getLogger().warn('Unhandled message type in SetupPanel', { type: message.type });
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
