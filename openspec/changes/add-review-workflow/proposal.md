# Change: Add Review Workflow

## Why
After an agent completes a task, humans need to review the changes before they're considered done. This includes viewing diffs, checking acceptance criteria, and approving or reverting the work.

## What Changes
- Implement review panel webview showing task completion summary
- Implement diff viewer integration using VSCode's built-in diff
- Implement approval flow that transitions task to done
- Implement revert flow that discards changes and returns task to ready

## Impact
- Affected specs: `code-review` (new capability)
- Affected code: `src/review/ReviewPanel.ts`, `src/review/ReviewManager.ts`
- Dependencies: Requires `add-git-worktree-management` for diff access, `add-sidebar-views` for integration
