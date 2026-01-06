# Change: Add Git Worktree Management

## Why
Each agent needs an isolated workspace to make changes without conflicts. Git worktrees provide this isolation while sharing the same repository, enabling parallel work and clean merges back to the feature branch.

## What Changes
- Implement `GitProvider` interface abstracting git operations
- Implement `GitCLI` provider using native git commands
- Implement `WorktreeManager` for worktree lifecycle management
- Implement `ConflictResolver` for handling merge conflicts
- Add automatic worktree cleanup on task completion

## Impact
- Affected specs: `git-operations` (new capability)
- Affected code: `src/providers/git/GitProvider.ts`, `src/providers/git/GitCLI.ts`, `src/core/WorktreeManager.ts`, `src/core/ConflictResolver.ts`
- Dependencies: Requires `add-core-session` for integration with FamiliarManager
