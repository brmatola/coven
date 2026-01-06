# Change: Add Task Detail View

## Why
Users need to view, edit, and refine tasks before assigning them to agents. This is critical when AI generates tasks (e.g., bugs found during work) - users must review and potentially adjust task descriptions, acceptance criteria, and scope before work begins.

## What Changes
- Implement task detail panel (React webview) for viewing/editing tasks
- Support editing title, description, and acceptance criteria
- Display task metadata (source, dependencies, status history)
- Provide "Start Task" action directly from detail view
- First React webview - establishes shared webview infrastructure

## Impact
- Affected specs: `task-editing` (new capability)
- Affected code: `src/tasks/TaskDetailPanel.ts`, `src/webview-ui/` (new shared React app)
- Dependencies: Requires `add-core-session` (task data), `add-sidebar-views` (navigation)
