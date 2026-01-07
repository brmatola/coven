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

interface MockWebviewPanel {
  webview: {
    html: string;
    onDidReceiveMessage: ReturnType<typeof vi.fn>;
  };
  reveal: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  onDidDispose: ReturnType<typeof vi.fn>;
}

export const workspace = {
  workspaceFolders: [
    {
      uri: {
        fsPath: '/mock/workspace',
      },
    },
  ],
};

export const window = {
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  createStatusBarItem: vi.fn((): MockStatusBarItem => ({
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    text: '',
    tooltip: '',
    command: '',
  })),
  createTreeView: vi.fn((): MockTreeView => ({
    dispose: vi.fn(),
  })),
  createWebviewPanel: vi.fn((): MockWebviewPanel => ({
    webview: {
      html: '',
      onDidReceiveMessage: vi.fn(),
    },
    reveal: vi.fn(),
    dispose: vi.fn(),
    onDidDispose: vi.fn(),
  })),
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
    return { dispose: (): void => {} };
  };
  fire(data: T): void {
    this.listeners.forEach((l) => l(data));
  }
}

export type Uri = {
  fsPath: string;
};

export type Disposable = {
  dispose: () => void;
};
