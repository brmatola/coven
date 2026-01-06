# Change: Add Sidebar Views

## Why
Users need a visual overview of their Coven session - seeing all tasks grouped by status, active agents, and session health at a glance. The sidebar is the primary navigation point for the extension.

## What Changes
- Implement `GrimoireTreeProvider` as main sidebar TreeDataProvider
- Implement tree items for session header, task groups, and individual tasks
- Implement status bar integration showing session summary
- Implement session setup webview for new session configuration
- Add click handlers for navigation to task details

## Impact
- Affected specs: `sidebar-ui` (new capability)
- Affected code: `src/views/sidebar/`, `src/views/statusBar/`, `src/views/webviews/sessionSetup/`
- Dependencies: Requires `add-core-session` for state access
