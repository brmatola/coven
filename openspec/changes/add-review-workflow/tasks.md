# Tasks: Add Review Workflow

## 1. ReviewManager
- [x] 1.1 Create `ReviewManager` class
- [x] 1.2 Implement `getChanges(taskId)` returning file diffs
- [x] 1.3 Implement `approve(taskId)` transitioning task to done
- [x] 1.4 Implement `revert(taskId)` discarding changes, returning to ready
- [x] 1.5 Track review state (pending, approved, reverted)

## 2. Review Panel
- [x] 2.1 Create review webview panel
- [x] 2.2 Display task title as header
- [x] 2.3 Display completion time and duration
- [x] 2.4 Display agent's summary of changes
- [x] 2.5 Display changed files list with line counts
- [x] 2.6 Add "View Diff" button for each file

## 3. Acceptance Criteria
- [x] 3.1 Display acceptance criteria checklist
- [ ] 3.2 Show auto-checked items (tests passing, etc.)
- [ ] 3.3 Allow manual checking of items

## 4. Diff Viewing
- [x] 4.1 Implement opening VSCode diff editor for file
- [x] 4.2 Compare task branch to feature branch
- [x] 4.3 Add "View All Changes" to see full diff

## 5. Review Actions
- [x] 5.1 Implement "Approve" button triggering approval flow
- [x] 5.2 Implement "Revert" button with confirmation
- [x] 5.3 Add optional feedback text field
- [x] 5.4 Close panel after action completes

## 6. Integration
- [x] 6.1 Add "Review" command and sidebar action
- [x] 6.2 Wire approval to task status transition
- [x] 6.3 Wire revert to worktree cleanup

## 7. E2E Tests
- [x] 7.1 Test: Review panel opens for task in review status
- [x] 7.2 Test: Changed files displayed correctly
- [x] 7.3 Test: Approve transitions task to done
- [x] 7.4 Test: Revert returns task to ready
- [x] 7.5 Test: Diff viewer opens for selected file
