# Tasks: Add Task Detail View

## 1. Webview Infrastructure (First React Webview)
- [ ] 1.1 Set up `webview-ui/` directory with React + Vite
- [ ] 1.2 Configure Vite build to output to `dist/webview`
- [ ] 1.3 Create shared webview utilities (postMessage helpers, VS Code API bridge)
- [ ] 1.4 Create base WebviewPanel class for extension-side webview management
- [ ] 1.5 Set up hot reload for webview development
- [ ] 1.6 Add npm scripts for webview build/watch

## 2. Task Detail Panel (Extension Side)
- [ ] 2.1 Create `TaskDetailPanel` class extending base WebviewPanel
- [ ] 2.2 Implement `show(taskId)` to open/focus panel for specific task
- [ ] 2.3 Send task data to webview on open and on updates
- [ ] 2.4 Handle messages from webview (save, start task, etc.)
- [ ] 2.5 Implement panel disposal and cleanup

## 3. Task Detail UI (React)
- [ ] 3.1 Create TaskDetail React component
- [ ] 3.2 Display task title (editable)
- [ ] 3.3 Display task description (editable, markdown support)
- [ ] 3.4 Display acceptance criteria (editable checklist)
- [ ] 3.5 Display metadata (source, created date, dependencies)
- [ ] 3.6 Display status and status history

## 4. Task Editing
- [ ] 4.1 Implement inline editing for title
- [ ] 4.2 Implement rich text editing for description
- [ ] 4.3 Implement add/remove/edit acceptance criteria items
- [ ] 4.4 Auto-save on blur or explicit save button
- [ ] 4.5 Persist edits via TaskManager
- [ ] 4.6 Sync edits back to Beads (via BeadsTaskSource)

## 5. Task Actions
- [ ] 5.1 Add "Start Task" button (assigns agent, transitions to working)
- [ ] 5.2 Add "Delete Task" button (with confirmation, only for ready tasks)
- [ ] 5.3 Show blocked status with link to blocking tasks
- [ ] 5.4 Disable actions appropriately based on task status

## 6. Navigation Integration
- [ ] 6.1 Open task detail on double-click in sidebar
- [ ] 6.2 Open task detail from "Edit" context menu action
- [ ] 6.3 Add command `coven.openTaskDetail`
- [ ] 6.4 Handle navigation to non-existent task gracefully

## 7. E2E Tests
- [ ] 7.1 Test: Open task detail from sidebar
- [ ] 7.2 Test: Edit task title and verify persistence
- [ ] 7.3 Test: Add acceptance criteria item
- [ ] 7.4 Test: Start task from detail view
