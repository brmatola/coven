import * as vscode from 'vscode';
import {
  detectWorkspaceComponents,
  WorkspaceDetectionState,
  DetectionStatus,
  GitDetectionResult,
  BeadsDetectionResult,
  CovenDetectionResult,
  OpenSpecDetectionResult,
} from './detection';
import { onDidInitializeComponent } from './commands';

/**
 * Tree item types for the setup view
 */
export type SetupTreeItemType = 'component' | 'action' | 'header';

/**
 * Component identifiers
 */
export type ComponentId = 'git' | 'beads' | 'coven' | 'openspec';

/**
 * TreeDataProvider for the workspace setup view.
 * Shows a checklist of workspace components and their initialization status.
 */
export class SetupTreeProvider implements vscode.TreeDataProvider<SetupTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SetupTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private detectionState: WorkspaceDetectionState | null = null;
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private initSubscription: vscode.Disposable | null = null;

  constructor() {
    this.setupFileWatcher();
    this.setupInitSubscription();
  }

  /**
   * Refresh the tree view with current detection state.
   */
  async refresh(): Promise<void> {
    this.detectionState = await detectWorkspaceComponents();
    this._onDidChangeTreeData.fire();
  }

  /**
   * Get the tree item representation for display.
   */
  getTreeItem(element: SetupTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Get children for a tree element.
   */
  async getChildren(element?: SetupTreeItem): Promise<SetupTreeItem[]> {
    // Fetch detection state if not cached
    if (!this.detectionState) {
      this.detectionState = await detectWorkspaceComponents();
    }

    // Root level: show components
    if (!element) {
      return this.getRootChildren();
    }

    // Component items can have an action button as child
    if (element instanceof ComponentItem && element.needsAction) {
      return [this.createActionItem(element.componentId, element.isDisabled, element.disabledReason)];
    }

    return [];
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this._onDidChangeTreeData.dispose();
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }
    if (this.initSubscription) {
      this.initSubscription.dispose();
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private getRootChildren(): SetupTreeItem[] {
    if (!this.detectionState) {
      return [];
    }

    const items: SetupTreeItem[] = [];
    const { git, beads, coven, openspec } = this.detectionState;

    // Git is always first and has no dependencies
    items.push(this.createGitItem(git));

    // Beads depends on git
    items.push(this.createBeadsItem(beads, git.status === 'complete'));

    // Coven depends on git
    items.push(this.createCovenItem(coven, git.status === 'complete'));

    // OpenSpec depends on git (optional component)
    items.push(this.createOpenSpecItem(openspec, git.status === 'complete'));

    return items;
  }

  private createGitItem(detection: GitDetectionResult): ComponentItem {
    const needsAction = detection.status !== 'complete';
    const description = detection.status === 'complete' ? detection.currentBranch : undefined;

    return new ComponentItem('git', 'Git Repository', detection.status, needsAction, false, undefined, description);
  }

  private createBeadsItem(detection: BeadsDetectionResult, gitComplete: boolean): ComponentItem {
    const needsAction = detection.status !== 'complete';
    const isDisabled = !gitComplete;
    const disabledReason = isDisabled ? 'Git repository required first' : undefined;
    const description = detection.status === 'complete' ? detection.cliVersion : undefined;

    return new ComponentItem('beads', 'Beads', detection.status, needsAction, isDisabled, disabledReason, description);
  }

  private createCovenItem(detection: CovenDetectionResult, gitComplete: boolean): ComponentItem {
    const needsAction = detection.status !== 'complete';
    const isDisabled = !gitComplete;
    const disabledReason = isDisabled ? 'Git repository required first' : undefined;

    return new ComponentItem('coven', 'Coven', detection.status, needsAction, isDisabled, disabledReason);
  }

  private createOpenSpecItem(detection: OpenSpecDetectionResult, gitComplete: boolean): ComponentItem {
    const needsAction = detection.status !== 'complete';
    const isDisabled = !gitComplete;
    const disabledReason = isDisabled ? 'Git repository required first' : undefined;
    const description = detection.status === 'complete' ? detection.cliVersion : '(optional)';

    return new ComponentItem(
      'openspec',
      'OpenSpec',
      detection.status,
      needsAction,
      isDisabled,
      disabledReason,
      description
    );
  }

  private createActionItem(componentId: ComponentId, isDisabled: boolean, disabledReason?: string): ActionItem {
    return new ActionItem(componentId, isDisabled, disabledReason);
  }

  private setupFileWatcher(): void {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return;
    }

    // Watch for changes to relevant directories
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceRoot, '{.git,.beads,.coven,openspec}/**')
    );

    const handler = (): void => {
      void this.refresh();
    };

    this.fileWatcher.onDidCreate(handler);
    this.fileWatcher.onDidDelete(handler);
    this.fileWatcher.onDidChange(handler);
  }

  private setupInitSubscription(): void {
    this.initSubscription = onDidInitializeComponent.event(() => {
      void this.refresh();
    });
  }
}

