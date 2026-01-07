import * as vscode from 'vscode';

export interface WebviewMessage {
  type: string;
  payload?: unknown;
}

export abstract class WebviewPanel<TState, TMessage extends WebviewMessage> {
  protected readonly panel: vscode.WebviewPanel;
  protected readonly extensionUri: vscode.Uri;
  protected disposables: vscode.Disposable[] = [];

  constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.webview.html = this.getHtmlForWebview();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message: TMessage) => this.onMessage(message),
      null,
      this.disposables
    );
  }

  protected abstract getWebviewName(): string;

  protected abstract onMessage(message: TMessage): void | Promise<void>;

  protected postMessage(message: WebviewMessage): void {
    void this.panel.webview.postMessage(message);
  }

  protected updateState(state: TState): void {
    this.postMessage({ type: 'state', payload: state });
  }

  public reveal(column?: vscode.ViewColumn): void {
    this.panel.reveal(column);
  }

  public dispose(): void {
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }

  private getHtmlForWebview(): string {
    const webview = this.panel.webview;
    const webviewName = this.getWebviewName();

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webviews', webviewName, 'index.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webviews', webviewName, 'index.css')
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource.toString()} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>${webviewName}</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
