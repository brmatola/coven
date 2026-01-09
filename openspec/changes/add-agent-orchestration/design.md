# Design: Agent Orchestration and Role-Based Prompt System

## Context

The Coven daemon orchestrates AI agents working on software development tasks. The current implementation spawns agents with minimal context (task title + description). This design establishes a role-based system where agents receive contextually-rich prompts tailored to their specific function.

### Stakeholders
- **Developers**: Primary users who create tasks and review changes
- **Agents**: Claude instances executing tasks in worktrees
- **Daemon**: Orchestration layer managing agent lifecycle

### Constraints
- Must work with Claude CLI as the agent runtime
- Configuration must be git-friendly (checked into repo)
- Must support offline operation (no external services required)
- E2E tests must validate complete workflows

## Goals / Non-Goals

### Goals
- Role-based prompt templates with sensible defaults
- Rich context injection (repo structure, prior attempts, acceptance criteria)
- Review agent workflow for quality gates
- User-customizable roles and configuration
- Comprehensive E2E test coverage

### Non-Goals
- Custom agent runtimes (only Claude CLI supported)
- External service integrations (GitHub Actions, etc.)
- Real-time collaboration features
- IDE-specific integrations (handled by VS Code extension)

## Architecture

### Component Overview

```
.coven/
├── config.json           # Orchestration settings
└── roles/                # Custom role definitions
    └── *.yaml            # Role templates

packages/daemon/internal/
├── roles/                # Role management (NEW)
│   ├── loader.go         # Load roles from .coven/ and defaults
│   ├── resolver.go       # Select role for task
│   └── templates.go      # Built-in role templates
├── prompt/               # Prompt building (NEW)
│   ├── builder.go        # Assemble prompts from parts
│   ├── context.go        # Gather repo/session context
│   └── templates.go      # Prompt template rendering
├── review/               # Review agent (NEW)
│   ├── agent.go          # Review agent lifecycle
│   ├── checks.go         # Review check implementations
│   └── config.go         # Review configuration
└── scheduler/            # Enhanced scheduling
    └── scheduler.go      # Use roles/prompt packages
```

### Role System Design

#### Role Definition Format (YAML)

```yaml
name: implement
description: "Implement new features or functionality"
applicable_task_types: [feature, task]

prompt_template: |
  You are implementing a feature in a software project.

  ## Task
  {{.Title}}

  {{if .Description}}
  ## Description
  {{.Description}}
  {{end}}

  {{if .AcceptanceCriteria}}
  ## Acceptance Criteria
  {{range .AcceptanceCriteria}}
  - {{.}}
  {{end}}
  {{end}}

  ## Repository Context
  {{.RepoContext}}

  ## Guidelines
  - Write clean, maintainable code
  - Include unit tests for new functionality
  - Follow existing patterns in the codebase

  {{if .CustomInstructions}}
  ## Project-Specific Instructions
  {{.CustomInstructions}}
  {{end}}

context_requirements:
  - repo_structure
  - relevant_files
  - related_tasks
```

#### Built-in Roles

| Role | Task Types | Purpose |
|------|------------|---------|
| `implement` | feature, task | New functionality |
| `fix` | bug | Bug fixes |
| `refactor` | refactor | Code improvements |
| `test` | test | Test writing |
| `review` | (internal) | Change validation |

#### Role Resolution Order

1. Task-specific role override (if specified in task metadata)
2. Task type mapping to default role
3. Fallback to `implement` role

### Prompt Building Pipeline

```
Task → Role Selection → Context Gathering → Template Rendering → Final Prompt
         ↓                    ↓                    ↓
    roles/resolver.go   prompt/context.go   prompt/builder.go
```

#### Context Components

1. **Repo Structure**: Directory tree, key files (README, config files)
2. **Relevant Files**: Files mentioned in task or identified via keywords
3. **Prior Attempts**: Summary of previous agent runs on this task
4. **Session Context**: Other active tasks to avoid conflicts
5. **Custom Instructions**: Project-specific guidelines from `.coven/config.json`

#### Context Gathering Strategy

```go
type ContextGatherer interface {
    GatherRepoStructure(workdir string) (string, error)
    GatherRelevantFiles(task Task, workdir string) ([]string, error)
    GatherPriorAttempts(taskID string) (string, error)
    GatherSessionContext(activeTaskIDs []string) (string, error)
}
```

**Repo Structure**: Run `tree -L 2 -I 'node_modules|.git|dist'` or equivalent
**Relevant Files**: Extract keywords from task, use `rg` to find matching files
**Prior Attempts**: Load from daemon state (output summaries from previous runs)
**Session Context**: List other in-progress tasks with brief descriptions

### Review Agent Design

#### Lifecycle

```
Implementation Agent Completes
           ↓
    Review Agent Spawns
           ↓
    Runs Review Checks
           ↓
    Reports Findings
           ↓
    [User Decision or Auto-merge]
```

#### Review Checks

| Check | Description | Severity |
|-------|-------------|----------|
| `test_coverage` | New code has tests | warning/error |
| `e2e_tests` | E2E tests for user-facing changes | warning |
| `code_quality` | Follows project patterns | warning |
| `security` | No obvious security issues | error |
| `build_passes` | Code compiles/builds | error |
| `lint_passes` | Linting rules pass | warning |

#### Review Modes

