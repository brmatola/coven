# Tasks: Add Extension Scaffold

## 1. Project Initialization
- [ ] 1.1 Initialize npm package with `package.json`
- [ ] 1.2 Configure TypeScript with `tsconfig.json` (strict mode)
- [ ] 1.3 Set up ESLint and Prettier configuration
- [ ] 1.4 Create `.vscodeignore` for extension packaging

## 2. Extension Manifest
- [ ] 2.1 Configure `package.json` extension fields (publisher, engines, activationEvents)
- [ ] 2.2 Register `coven` view container in activity bar
- [ ] 2.3 Define initial commands (`coven.startSession`, `coven.stopSession`)
- [ ] 2.4 Configure extension icon and display name

## 3. Build Pipeline
- [ ] 3.1 Set up esbuild for extension bundling (`scripts/build.ts`)
- [ ] 3.2 Configure development watch mode
- [ ] 3.3 Add npm scripts for build, watch, package, lint
- [ ] 3.4 Set up Vitest for unit testing

## 4. Extension Entry Point
- [ ] 4.1 Create `src/extension.ts` with activate/deactivate exports
- [ ] 4.2 Register command handlers for initial commands
- [ ] 4.3 Initialize status bar item showing "Coven: Inactive"
- [ ] 4.4 Create placeholder TreeDataProvider for sidebar

## 5. Directory Structure
- [ ] 5.1 Create `src/core/` directory for domain logic
- [ ] 5.2 Create `src/providers/` directory for external integrations
- [ ] 5.3 Create `src/views/` directory for UI components
- [ ] 5.4 Create `src/commands/` directory for command handlers
- [ ] 5.5 Create `src/utils/` directory for shared utilities

## 6. Development Setup
- [ ] 6.1 Add `.vscode/launch.json` for Extension Host debugging
- [ ] 6.2 Add `.vscode/tasks.json` for build tasks
- [ ] 6.3 Create README with development instructions