/**
 * Base class for all setup tree items.
 */
export abstract class SetupTreeItem extends vscode.TreeItem {
  abstract readonly itemType: SetupTreeItemType;
}

/**
 * Component item showing a workspace component and its status.
 */
export class ComponentItem extends SetupTreeItem {
  readonly itemType: SetupTreeItemType = 'component';
  readonly componentId: ComponentId;
  readonly needsAction: boolean;
  readonly isDisabled: boolean;
  readonly disabledReason?: string;

  constructor(
    componentId: ComponentId,
    label: string,
    status: DetectionStatus,
    needsAction: boolean,
    isDisabled: boolean,
    disabledReason?: string,
    description?: string
  ) {
    super(label, needsAction ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);

    this.componentId = componentId;
    this.needsAction = needsAction;
    this.isDisabled = isDisabled;
    this.disabledReason = disabledReason;

    this.description = description;
    this.iconPath = getStatusIcon(status);
    this.contextValue = `setup.component.${componentId}.${status}`;

    // Build tooltip
    const tooltipLines = [`**${label}**`, '', getStatusDescription(status)];
    if (disabledReason) {
      tooltipLines.push('', `⚠️ ${disabledReason}`);
    }
    this.tooltip = new vscode.MarkdownString(tooltipLines.join('\n'));
  }
}

/**
 * Action item (Initialize button) shown under components that need setup.
 */
export class ActionItem extends SetupTreeItem {
  readonly itemType: SetupTreeItemType = 'action';
  readonly componentId: ComponentId;

  constructor(componentId: ComponentId, isDisabled: boolean, disabledReason?: string) {
    super('Initialize', vscode.TreeItemCollapsibleState.None);

    this.componentId = componentId;

    if (isDisabled) {
      this.iconPath = new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'));
      this.contextValue = `setup.action.${componentId}.disabled`;
      this.tooltip = disabledReason ?? 'Cannot initialize at this time';
    } else {
      this.iconPath = new vscode.ThemeIcon('add', new vscode.ThemeColor('charts.blue'));
      this.contextValue = `setup.action.${componentId}`;
      this.command = {
        command: getInitCommand(componentId),
        title: `Initialize ${componentId}`,
      };
      this.tooltip = `Click to initialize ${componentId}`;
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function getStatusIcon(status: DetectionStatus): vscode.ThemeIcon {
  switch (status) {
    case 'complete':
      return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
    case 'partial':
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
    case 'missing':
      return new vscode.ThemeIcon('circle-outline');
  }
}

function getStatusDescription(status: DetectionStatus): string {
  switch (status) {
    case 'complete':
      return '✅ Fully configured';
    case 'partial':
      return '⚠️ Partially configured - initialization recommended';
    case 'missing':
      return '❌ Not configured - initialization required';
  }
}

function getInitCommand(componentId: ComponentId): string {
  const commands: Record<ComponentId, string> = {
    git: 'coven.initGit',
    beads: 'coven.initBeads',
    coven: 'coven.initCoven',
    openspec: 'coven.initOpenspec',
  };
  return commands[componentId];
}
