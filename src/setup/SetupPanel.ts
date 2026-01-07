import * as vscode from 'vscode';
import { WebviewPanel } from '../shared/webview/WebviewPanel';
import { MessageRouter } from '../shared/messageRouter';
import {
  SetupState,
  SetupMessageToExtension,
  SetupPhase,
  BranchInfo,
  SessionConfig,
} from './types';
import { checkPrerequisites, refreshPrerequisites, initOpenspec, initBeads } from './prerequisites';
import { getLogger } from '../shared/logger';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class SetupPanel extends WebviewPanel<SetupState, SetupMessageToExtension> {
  public static currentPanel: SetupPanel | undefined;
  private readonly router: MessageRouter<SetupMessageToExtension>;
  private readonly workspaceRoot: string | undefined;

  private currentPhase: SetupPhase = 'prerequisites';
  private availableBranches: string[] = [];
  private selectedBranch: BranchInfo | null = null;
  private sessionConfig: SessionConfig = {
    maxConcurrentAgents: 3,
    worktreeBasePath: '.coven/worktrees',
    autoApprove: false,
  };

  // Callback when session should be started
  private onBeginSession?: (branchName: string, config: SessionConfig) => Promise<void>;

  public static async createOrShow(
    extensionUri: vscode.Uri,
    workspaceRoot?: string,
    onBeginSession?: (branchName: string, config: SessionConfig) => Promise<void>
  ): Promise<SetupPanel> {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (SetupPanel.currentPanel) {
      SetupPanel.currentPanel.reveal(column);
      SetupPanel.currentPanel.onBeginSession = onBeginSession;
      await SetupPanel.currentPanel.refreshState();
      return SetupPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel('covenSetup', 'Coven Setup', column, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webviews')],
      retainContextWhenHidden: true,
    });

    SetupPanel.currentPanel = new SetupPanel(panel, extensionUri, workspaceRoot, onBeginSession);
    await SetupPanel.currentPanel.refreshState();
    return SetupPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    workspaceRoot?: string,
    onBeginSession?: (branchName: string, config: SessionConfig) => Promise<void>
  ) {
    super(panel, extensionUri);
    this.workspaceRoot = workspaceRoot;
    this.onBeginSession = onBeginSession;
    this.router = new MessageRouter<SetupMessageToExtension>()
      .on('initOpenspec', () => this.handleInitOpenspec())
      .on('initBeads', () => this.handleInitBeads())
      .on('refresh', () => this.refreshState())
      .on('fetchBranches', () => this.handleFetchBranches())
      .on('selectBranch', (msg) => this.handleSelectBranch(msg.payload))
      .on('updateConfig', (msg) => this.handleUpdateConfig(msg.payload))
      .on('beginSession', () => this.handleBeginSession());
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
    const prereqState = await checkPrerequisites();

    // If prerequisites are met, transition to session-config phase
    if (prereqState.allMet && this.currentPhase === 'prerequisites') {
      this.currentPhase = 'session-config';
      await this.fetchBranches();
    }

    const state: SetupState = {
      phase: this.currentPhase,
      ...prereqState,
      availableBranches: this.availableBranches,
      selectedBranch: this.selectedBranch,
      sessionConfig: this.sessionConfig,
    };

    this.updateState(state);
  }

  private async fetchBranches(): Promise<void> {
    if (!this.workspaceRoot) {
      this.availableBranches = [];
      return;
    }

    try {
      const { stdout } = await execAsync('git branch -a --format="%(refname:short)"', {
        cwd: this.workspaceRoot,
      });
      this.availableBranches = stdout
        .split('\n')
        .map((b) => b.trim())
        .filter((b) => b && !b.startsWith('origin/HEAD'));
    } catch (err) {
      getLogger().warn('Failed to fetch branches', { error: String(err) });
      this.availableBranches = [];
    }
  }

  private async handleFetchBranches(): Promise<void> {
    await this.fetchBranches();
    await this.refreshState();
  }

  private handleSelectBranch(branch: BranchInfo): void {
    this.selectedBranch = branch;
    void this.refreshState();
  }

  private handleUpdateConfig(config: Partial<SessionConfig>): void {
    this.sessionConfig = { ...this.sessionConfig, ...config };
    void this.refreshState();
  }

  private async handleBeginSession(): Promise<void> {
    if (!this.selectedBranch) {
      await vscode.window.showErrorMessage('Please select or create a branch first');
      return;
    }

    try {
      if (this.onBeginSession) {
        await this.onBeginSession(this.selectedBranch.name, this.sessionConfig);
      }
      this.dispose();
    } catch (err) {
      await vscode.window.showErrorMessage(`Failed to start session: ${String(err)}`);
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
