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
- Affected code: `src/git/GitProvider.ts`, `src/git/GitCLI.ts`, `src/git/WorktreeManager.ts`, `src/git/ConflictResolver.ts`
- Dependencies: Requires `add-core-session` for integration with FamiliarManager
