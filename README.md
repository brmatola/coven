# Coven

Agent orchestration system for VSCode.

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
npm install
```

### Build

```bash
npm run build
```

### Watch Mode

```bash
npm run watch
```

### Run Extension

Press `F5` in VSCode to launch the Extension Development Host, or use the "Run Extension" launch configuration.

### Testing

Unit tests:
```bash
npm test
```

E2E tests:
```bash
npm run test:e2e
```

### Linting

```bash
npm run lint
npm run lint:fix
```

### Formatting

```bash
npm run format
npm run format:check
```

## Project Structure

```
src/
  extension.ts       # Extension entry point
  shared/            # Cross-cutting concerns (types, config, utils)
  session/           # Session lifecycle
  tasks/             # Task management
  agents/            # Agent/familiar lifecycle
  git/               # Worktree and git operations
  review/            # Review workflow
  conjure/           # PR creation
```
