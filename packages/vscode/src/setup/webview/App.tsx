import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  SetupState,
  ToolStatus,
  InitStatus,
  SetupMessageToWebview,
  BranchInfo,
  SessionConfig,
} from '../types';

// VS Code API type
export interface VsCodeApi {
  postMessage: (message: unknown) => void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// Lazy getter for VS Code API - allows testing without global
let cachedVsCodeApi: VsCodeApi | null = null;
function getVsCodeApi(): VsCodeApi {
  if (!cachedVsCodeApi) {
    cachedVsCodeApi = acquireVsCodeApi();
  }
  return cachedVsCodeApi;
}

// For testing: allow resetting the cached API
export function _resetVsCodeApi(): void {
  cachedVsCodeApi = null;
}

export interface AppProps {
  vsCodeApi?: VsCodeApi;
}

export function App({ vsCodeApi }: AppProps): React.ReactElement {
  const vscode = useMemo(() => vsCodeApi ?? getVsCodeApi(), [vsCodeApi]);
  const [state, setState] = useState<SetupState | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<SetupMessageToWebview>): void => {
      const message = event.data;
      if (message.type === 'state') {
        setState(message.payload);
      }
    };

    window.addEventListener('message', handleMessage);

    // Request initial state on mount
    vscode.postMessage({ type: 'refresh' });

    return () => window.removeEventListener('message', handleMessage);
  }, [vscode]);

  const handleInitOpenspec = (): void => {
    vscode.postMessage({ type: 'initOpenspec' });
  };

  const handleInitBeads = (): void => {
    vscode.postMessage({ type: 'initBeads' });
  };

  const handleRefresh = (): void => {
    vscode.postMessage({ type: 'refresh' });
  };

  const handleSelectBranch = useCallback(
    (branch: BranchInfo): void => {
      vscode.postMessage({ type: 'selectBranch', payload: branch });
    },
    [vscode]
  );

  const handleUpdateConfig = useCallback(
    (config: Partial<SessionConfig>): void => {
      vscode.postMessage({ type: 'updateConfig', payload: config });
    },
    [vscode]
  );

  const handleBeginSession = useCallback((): void => {
    vscode.postMessage({ type: 'beginSession' });
  }, [vscode]);

  if (!state) {
    return <div className="loading">Loading...</div>;
  }

  // Show multi-root workspace error
  if (state.workspace.isMultiRoot) {
    return (
      <div className="setup-container">
        <h1>Coven Setup</h1>
        <div className="error-banner">
          <h2>Multi-root Workspaces Not Supported</h2>
          <p>
            Coven detected {state.workspace.folderCount} workspace folders. Multi-root workspaces
            are not currently supported.
          </p>
          <p>Please open a single folder workspace to use Coven.</p>
          <p className="hint">
            Use <strong>File &gt; Open Folder...</strong> to open a single project folder.
          </p>
        </div>
        <div className="actions">
          <button onClick={handleRefresh}>Check Again</button>
        </div>
      </div>
    );
  }

  // Session config phase
  if (state.phase === 'session-config') {
    return (
      <SessionConfigView
        state={state}
        onSelectBranch={handleSelectBranch}
        onUpdateConfig={handleUpdateConfig}
        onBegin={handleBeginSession}
      />
    );
  }

  // Prerequisites phase
  return (
    <div className="setup-container">
      <h1>Coven Setup</h1>
      <p>Complete the following prerequisites to start using Coven.</p>

      <section>
        <h2>CLI Tools</h2>
        {state.tools.map((tool) => (
          <ToolStatusItem key={tool.name} tool={tool} />
        ))}
      </section>

      <section>
        <h2>Repository Initialization</h2>
        {state.inits.map((init) => (
          <InitStatusItem
            key={init.name}
            init={init}
            onInit={init.name === 'openspec' ? handleInitOpenspec : handleInitBeads}
          />
        ))}
      </section>

      <div className="actions">
        <button onClick={handleRefresh}>Check Again</button>
      </div>
    </div>
  );
}

interface ToolStatusItemProps {
  tool: ToolStatus;
}

function ToolStatusItem({ tool }: ToolStatusItemProps): React.ReactElement {
  return (
    <div className="status-item">
      <span className={`status-icon ${tool.available ? 'status-ok' : 'status-missing'}`}>
        {tool.available ? '\u2713' : '\u2717'}
      </span>
      <span className="status-name">{tool.name}</span>
      {tool.version && <span className="status-version">{tool.version}</span>}
      {!tool.available && tool.installUrl && (
        <a href={tool.installUrl} target="_blank" rel="noopener noreferrer">
          Install
        </a>
      )}
    </div>
  );
}

