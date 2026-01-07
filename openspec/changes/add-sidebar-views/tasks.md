# Tasks: Add Sidebar Views

## Implementation
Epic: `coven-az5` (add-sidebar-views) - CLOSED
Track progress: `bd epic status coven-az5`
List tasks: `bd list --parent coven-az5`

## 1. TreeDataProvider
- [x] 1.1 Create `GrimoireTreeProvider` implementing TreeDataProvider
- [x] 1.2 Implement session header item (branch name, stats)
- [x] 1.3 Implement task group items (Ready, Working, Review, Done, Blocked)
- [x] 1.4 Implement task items with status icons and metadata
- [x] 1.5 Implement refresh on state changes
- [x] 1.6 Add expand/collapse state persistence

## 2. Tree Items
- [x] 2.1 Create `SessionHeaderItem` with branch name and summary stats
- [x] 2.2 Create `TaskGroupItem` with count badge
- [x] 2.3 Create `TaskItem` with title, status icon, elapsed time for working tasks
- [x] 2.4 Create `FamiliarItem` showing agent status under working tasks
- [x] 2.5 Add context menu items (start, stop, view, edit)

## 3. Status Bar
- [x] 3.1 Create `CovenStatusBar` class managing status bar item
- [x] 3.2 Show "Coven: Inactive" when no session
- [x] 3.3 Show summary when session active (e.g., "2 working, 1 review")
- [x] 3.4 Highlight/pulse when agent needs response
- [x] 3.5 Click to reveal sidebar

## 4. Session Setup View
- [x] 4.1 Create session setup webview panel
- [x] 4.2 Implement branch selection (existing or create new)
- [x] 4.3 Implement task source configuration
- [x] 4.4 Implement settings (max concurrent, worktree path)
- [x] 4.5 Add "Begin" button to start session

## 5. Empty States
- [x] 5.1 Show setup prompt when no session active
- [x] 5.2 Show "No tasks" message when grimoire is empty
- [x] 5.3 Show "Add task" quick action in empty state

## 6. Integration
- [x] 6.1 Register TreeDataProvider in extension activation
- [x] 6.2 Subscribe to CovenSession state changes for refresh
- [x] 6.3 Wire up command handlers for tree item actions

## 7. E2E Tests
- [x] 7.1 Test: Task groups appear in sidebar when session active
- [x] 7.2 Test: Tasks appear under correct status group
- [x] 7.3 Test: Status bar updates when task status changes
- [x] 7.4 Test: Session setup panel opens on first run
- [x] 7.5 Test: Starting session from setup panel works
