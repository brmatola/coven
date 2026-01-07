import React, { useEffect, useState } from 'react';
import { SetupState, ToolStatus, InitStatus, SetupMessageToWebview } from '../types';

// VS Code API type
interface VsCodeApi {
  postMessage: (message: unknown) => void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

export function App(): React.ReactElement {
  const [state, setState] = useState<SetupState | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<SetupMessageToWebview>): void => {
      const message = event.data;
      if (message.type === 'state') {
        setState(message.payload);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleInitOpenspec = (): void => {
    vscode.postMessage({ type: 'initOpenspec' });
  };

  const handleInitBeads = (): void => {
    vscode.postMessage({ type: 'initBeads' });
  };

  const handleRefresh = (): void => {
    vscode.postMessage({ type: 'refresh' });
  };

  if (!state) {
    return <div className="loading">Loading...</div>;
  }

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
