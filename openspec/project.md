# Project Context

## Purpose
Coven is a VSCode extension that provides a visual UI for orchestrating multiple AI coding agents working in parallel on a feature branch. It manages task queues, agent lifecycles, git worktrees, conflict resolution, and code review workflows - enabling developers to delegate multiple tasks to AI agents while maintaining oversight and control.

## Tech Stack
- **Runtime**: TypeScript, Node.js >= 20
- **Platform**: VSCode Extension API
- **UI**: VSCode TreeView (sidebar), Webviews (React for complex panels)
- **Agent Integration**: Claude Code CLI (primary), extensible to other providers
- **Git**: Native git CLI, GitHub CLI (gh) for PR creation
- **Build**: esbuild for extension bundling, Vite for webview UI
- **Testing**: Vitest for unit tests, VSCode Extension Test framework for integration

## Project Conventions

### Code Style
- TypeScript strict mode enabled
- ESLint with VSCode extension recommended rules
- Prettier for formatting (2-space indent, single quotes, no semicolons)
- Interface-first design for extensibility (TaskSource, AgentProvider, GitProvider)
- Event-driven architecture using Node.js EventEmitter pattern

### Architecture Patterns
- **Feature folders (vertical slices)**: Each feature owns its domain logic, UI, and commands together
- **Shared folder**: Only truly cross-cutting concerns (base types, config, utilities)
- **Co-location**: If code is only used by one feature, it lives in that feature's folder
- Interfaces for extensibility where needed (e.g., AgentProvider for multiple AI backends)

```
src/
├── shared/          # Cross-cutting: types, config, utils
├── session/         # Session lifecycle, setup UI
├── tasks/           # Task management, task list UI
├── agents/          # Agent lifecycle, output, questions
├── git/             # Worktrees, merging, conflicts
├── review/          # Review workflow, diff viewing
├── conjure/         # PR creation flow
└── extension.ts     # Entry point, wires features
```

### Testing Strategy
- Unit tests for core business logic (TaskManager, WorktreeManager)
- Integration tests for provider implementations
- Manual testing for VSCode UI components
- Minimum 80% coverage on core layer

### Git Workflow
- Feature branches from main
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`
- PR-based workflow with squash merge
- The extension itself manages feature branches and worktrees for delegated work

## Domain Context

### Key Concepts
- **Session**: An active work session tied to a feature branch
- **Task**: A unit of work with description, acceptance criteria, and status
- **Agent/Familiar**: An AI agent instance working on a specific task in its own worktree
- **Worktree**: Git worktree providing isolated workspace per agent
- **Question**: When an agent needs human input (clarification, permission, decision)
- **Review**: Human review of agent-completed work before merge
- **Promotion/Conjure**: Creating a PR to merge feature branch to main

### Task States
- `ready` - Task available to be worked on
- `working` - Agent actively working on task
- `review` - Work complete, awaiting human review
- `done` - Approved and merged to feature branch
- `blocked` - Waiting on dependency or human intervention

### Agent Question Types
- `clarification` - Need more info about requirements
- `permission` - Request to run command or install dependency
- `decision` - Multiple valid approaches, need human choice
- `blocked` - Unable to proceed, needs guidance

## Important Constraints
- Must work offline (no external services required except git remote)
- Agent processes must be killable/recoverable
- Worktrees must be cleanly managed (no orphans)
- Must handle concurrent agent operations safely
- UI must remain responsive during agent work
- Memory efficient - don't hold large diffs/outputs in memory

## External Dependencies

### Required CLI Tools
| Tool | Command | Install | Purpose |
|------|---------|---------|---------|
| Git | `git` | System package manager | Worktrees, branches, merging |
| Claude Code | `claude` | `npm i -g @anthropic-ai/claude-code` | AI agent execution |
| OpenSpec | `openspec` | `npm i -g @fission-ai/openspec` | Spec-driven planning |
| Beads | `bd` | `npm i -g @beads/bd` | Task/issue tracking |
| GitHub CLI | `gh` | `brew install gh` / system | PR creation (optional) |

### Per-Repo Initialization
- **OpenSpec**: `openspec init --tools claude` creates `openspec/` directory
- **Beads**: `bd init` creates `.beads/` directory

### Design Note
While MVP assumes OpenSpec + Beads + Claude Code, the architecture uses interfaces (TaskSource, AgentProvider) to allow future alternative implementations.
