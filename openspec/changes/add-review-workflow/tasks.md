# Tasks: Add Review Workflow

## 1. ReviewManager
- [ ] 1.1 Create `ReviewManager` class
- [ ] 1.2 Implement `getChanges(taskId)` returning file diffs
- [ ] 1.3 Implement `approve(taskId)` transitioning task to done
- [ ] 1.4 Implement `revert(taskId)` discarding changes, returning to ready
- [ ] 1.5 Track review state (pending, approved, reverted)

## 2. Review Panel
- [ ] 2.1 Create review webview panel
- [ ] 2.2 Display task title as header
- [ ] 2.3 Display completion time and duration
- [ ] 2.4 Display agent's summary of changes
- [ ] 2.5 Display changed files list with line counts
- [ ] 2.6 Add "View Diff" button for each file

## 3. Acceptance Criteria
- [ ] 3.1 Display acceptance criteria checklist
- [ ] 3.2 Show auto-checked items (tests passing, etc.)
- [ ] 3.3 Allow manual checking of items

## 4. Diff Viewing
- [ ] 4.1 Implement opening VSCode diff editor for file
- [ ] 4.2 Compare task branch to feature branch
- [ ] 4.3 Add "View All Changes" to see full diff

## 5. Review Actions
- [ ] 5.1 Implement "Approve" button triggering approval flow
- [ ] 5.2 Implement "Revert" button with confirmation
- [ ] 5.3 Add optional feedback text field
- [ ] 5.4 Close panel after action completes

## 6. Integration
- [ ] 6.1 Add "Review" command and sidebar action
- [ ] 6.2 Wire approval to task status transition
- [ ] 6.3 Wire revert to worktree cleanup

## 7. E2E Tests
- [ ] 7.1 Test: Review panel opens for task in review status
- [ ] 7.2 Test: Changed files displayed correctly
- [ ] 7.3 Test: Approve transitions task to done
- [ ] 7.4 Test: Revert returns task to ready
- [ ] 7.5 Test: Diff viewer opens for selected file
