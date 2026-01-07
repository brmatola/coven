# Change: Add VSCode Extension Scaffold

## Why
Establish the foundational VSCode extension project structure including build tooling, configuration, and basic activation. This is the prerequisite for all subsequent Coven functionality.

## What Changes
- Initialize VSCode extension project with TypeScript
- Configure build pipeline (esbuild for extension, Vite for webviews)
- Set up linting, formatting, and testing infrastructure
- Create extension entry point with activation/deactivation lifecycle
- Register Coven sidebar view container
- Add basic status bar item

## Impact
- Affected specs: `vscode-extension` (new capability)
- Affected code: Root project files, `src/extension.ts`, `package.json`
- No existing code affected (greenfield project)
