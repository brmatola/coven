# Tasks: Add Git Worktree Management

## Implementation
Epic: `coven-zxt` (add-git-worktree-management)
Track progress: `bd epic status coven-zxt`
List tasks: `bd list --parent coven-zxt`

## 1. GitProvider Interface
- [ ] 1.1 Define `GitProvider` interface with worktree, branch, and diff operations
- [ ] 1.2 Define `Worktree` interface (path, branch, isMain)
- [ ] 1.3 Define `MergeResult` interface (success, conflicts, mergedFiles)
- [ ] 1.4 Define `ConflictFile` interface (path, ourContent, theirContent)

## 2. GitCLI Implementation
- [ ] 2.1 Implement git command execution utility with error handling
- [ ] 2.2 Implement `createWorktree(branch, path)` using `git worktree add`
- [ ] 2.3 Implement `deleteWorktree(path)` using `git worktree remove`
- [ ] 2.4 Implement `listWorktrees()` parsing `git worktree list`
- [ ] 2.5 Implement `createBranch(name, base)` for task branches
- [ ] 2.6 Implement `merge(source, target)` with conflict detection
- [ ] 2.7 Implement `getStatus(path)` for working directory status
- [ ] 2.8 Implement `getDiff(base, head)` for change summary
- [ ] 2.9 Write unit tests for GitCLI

## 3. WorktreeManager Implementation
- [ ] 3.1 Create `WorktreeManager` class
- [ ] 3.2 Implement worktree path naming convention (`{base}/{session}/{taskId}`)
- [ ] 3.3 Implement `createForTask(taskId)` creating worktree and task branch
- [ ] 3.4 Implement `cleanupForTask(taskId)` removing worktree after merge
- [ ] 3.5 Implement `mergeToFeature(taskId)` merging task branch to feature branch
- [ ] 3.6 Implement orphan worktree detection and cleanup
- [ ] 3.7 Write unit tests for WorktreeManager

## 4. ConflictResolver Implementation
- [ ] 4.1 Create `ConflictResolver` class
- [ ] 4.2 Implement conflict detection during merge
- [ ] 4.3 Implement AI-assisted conflict resolution using agent
- [ ] 4.4 Implement conflict escalation to user when AI fails
- [ ] 4.5 Write unit tests for ConflictResolver

## 5. Integration
- [ ] 5.1 Wire WorktreeManager into FamiliarManager spawn flow
- [ ] 5.2 Wire ConflictResolver into merge flow
- [ ] 5.3 Add configuration for worktree base path

## 6. E2E Tests
- [ ] 6.1 Test: Worktree created when agent starts task
- [ ] 6.2 Test: Worktree cleaned up after task approval
- [ ] 6.3 Test: Merge to feature branch succeeds
- [ ] 6.4 Test: Orphan worktrees detected on session recovery
