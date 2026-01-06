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
- **Core Layer**: Domain logic (CovenSession, TaskManager, FamiliarManager)
- **Provider Layer**: Abstractions over external systems (agents, git, task sources)
- **View Layer**: VSCode UI components (TreeView providers, Webview panels)
- **Command Layer**: VSCode command handlers bound to UI actions
- Providers implement interfaces allowing multiple implementations (e.g., ClaudeAgent, future OpenAI)

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
- **Claude Code CLI**: Primary agent provider (`claude` command)
- **Git CLI**: Worktree and branch management
- **GitHub CLI** (`gh`): PR creation and GitHub operations
- **Beads** (optional): External task source integration
