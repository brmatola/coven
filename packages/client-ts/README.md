# @coven/client-ts

TypeScript client for the Coven daemon API.

This package contains:
- **Generated client code** from the OpenAPI specification in `packages/api-spec`
- **Unix socket adapter** for communicating with the daemon over Unix domain sockets
- **High-level client wrapper** (`CovenClient`) that provides a convenient API

## Structure

```
packages/client-ts/
├── generated/          # Generated TypeScript client (from OpenAPI spec)
│   ├── services/       # Service classes (HealthService, TasksService, etc.)
│   ├── models/         # Type definitions
│   └── core/           # Core request/response handling
├── src/
│   ├── client.ts       # CovenClient - high-level wrapper
│   ├── unix-socket-adapter.ts  # Unix socket adapter for axios
│   └── index.ts        # Package exports
├── dist/               # Compiled JavaScript (gitignored)
└── scripts/
    └── generate-client.sh  # Generation script
```

## Usage

### In Extension Code

```typescript
import { CovenClient } from '@coven/client-ts';

const client = new CovenClient('/path/to/.coven/covend.sock');

// Use generated services
const health = await client.HealthService.getHealth();
const tasks = await client.TasksService.getTasks();
```

### In E2E Tests

```typescript
import { CovenClient } from '@coven/client-ts';

const client = new CovenClient(socketPath);
const health = await client.HealthService.getHealth();
```

## Build Process

The client is automatically generated and compiled when you build:

```bash
npm run build  # Generates client from spec, then compiles TypeScript
```

The generation step:
1. Bundles the OpenAPI spec (resolves all `$ref` references)
2. Generates TypeScript client using `openapi-typescript-codegen`
3. Compiles TypeScript to JavaScript in `dist/`

## Maintenance

**All generated code is committed to source control.** When the API spec changes:
1. Run `npm run build` in this package
2. Review the generated code changes
3. Update wrapper code if needed
4. Commit the changes

This ensures:
- Generated code is version controlled
- Changes are visible in diffs
- The extension always uses code that matches the spec
