## ADDED Requirements

### Requirement: Keyboard Shortcuts
The extension SHALL provide keyboard shortcuts for common actions.

#### Scenario: Focus sidebar with keyboard
- **WHEN** user presses `Cmd/Ctrl + Shift + C`
- **THEN** the Coven sidebar receives focus

#### Scenario: Create task with keyboard
- **WHEN** the Coven sidebar is focused
- **AND** user presses `Cmd/Ctrl + Shift + N`
- **THEN** the create task input appears

#### Scenario: Start task with Enter key
- **WHEN** a task is selected in the sidebar
- **AND** user presses `Enter`
- **THEN** the task workflow starts

#### Scenario: Open task details with Space key
- **WHEN** a task is selected in the sidebar
- **AND** user presses `Space`
- **THEN** the task detail panel opens

### Requirement: Configuration Settings
The extension SHALL provide configurable settings for user preferences.

#### Scenario: Auto-start session setting
- **WHEN** `coven.autoStartSession` is `true`
- **AND** a git workspace is opened
- **THEN** a session starts automatically using the current branch

#### Scenario: Default timeout setting
- **WHEN** `coven.defaultTimeout` is set to "30m"
- **AND** a grimoire step has no explicit timeout
- **THEN** the step uses 30 minutes as timeout

#### Scenario: Notification preference
- **WHEN** `coven.showNotifications` is `false`
- **AND** a task event occurs
- **THEN** no desktop notification is shown

### Requirement: Answer Question Command
The extension SHALL provide a command to answer pending agent questions.

#### Scenario: Answer pending question
- **WHEN** user runs `Coven: Answer Question`
- **AND** at least one task has a pending question
- **THEN** the question UI opens for the first pending question

#### Scenario: No pending questions
- **WHEN** user runs `Coven: Answer Question`
- **AND** no tasks have pending questions
- **THEN** a message indicates no questions are pending

### Requirement: View Workflow Logs Command
The extension SHALL provide a command to view workflow-specific logs.

#### Scenario: View logs for selected task
- **WHEN** user selects a task in the sidebar
- **AND** runs `Coven: View Workflow Logs`
- **THEN** the workflow log file opens in a new editor tab

#### Scenario: No task selected
- **WHEN** user runs `Coven: View Workflow Logs`
- **AND** no task is selected
- **THEN** a message prompts user to select a task first
