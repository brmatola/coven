import * as vscode from 'vscode';
import { SessionsTreeDataProvider } from './session/sessionsTreeDataProvider';
import { checkPrerequisites } from './shared/prerequisites';
import { SetupPanel } from './shared/setupPanel';

let statusBarItem: vscode.StatusBarItem;
let sessionsProvider: SessionsTreeDataProvider;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Initialize status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.text = '$(circle-outline) Coven: Inactive';
  statusBarItem.tooltip = 'Click to start a Coven session';
  statusBarItem.command = 'coven.startSession';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Initialize sidebar tree view
  sessionsProvider = new SessionsTreeDataProvider();
  const treeView = vscode.window.createTreeView('coven.sessions', {
    treeDataProvider: sessionsProvider,
  });
  context.subscriptions.push(treeView);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('coven.startSession', startSession),
    vscode.commands.registerCommand('coven.stopSession', stopSession)
  );

  // Check prerequisites and show setup panel if needed
  const prereqs = await checkPrerequisites();
  if (!prereqs.allMet) {
    SetupPanel.createOrShow(context.extensionUri, prereqs);
  }
}

export function deactivate(): void {
  // Cleanup handled by disposables
}

async function startSession(): Promise<void> {
  const prereqs = await checkPrerequisites();
  if (!prereqs.allMet) {
    await vscode.window.showWarningMessage(
      'Coven: Prerequisites not met. Please complete setup first.'
    );
    return;
  }

  statusBarItem.text = '$(sync~spin) Coven: Starting...';
  // Session start logic will be implemented in add-core-session
  statusBarItem.text = '$(circle-filled) Coven: Active';
  sessionsProvider.refresh();
}

function stopSession(): void {
  statusBarItem.text = '$(circle-outline) Coven: Inactive';
  sessionsProvider.refresh();
}
