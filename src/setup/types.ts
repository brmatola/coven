// Shared types between extension and webview

export interface ToolStatus {
  name: string;
  available: boolean;
  version?: string | undefined;
  installUrl?: string | undefined;
}

export interface InitStatus {
  name: string;
  initialized: boolean;
  path?: string | undefined;
}

export interface WorkspaceStatus {
  isMultiRoot: boolean;
  folderCount: number;
}

export interface SetupState {
  tools: ToolStatus[];
  inits: InitStatus[];
  workspace: WorkspaceStatus;
  allMet: boolean;
}

// Messages from webview to extension
export type SetupMessageToExtension =
  | { type: 'initOpenspec' }
  | { type: 'initBeads' }
  | { type: 'refresh' };

// Messages from extension to webview
export type SetupMessageToWebview = { type: 'state'; payload: SetupState };