- **strict**: All checks must pass, manual approval required
- **normal**: Errors block, warnings reported, manual approval
- **yolo**: Warnings only, auto-merge on no errors

#### Review Agent Prompt Structure

```
You are reviewing changes made by another agent.

## Task Context
[Original task description]

## Changes Made
[Git diff summary]

## Review Checklist
- [ ] Tests: Are new functions tested?
- [ ] Patterns: Does code follow existing patterns?
- [ ] Security: Any obvious security issues?
- [ ] Completeness: Does implementation satisfy acceptance criteria?

## Instructions
Provide a structured review with:
1. PASS/FAIL overall verdict
2. Specific issues found (if any)
3. Suggestions for improvement
```

### Configuration Schema

#### `.coven/config.json`

```json
{
  "orchestration": {
    "max_concurrent_agents": 3,
    "agent_timeout_minutes": 30,
    "poll_interval_seconds": 5
  },
  "review": {
    "mode": "normal",
    "checks": {
      "test_coverage": { "enabled": true, "severity": "warning" },
      "e2e_tests": { "enabled": true, "severity": "warning" },
      "build_passes": { "enabled": true, "severity": "error" },
      "lint_passes": { "enabled": true, "severity": "warning" }
    },
    "auto_merge": false
  },
  "context": {
    "custom_instructions": "Follow our team conventions...",
    "excluded_paths": ["node_modules", "dist", ".git"],
    "relevant_files_limit": 10
  },
  "roles": {
    "default": "implement",
    "type_mapping": {
      "feature": "implement",
      "bug": "fix",
      "refactor": "refactor",
      "test": "test"
    }
  }
}
```

### E2E Testing Strategy

#### Test Categories

1. **Role Selection Tests**
   - Default role selection by task type
   - Custom role override
   - Role loading from `.coven/roles/`

2. **Prompt Building Tests**
   - Context injection (verify prompt contains expected sections)
   - Acceptance criteria inclusion
   - Custom instructions injection

3. **Review Workflow Tests**
   - Review agent spawns after implementation
   - Review checks execute
   - Review verdict affects merge behavior

4. **Full Workflow Tests**
   - Task creation → implementation → review → merge
   - Failure scenarios (review fails, implementation fails)
   - Concurrent task handling

#### Test Infrastructure

```go
// e2e/daemon/roles_test.go
func TestRoleSelection(t *testing.T) {
    // Create task with type "bug"
    // Start session
    // Verify agent spawned with "fix" role prompt
}

// e2e/daemon/review_test.go
func TestReviewWorkflow(t *testing.T) {
    // Create and complete implementation task
    // Verify review agent spawns
    // Verify review findings reported
    // Verify merge behavior based on review mode
}
```

## Decisions

### Decision 1: YAML for Role Definitions
**Choice**: Use YAML files for role definitions
**Alternatives**: JSON, TOML, Go templates
**Rationale**: YAML is human-friendly for multi-line prompt templates, widely understood, and git-friendly

### Decision 2: Go Templates for Prompts
**Choice**: Use Go `text/template` for prompt rendering
**Alternatives**: String interpolation, external template engine
**Rationale**: Built into Go, sufficient for our needs, no external dependencies

### Decision 3: Review as Separate Agent
**Choice**: Spawn review as a separate agent instance
**Alternatives**: Same agent continues to review, external review service
**Rationale**: Clean separation of concerns, fresh context for review, consistent with agent model

### Decision 4: Configuration in `.coven/`
**Choice**: Store all configuration in `.coven/` directory
**Alternatives**: XDG config, environment variables, CLI flags
**Rationale**: Git-friendly (shared with team), co-located with project, discoverable

## Risks / Trade-offs

### Risk 1: Prompt Token Limits
**Risk**: Rich context may exceed Claude's context window
**Mitigation**: Implement context budget, prioritize most relevant content, summarize large sections

### Risk 2: Review Agent Accuracy
**Risk**: Review agent may miss issues or false-positive
**Mitigation**: Conservative default (normal mode), clear documentation of limitations, user override

### Risk 3: Configuration Complexity
**Risk**: Too many options overwhelm users
**Mitigation**: Sensible defaults that work without configuration, progressive disclosure

### Risk 4: E2E Test Flakiness
**Risk**: Agent-based tests may be non-deterministic
**Mitigation**: Mock agent responses where appropriate, focus on orchestration behavior not agent output quality

## Migration Plan

### Phase 1: Role System Foundation
1. Implement role loader with built-in defaults
2. Add role selection to scheduler
3. Basic prompt building with role templates
4. E2E tests for role selection

### Phase 2: Context Injection
1. Implement context gathering components
2. Integrate context into prompt building
3. Add acceptance criteria support
4. E2E tests for context injection

### Phase 3: Review Workflow
1. Implement review agent spawning
2. Add review checks
3. Configure review modes
4. E2E tests for review workflow

### Phase 4: Configuration
1. Implement config loading from `.coven/`
2. Support custom roles
3. Documentation
4. E2E tests for custom configuration

## Open Questions

1. **Prior Attempt Persistence**: How long do we keep prior attempt data? Configurable?
2. **MCP Server Integration**: Should roles specify MCP servers to enable? (Deferred to separate proposal)
3. **Role Inheritance**: Should custom roles extend built-in roles? (Start simple, add if needed)
4. **Review Agent Tools**: Should review agent have different tool access than implementation agent?
