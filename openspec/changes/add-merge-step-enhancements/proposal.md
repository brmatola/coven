# Change: Add Merge Step Enhancements

## Why

Merge steps currently have minimal customization:
1. **Generic commit messages** - Auto-generated messages lack context
2. **No rebase option** - When target diverges, only manual conflict resolution works
3. **No pre-merge hooks** - Can't run checks before merge commits

These limitations reduce traceability and complicate conflict resolution.

## What Changes

### Custom Commit Messages
- **ADDED** `commit_message` field - Template string for commit message
- **ADDED** Access to all workflow context in commit message template
- **ADDED** Multi-line commit message support (title + body)

### Rebase Action
- **ADDED** "Rebase" button in review panel UI
- **ADDED** `POST /workflows/:id/rebase` API endpoint
- **ADDED** Auto-rebase option: `auto_rebase: true` on merge step

### Pre-Merge Checks
- **ADDED** `pre_merge` field - List of script commands to run before merge
- **ADDED** Check results shown in review panel
- **ADDED** Merge blocked if any pre-merge check fails

## Impact

- **Affected specs:** agent-orchestration
- **Affected code:**
  - `packages/daemon/internal/workflow/merge.go` - Commit message, rebase, pre-merge
  - `packages/daemon/internal/api/handlers.go` - Rebase endpoint
  - `packages/vscode/src/panels/ReviewPanel.ts` - Rebase button, check display
- **Breaking changes:** None (additive only)
