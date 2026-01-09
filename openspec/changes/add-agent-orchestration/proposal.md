# Change: Agent Orchestration and Role-Based Prompt System

## Why

The daemon's core infrastructure (process management, worktrees, task scheduling) is complete but agents lack the contextual prompting needed for effective software development. Currently, prompts are just `title + description` with no role-specific behavior, acceptance criteria, or workflow integration.

We need a structured system where:
1. Agents operate with role-specific prompts (implement, fix, review, test)
2. Rich context is injected (repo structure, prior attempts, related work)
3. A review agent validates changes before merge
4. Users can customize behavior via `.coven/` configuration

## What Changes

### Agent Roles System (New Capability)
- **Role definitions** with prompt templates stored in `.coven/roles/`
- **Built-in roles**: `implement`, `fix`, `refactor`, `test`, `review`
- **Custom roles**: User-defined roles with custom prompts
- **Role selection**: Automatic based on task type, or explicit override

### Prompt Building (Major Enhancement)
- **Context injection**: Repo structure, relevant files, directory hints
- **Acceptance criteria**: Included in all implementation prompts
- **Prior attempt summaries**: For retry scenarios
- **Session context**: Awareness of parallel work to avoid conflicts

### Review Workflow Integration
- **Review agent**: Automatically spawned after implementation completes
- **Review checks**: Test coverage, code quality, security patterns
- **Configurable strictness**: `strict`, `normal`, `yolo` modes
- **Blocking reviews**: Option to require review approval before merge

### Configuration via `.coven/`
- **roles/**: Custom role definitions with prompt templates
- **config.json**: Orchestration settings (concurrency, review mode, etc.)
- **Context hints**: Project-specific context for agents

## Impact

- **Affected specs**:
  - `agent-execution` (MODIFIED - prompt building, role selection)
  - `agent-roles` (NEW - role definitions and templates)
- **Affected code**:
  - `packages/daemon/internal/scheduler/` - prompt building
  - `packages/daemon/internal/roles/` - new package for role management
  - `packages/daemon/internal/review/` - new package for review agent
- **E2E tests**: New tests for role-based execution, review workflow

## User Stories

### Story 1: Default Workflow
As a developer, when I create a task and mark it ready, the daemon should:
1. Select the appropriate role based on task type
2. Build a rich prompt with repo context and acceptance criteria
3. Spawn an agent in a worktree
4. On completion, spawn a review agent to validate changes
5. Present changes for my approval (or auto-merge in yolo mode)

### Story 2: Custom Role
As a developer, I want to define a custom role for my team's conventions:
```yaml
# .coven/roles/team-implement.yaml
name: team-implement
base: implement
prompt_additions: |
  Follow our team conventions:
  - Use functional components with hooks
  - Write tests for all public functions
  - Use our custom logger from @/lib/logger
```

### Story 3: Review Configuration
As a developer, I want to configure how strict the review agent is:
```json
{
  "review": {
    "mode": "normal",
    "require_tests": true,
    "require_e2e": false,
    "auto_merge": false
  }
}
```

## Success Criteria

1. Agents receive role-appropriate prompts with rich context
2. Review agent catches common issues (missing tests, bad patterns)
3. Users can customize roles without modifying daemon code
4. E2E tests validate the complete workflow
5. Default experience works well without configuration
