# Tasks: Add Sidebar Views

## 1. TreeDataProvider
- [ ] 1.1 Create `GrimoireTreeProvider` implementing TreeDataProvider
- [ ] 1.2 Implement session header item (branch name, stats)
- [ ] 1.3 Implement task group items (Ready, Working, Review, Done, Blocked)
- [ ] 1.4 Implement task items with status icons and metadata
- [ ] 1.5 Implement refresh on state changes
- [ ] 1.6 Add expand/collapse state persistence

## 2. Tree Items
- [ ] 2.1 Create `SessionHeaderItem` with branch name and summary stats
- [ ] 2.2 Create `TaskGroupItem` with count badge
- [ ] 2.3 Create `TaskItem` with title, status icon, elapsed time for working tasks
- [ ] 2.4 Create `FamiliarItem` showing agent status under working tasks
- [ ] 2.5 Add context menu items (start, stop, view, edit)

## 3. Status Bar
- [ ] 3.1 Create `CovenStatusBar` class managing status bar item
- [ ] 3.2 Show "Coven: Inactive" when no session
- [ ] 3.3 Show summary when session active (e.g., "2 working, 1 review")
- [ ] 3.4 Highlight/pulse when agent needs response
- [ ] 3.5 Click to reveal sidebar

## 4. Session Setup View
- [ ] 4.1 Create session setup webview panel
- [ ] 4.2 Implement branch selection (existing or create new)
- [ ] 4.3 Implement task source configuration
- [ ] 4.4 Implement settings (max concurrent, worktree path)
- [ ] 4.5 Add "Begin" button to start session

## 5. Empty States
- [ ] 5.1 Show setup prompt when no session active
- [ ] 5.2 Show "No tasks" message when grimoire is empty
- [ ] 5.3 Show "Add task" quick action in empty state

## 6. Integration
- [ ] 6.1 Register TreeDataProvider in extension activation
- [ ] 6.2 Subscribe to CovenSession state changes for refresh
- [ ] 6.3 Wire up command handlers for tree item actions

## 7. E2E Tests
- [ ] 7.1 Test: Task groups appear in sidebar when session active
- [ ] 7.2 Test: Tasks appear under correct status group
- [ ] 7.3 Test: Status bar updates when task status changes
- [ ] 7.4 Test: Session setup panel opens on first run
- [ ] 7.5 Test: Starting session from setup panel works
