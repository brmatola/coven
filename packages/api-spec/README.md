# Coven Daemon API Specification

This package contains the OpenAPI 3.2 specification for the Coven daemon API and **generates all API clients** from this specification.

## Structure

```
packages/api-spec/
├── openapi.yaml              # Main spec file
├── paths/                    # Endpoint definitions
│   ├── health.yaml
│   ├── version.yaml
│   ├── state.yaml
│   ├── tasks.yaml
│   ├── agents.yaml
│   ├── questions.yaml
│   └── workflows.yaml
├── schemas/                  # Type definitions
│   ├── common.yaml          # Common types
│   ├── agent.yaml           # Agent types
│   ├── task.yaml            # Task types
│   ├── question.yaml        # Question types
│   └── workflow.yaml        # Workflow types
├── components/               # Reusable components
│   ├── responses.yaml       # Common responses
│   └── parameters.yaml      # Common parameters
├── scripts/                  # Client generation scripts
│   └── generate-ts-client.sh
└── generated/                # Generated client code (gitignored)
    └── ts/                   # TypeScript client for VSCode extension
        ├── services/
        ├── models/
        └── core/
```

## Client Generation

This package is responsible for generating all API clients from the OpenAPI specification.

### TypeScript Client (VSCode Extension)

The TypeScript client is automatically generated when you build the api-spec package:

```bash
cd packages/api-spec
npm run build
```

Or it will be automatically generated when building the VSCode extension:

```bash
npm run build  # From root - builds api-spec first, then vscode
```

The generated client is located at `generated/ts/` and is consumed by the VSCode extension via:

```typescript
import { HealthService } from '@coven/api-spec/generated/ts/services';
```

### Go Client (Future)

A Go client will be generated here in the future for use by the daemon or other Go tools.

## Workflow

### Making API Changes

1. **Update API Spec** (`packages/api-spec/`)
   ```bash
   # Edit openapi.yaml or path/schema files
   vim packages/api-spec/paths/new-endpoint.yaml
   ```

2. **Validate Spec**
   ```bash
   npm run spec:validate
   npm run spec:lint
   ```

3. **Build (Auto-generates Clients)**
   ```bash
   npm run build  # From root - automatically regenerates clients
   ```

The build process is **transparent** - clients are automatically regenerated whenever the spec changes.

## Principles

1. **Single Source of Truth**: This spec defines the API contract
2. **Automatic Generation**: Clients are generated automatically on build
3. **Version Control**: All changes tracked in git (generated code is gitignored)
4. **E2E Testing**: Both server and client validated against spec

## Package Scripts

- `npm run validate` - Validate the OpenAPI spec
- `npm run bundle` - Bundle spec into single file
- `npm run lint` - Lint the OpenAPI spec
- `npm run generate:ts` - Generate TypeScript client (called automatically by build)
- `npm run build` - Validate, lint, and generate all clients

## SSE Events

Server-Sent Events (`/events` endpoint) are documented separately in `packages/daemon/docs/openapi/SSE.md` since OpenAPI 3.2 SSE support is still evolving.
