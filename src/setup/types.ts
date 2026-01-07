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

export interface BranchInfo {
  name: string;
  isNew: boolean;
}

export interface SessionConfig {
  maxConcurrentAgents: number;
  worktreeBasePath: string;
  autoApprove: boolean;
}

export type SetupPhase = 'prerequisites' | 'session-config';

// Prerequisites-only state returned by checkPrerequisites
export interface PrerequisitesState {
  tools: ToolStatus[];
  inits: InitStatus[];
  workspace: WorkspaceStatus;
  allMet: boolean;
}

// Full state including session config
export interface SetupState extends PrerequisitesState {
  phase: SetupPhase;
  // Session config state
  availableBranches: string[];
  selectedBranch: BranchInfo | null;
  sessionConfig: SessionConfig;
}

// Messages from webview to extension
export type SetupMessageToExtension =
  | { type: 'initOpenspec' }
  | { type: 'initBeads' }
  | { type: 'refresh' }
  | { type: 'fetchBranches' }
  | { type: 'selectBranch'; payload: BranchInfo }
  | { type: 'updateConfig'; payload: Partial<SessionConfig> }
  | { type: 'beginSession' };

// Messages from extension to webview
export type SetupMessageToWebview = { type: 'state'; payload: SetupState };