interface InitStatusItemProps {
  init: InitStatus;
  onInit: () => void;
}

function InitStatusItem({ init, onInit }: InitStatusItemProps): React.ReactElement {
  return (
    <div className="status-item">
      <span className={`status-icon ${init.initialized ? 'status-ok' : 'status-missing'}`}>
        {init.initialized ? '\u2713' : '\u2717'}
      </span>
      <span className="status-name">{init.name}</span>
      {!init.initialized && <button onClick={onInit}>Initialize</button>}
    </div>
  );
}

// Session configuration view - shown after prerequisites are met
interface SessionConfigViewProps {
  state: SetupState;
  onSelectBranch: (branch: BranchInfo) => void;
  onUpdateConfig: (config: Partial<SessionConfig>) => void;
  onBegin: () => void;
}

function SessionConfigView({
  state,
  onSelectBranch,
  onUpdateConfig,
  onBegin,
}: SessionConfigViewProps): React.ReactElement {
  const [newBranchName, setNewBranchName] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  const handleSelectExisting = (branchName: string): void => {
    setIsCreatingNew(false);
    onSelectBranch({ name: branchName, isNew: false });
  };

  const handleCreateNew = (): void => {
    if (newBranchName.trim()) {
      onSelectBranch({ name: newBranchName.trim(), isNew: true });
    }
  };

  const canBegin =
    state.selectedBranch !== null &&
    (state.selectedBranch.name.length > 0 || newBranchName.trim().length > 0);

  return (
    <div className="setup-container">
      <h1>Start Session</h1>
      <p>Configure your Coven session settings.</p>

      <section>
        <h2>Feature Branch</h2>
        <div className="branch-selection">
          <div className="branch-option">
            <label>
              <input
                type="radio"
                name="branchType"
                checked={!isCreatingNew}
                onChange={() => setIsCreatingNew(false)}
              />
              Select existing branch
            </label>
            {!isCreatingNew && (
              <select
                value={state.selectedBranch?.isNew === false ? state.selectedBranch.name : ''}
                onChange={(e) => handleSelectExisting(e.target.value)}
                disabled={isCreatingNew}
              >
                <option value="">-- Select a branch --</option>
                {state.availableBranches.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="branch-option">
            <label>
              <input
                type="radio"
                name="branchType"
                checked={isCreatingNew}
                onChange={() => setIsCreatingNew(true)}
              />
              Create new branch
            </label>
            {isCreatingNew && (
              <div className="new-branch-input">
                <input
                  type="text"
                  placeholder="feature/my-feature"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onBlur={handleCreateNew}
                />
                <p className="hint">Branch will be created from main</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section>
        <h2>Task Sources</h2>
        <div className="task-sources">
          <div className="task-source-item">
            <label>
              <input type="checkbox" checked disabled />
              Manual Tasks
            </label>
            <p className="hint">Create tasks directly in Coven (always enabled)</p>
          </div>
          <div className="task-source-item disabled">
            <label>
              <input type="checkbox" disabled />
              Beads Integration
            </label>
            <p className="hint">Sync tasks from Beads (requires add-beads-integration)</p>
          </div>
        </div>
      </section>

      <section>
        <h2>Settings</h2>
        <div className="settings-form">
          <div className="form-group">
            <label htmlFor="maxAgents">Max Concurrent Agents</label>
            <input
              id="maxAgents"
              type="number"
              min={1}
              max={10}
              value={state.sessionConfig.maxConcurrentAgents}
              onChange={(e) =>
                onUpdateConfig({ maxConcurrentAgents: parseInt(e.target.value, 10) || 1 })
              }
            />
            <p className="hint">Number of agents that can work simultaneously</p>
          </div>

          <div className="form-group">
            <label htmlFor="worktreePath">Worktree Base Path</label>
            <input
              id="worktreePath"
              type="text"
              value={state.sessionConfig.worktreeBasePath}
              onChange={(e) => onUpdateConfig({ worktreeBasePath: e.target.value })}
            />
            <p className="hint">Location for git worktrees (relative to workspace)</p>
          </div>

          <div className="form-group checkbox">
            <label>
              <input
                type="checkbox"
                checked={state.sessionConfig.autoApprove}
                onChange={(e) => onUpdateConfig({ autoApprove: e.target.checked })}
              />
              Auto-approve agent actions
            </label>
            <p className="hint">Skip confirmation for routine operations</p>
          </div>
        </div>
      </section>

      <div className="actions primary-actions">
        <button className="primary" onClick={onBegin} disabled={!canBegin}>
          Begin Session
        </button>
      </div>
    </div>
  );
}
