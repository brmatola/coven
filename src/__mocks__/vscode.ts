import { vi } from 'vitest';

// Mock vscode module for unit tests

interface MockStatusBarItem {
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  text: string;
  tooltip: string;
  command: string;
}

interface MockTreeView {
  dispose: ReturnType<typeof vi.fn>;
}

interface MockWebview {
  html: string;
  onDidReceiveMessage: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
  asWebviewUri: ReturnType<typeof vi.fn>;
  cspSource: string;
}

interface MockWebviewPanel {
  webview: MockWebview;
  reveal: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  onDidDispose: ReturnType<typeof vi.fn>;
}

// Mutable workspace state for testing
let _workspaceFolders: Array<{ uri: { fsPath: string } }> = [
  { uri: { fsPath: '/mock/workspace' } },
];

export const workspace = {
  get workspaceFolders() {
    return _workspaceFolders;
  },
};

// Test helper to set workspace folders
export function __setWorkspaceFolders(folders: Array<{ uri: { fsPath: string } }>): void {
  _workspaceFolders = folders;
}

// Test helper to reset to default single folder
export function __resetWorkspaceFolders(): void {
  _workspaceFolders = [{ uri: { fsPath: '/mock/workspace' } }];
}

interface MockOutputChannel {
  appendLine: ReturnType<typeof vi.fn>;
  append: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  name: string;
}

export const window = {
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showInputBox: vi.fn(),
  showQuickPick: vi.fn(),
  setStatusBarMessage: vi.fn(),
  createOutputChannel: vi.fn(
    (name: string): MockOutputChannel => ({
      appendLine: vi.fn(),
      append: vi.fn(),
      clear: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
      name,
    })
  ),
  createStatusBarItem: vi.fn(
    (): MockStatusBarItem => ({
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
      text: '',
      tooltip: '',
      command: '',
    })
  ),
  createTreeView: vi.fn(
    (): MockTreeView => ({
      dispose: vi.fn(),
    })
  ),
  createWebviewPanel: vi.fn(
    (): MockWebviewPanel => ({
      webview: {
        html: '',
        onDidReceiveMessage: vi.fn((_callback) => ({ dispose: vi.fn() })),
        postMessage: vi.fn(),
        asWebviewUri: vi.fn((uri) => uri),
        cspSource: 'mock-csp-source',
      },
      reveal: vi.fn(),
      dispose: vi.fn(),
      onDidDispose: vi.fn((_callback) => ({ dispose: vi.fn() })),
    })
  ),
  activeTextEditor: undefined,
};

export const commands = {
  registerCommand: vi.fn(),
  getCommands: vi.fn((): Promise<string[]> => Promise.resolve([])),
};

export const extensions = {
  getExtension: vi.fn(),
};

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum ViewColumn {
  One = 1,
  Two = 2,
  Three = 3,
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  label: string;
  collapsibleState: TreeItemCollapsibleState;
  constructor(label: string, collapsibleState: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  event = (listener: (e: T) => void): { dispose: () => void } => {
    this.listeners.push(listener);
    return {
      dispose: (): void => {
        const index = this.listeners.indexOf(listener);
        if (index >= 0) {
          this.listeners.splice(index, 1);
        }
      },
    };
  };
  fire(data: T): void {
    this.listeners.forEach((l) => l(data));
  }
  dispose(): void {
    this.listeners = [];
  }
}

export class Uri {
  fsPath: string;
  path: string;

  constructor(fsPath: string) {
    this.fsPath = fsPath;
    this.path = fsPath;
  }

  static joinPath(base: Uri, ...pathSegments: string[]): Uri {
    return new Uri(`${base.fsPath}/${pathSegments.join('/')}`);
  }

  static file(path: string): Uri {
    return new Uri(path);
  }

  toString(): string {
    return this.fsPath;
  }
}

export type Disposable = {
  dispose: () => void;
};

export class ThemeIcon {
  id: string;
  color?: ThemeColor;

  constructor(id: string, color?: ThemeColor) {
    this.id = id;
    this.color = color;
  }
}

export class ThemeColor {
  id: string;

  constructor(id: string) {
    this.id = id;
  }
}

export class MarkdownString {
  value: string;

  constructor(value?: string) {
    this.value = value ?? '';
  }

  appendMarkdown(value: string): MarkdownString {
    this.value += value;
    return this;
  }
}
