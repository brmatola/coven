import * as vscode from 'vscode';
import { SessionsTreeDataProvider } from './session/sessionsTreeDataProvider';
import { checkPrerequisites } from './setup/prerequisites';
import { SetupPanel } from './setup/SetupPanel';
import { ExtensionContext } from './shared/extensionContext';

let sessionsProvider: SessionsTreeDataProvider;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const ctx = ExtensionContext.initialize(context);
  ctx.logger.info('Coven extension activating');

  // Initialize status bar
  ctx.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  ctx.statusBarItem.text = '$(circle-outline) Coven: Inactive';
  ctx.statusBarItem.tooltip = 'Click to start a Coven session';
  ctx.statusBarItem.command = 'coven.startSession';
  ctx.statusBarItem.show();
  ctx.subscriptions.push(ctx.statusBarItem);

  // Initialize sidebar tree view
  sessionsProvider = new SessionsTreeDataProvider();
  const treeView = vscode.window.createTreeView('coven.sessions', {
    treeDataProvider: sessionsProvider,
  });
  ctx.subscriptions.push(treeView);

  // Register commands
  ctx.subscriptions.push(
    vscode.commands.registerCommand('coven.startSession', startSession),
    vscode.commands.registerCommand('coven.stopSession', stopSession),
    vscode.commands.registerCommand('coven.showSetup', showSetup)
  );

  // Check prerequisites and show setup panel if needed
  try {
    const prereqs = await checkPrerequisites();
    ctx.logger.info('Prerequisites check complete', { allMet: prereqs.allMet });
    if (!prereqs.allMet) {
      await SetupPanel.createOrShow(ctx.extensionUri);
    }
  } catch (err) {
    ctx.logger.error('Failed to check prerequisites', {
      error: err instanceof Error ? err.message : String(err),
    });
    await vscode.window.showErrorMessage(
      `Coven: Failed to check prerequisites: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  ctx.logger.info('Coven extension activated');
}

export function deactivate(): void {
  if (ExtensionContext.isInitialized()) {
    ExtensionContext.get().logger.info('Coven extension deactivating');
    ExtensionContext.dispose();
  }
}

async function startSession(): Promise<void> {
  const ctx = ExtensionContext.get();

  let prereqs;
  try {
    prereqs = await checkPrerequisites();
  } catch (err) {
    await vscode.window.showErrorMessage(
      `Coven: Failed to check prerequisites: ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }

  if (!prereqs.allMet) {
    await vscode.window.showWarningMessage(
      'Coven: Prerequisites not met. Please complete setup first.'
    );
    return;
  }

  if (ctx.statusBarItem) {
    ctx.statusBarItem.text = '$(sync~spin) Coven: Starting...';
    // Session start logic will be implemented in add-core-session
    ctx.statusBarItem.text = '$(circle-filled) Coven: Active';
  }
  sessionsProvider.refresh();
}

function stopSession(): void {
  const ctx = ExtensionContext.get();
  if (ctx.statusBarItem) {
    ctx.statusBarItem.text = '$(circle-outline) Coven: Inactive';
  }
  sessionsProvider.refresh();
}

async function showSetup(): Promise<void> {
  const ctx = ExtensionContext.get();
  await SetupPanel.createOrShow(ctx.extensionUri);
}
