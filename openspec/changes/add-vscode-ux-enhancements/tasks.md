## 1. Keyboard Shortcuts

- [ ] 1.1 Add keybinding definitions to `package.json`
- [ ] 1.2 Implement `coven.focusSidebar` command
- [ ] 1.3 Implement `coven.createTaskFromSidebar` command with sidebar focus check
- [ ] 1.4 Add tree view keyboard handlers for Enter (start) and Space (details)
- [ ] 1.5 Write unit tests for keyboard command handlers

## 2. Configuration Settings

- [ ] 2.1 Add configuration schema to `package.json` contributes.configuration
- [ ] 2.2 Implement auto-start session on workspace activation
- [ ] 2.3 Read `defaultTimeout` and pass to daemon/grimoire context
- [ ] 2.4 Implement notification preference check before showing toasts
- [ ] 2.5 Write unit tests for configuration handling

## 3. New Commands

- [ ] 3.1 Implement `Coven: Answer Question` command
  - Find first task in Questions state
  - Open question UI or show "no pending questions" message
- [ ] 3.2 Implement `Coven: View Workflow Logs` command
  - Get selected task's workflow ID
  - Open log file in new editor tab
- [ ] 3.3 Register commands in `package.json`
- [ ] 3.4 Write unit tests for new commands

## 4. Documentation

- [ ] 4.1 Update VS Code README with keyboard shortcuts table
- [ ] 4.2 Document new settings in configuration section
- [ ] 4.3 Add new commands to command reference
