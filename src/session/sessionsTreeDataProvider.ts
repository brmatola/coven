import * as vscode from 'vscode';

export class SessionsTreeDataProvider implements vscode.TreeDataProvider<SessionItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<SessionItem | undefined | null | void> =
    new vscode.EventEmitter<SessionItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<SessionItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SessionItem): vscode.TreeItem {
    return element;
  }

  getChildren(_element?: SessionItem): Thenable<SessionItem[]> {
    // Placeholder - will be implemented in add-core-session
    return Promise.resolve([
      new SessionItem('No active session', vscode.TreeItemCollapsibleState.None),
    ]);
  }
}

export class SessionItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
  }
}
