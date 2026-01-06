# Change: Add PR Creation Flow (Conjure)

## Why
When all tasks on a feature branch are complete, users need to promote the work to main via a pull request. This flow summarizes all completed work and creates a well-formed PR.

## What Changes
- Implement conjure panel showing feature branch summary
- Implement PR title and description generation from completed tasks
- Implement GitHub CLI integration for PR creation
- Support both PR creation and direct merge options

## Impact
- Affected specs: `pr-creation` (new capability)
- Affected code: `src/conjure/ConjurePanel.ts`, `src/conjure/GitHubCLI.ts`
- Dependencies: Requires `add-review-workflow` for completed task data, `add-sidebar-views` for trigger
