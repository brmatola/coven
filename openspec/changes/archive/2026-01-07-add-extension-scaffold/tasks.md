# Tasks: Add Extension Scaffold

## 1. Project Initialization
- [x] 1.1 Initialize npm package with `package.json`
- [x] 1.2 Configure TypeScript with `tsconfig.json` (strict mode)
- [x] 1.3 Set up ESLint and Prettier configuration
- [x] 1.4 Create `.vscodeignore` for extension packaging

## 2. Extension Manifest
- [x] 2.1 Configure `package.json` extension fields (publisher, engines, activationEvents)
- [x] 2.2 Register `coven` view container in activity bar
- [x] 2.3 Define initial commands (`coven.startSession`, `coven.stopSession`)
- [x] 2.4 Configure extension icon and display name

## 3. Build Pipeline
- [x] 3.1 Set up esbuild for extension bundling (`scripts/build.ts`)
- [x] 3.2 Configure development watch mode
- [x] 3.3 Add npm scripts for build, watch, package, lint
- [x] 3.4 Set up Vitest for unit testing
- [x] 3.5 Set up VSCode Extension Test framework for E2E tests
- [x] 3.6 Create test runner script that launches VSCode with extension
- [x] 3.7 Add npm script for running E2E tests

## 4. Extension Entry Point
- [x] 4.1 Create `src/extension.ts` with activate/deactivate exports
- [x] 4.2 Register command handlers for initial commands
- [x] 4.3 Initialize status bar item showing "Coven: Inactive"
- [x] 4.4 Create placeholder TreeDataProvider for sidebar

## 5. Directory Structure
- [x] 5.1 Create `src/shared/` directory for cross-cutting concerns (types, config, utils)
- [x] 5.2 Create `src/session/` directory for session lifecycle
- [x] 5.3 Create `src/tasks/` directory for task management
- [x] 5.4 Create `src/agents/` directory for agent/familiar lifecycle
- [x] 5.5 Create `src/git/` directory for worktree and git operations
- [x] 5.6 Create `src/review/` directory for review workflow
- [x] 5.7 Create `src/conjure/` directory for PR creation

## 6. Prerequisites Checking
- [x] 6.1 Create `src/shared/prerequisites.ts` for tool detection
- [x] 6.2 Implement CLI tool detection (`which` or `where` based on platform)
- [x] 6.3 Check for `git`, `claude`, `openspec`, `bd` commands
- [x] 6.4 Implement repo initialization detection (openspec/, .beads/)
- [x] 6.5 Create `PrerequisitesStatus` type with tool/init states
- [x] 6.6 Cache results and expose refresh method

## 7. Setup Panel
- [x] 7.1 Create setup panel webview for prerequisites display
- [x] 7.2 Show CLI tool status with install links for missing tools
- [x] 7.3 Show repo initialization status
- [x] 7.4 Implement "Initialize OpenSpec" button (runs `openspec init --tools claude`)
- [x] 7.5 Implement "Initialize Beads" button (runs `bd init`)
- [x] 7.6 Implement "Check Again" button to refresh status
- [x] 7.7 Auto-transition to session setup when all prerequisites met

## 8. Development Setup
- [x] 8.1 Add `.vscode/launch.json` for Extension Host debugging
- [x] 8.2 Add `.vscode/tasks.json` for build tasks
- [x] 8.3 Create README with development instructions

## 9. E2E Tests
- [x] 9.1 Test: Extension activates in workspace with .git
- [x] 9.2 Test: Sidebar view container appears in activity bar
- [x] 9.3 Test: Status bar item shows "Coven: Inactive"
- [x] 9.4 Test: Prerequisites panel shows when tools missing
