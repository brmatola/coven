# Change: Add VS Code UX Enhancements

## Why

The VS Code extension lacks common UX patterns that improve daily usability:
1. **No keyboard shortcuts** - Users must click for every action (start session, create task, etc.)
2. **Limited configuration** - No settings for auto-start, notification preferences, or timeout defaults
3. **Missing commands** - No dedicated commands for answering questions or viewing workflow logs

These gaps add friction for power users who expect keyboard-driven workflows.

## What Changes

### Keyboard Shortcuts
- **ADDED** `Cmd/Ctrl + Shift + C` to focus Coven sidebar
- **ADDED** `Cmd/Ctrl + Shift + N` to create task (when sidebar focused)
- **ADDED** `Enter` to start selected task (when task selected)
- **ADDED** `Space` to open task details (when task selected)

### Configuration Settings
- **ADDED** `coven.autoStartSession` - Auto-start session on workspace open (default: false)
- **ADDED** `coven.defaultTimeout` - Default agent timeout for grimoires without explicit timeout (default: "15m")
- **ADDED** `coven.showNotifications` - Show desktop notifications for task events (default: true)

### New Commands
- **ADDED** `Coven: Answer Question` - Jump to and answer pending agent question
- **ADDED** `Coven: View Workflow Logs` - Open workflow-specific logs for selected task

## Impact

- **Affected specs:** vscode-extension
- **Affected code:**
  - `packages/vscode/package.json` - Add keybindings and configuration schema
  - `packages/vscode/src/extension.ts` - Register new commands
  - `packages/vscode/src/commands/` - Implement new commands
  - `packages/vscode/src/sidebar/` - Handle keyboard navigation
- **Breaking changes:** None
