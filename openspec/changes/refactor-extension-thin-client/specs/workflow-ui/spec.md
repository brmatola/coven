## NEW Requirements

### Requirement: Workflow Sidebar View
The extension SHALL display workflows grouped by status in the sidebar.

#### Scenario: Active workflows section
- **GIVEN** daemon has workflows in `running` status
- **WHEN** sidebar renders
- **THEN** "Active Workflows" section shows each workflow
- **THEN** each item shows task title, current step, and progress
- **THEN** items are ordered by start time (newest first)

#### Scenario: Pending merge section
- **GIVEN** daemon has workflows in `pending_merge` status
- **WHEN** sidebar renders
- **THEN** workflow shows in Active section with merge indicator
- **THEN** inline actions show [Approve] [Reject] buttons
- **THEN** clicking Approve calls POST /workflows/:id/approve-merge
- **THEN** clicking Reject calls POST /workflows/:id/reject-merge

#### Scenario: Questions section
- **GIVEN** daemon has pending questions
- **WHEN** sidebar renders
- **THEN** "Questions" section shows each pending question
- **THEN** each item shows task reference and question text
- **THEN** clicking item opens question response dialog
- **THEN** answering calls POST /questions/:id/answer

#### Scenario: Ready tasks section
- **GIVEN** daemon has tasks with no active workflow
- **WHEN** sidebar renders
- **THEN** "Ready Tasks" section shows each task
- **THEN** each item shows task title and type
- **THEN** inline [Start] action visible
- **THEN** clicking Start calls POST /tasks/:id/start

#### Scenario: Blocked workflows section
- **GIVEN** daemon has workflows in `blocked` status
- **WHEN** sidebar renders
- **THEN** "Blocked" section shows each workflow
- **THEN** each item shows task title and blocking reason
- **THEN** inline [Retry] and [Cancel] actions visible

#### Scenario: Completed section
- **GIVEN** daemon has workflows in `completed` status
- **WHEN** sidebar renders
- **THEN** "Completed" section shows count
- **THEN** collapsed by default
- **THEN** "Show all..." link expands to list

### Requirement: Workflow Progress Display
The extension SHALL show workflow step progress.

#### Scenario: Step progress in sidebar
- **GIVEN** workflow is running
- **WHEN** sidebar renders workflow item
- **THEN** shows "Step X/Y: step-name"
- **THEN** if in loop, shows "(iter N/M)"

#### Scenario: Step status icons
- **WHEN** rendering step status
- **THEN** completed steps show checkmark
- **THEN** running steps show spinner
- **THEN** pending steps show circle
- **THEN** failed steps show X

### Requirement: Workflow Detail Panel
The extension SHALL provide detailed workflow view.

#### Scenario: Open workflow detail
- **WHEN** user clicks workflow in sidebar
- **THEN** extension opens WorkflowDetailPanel
- **THEN** panel shows workflow metadata (grimoire, started time)
- **THEN** panel shows step list with statuses

#### Scenario: Step list display
- **GIVEN** workflow detail panel is open
- **WHEN** panel renders
- **THEN** each step shows name, type, status, duration
- **THEN** nested loop steps show indented with iterations
- **THEN** current step is highlighted

#### Scenario: Agent output streaming
- **GIVEN** workflow has running agent step
- **WHEN** panel is open
- **THEN** panel shows real-time output from agent
- **THEN** output auto-scrolls to bottom
- **THEN** output is updated via SSE events

#### Scenario: Workflow actions
- **GIVEN** workflow detail panel is open
- **WHEN** workflow is running
- **THEN** [Cancel Workflow] button visible
- **WHEN** workflow is blocked
- **THEN** [Retry] and [Cancel] buttons visible
- **WHEN** workflow is pending_merge
- **THEN** [Approve] and [Reject] buttons visible

#### Scenario: View execution log
- **GIVEN** workflow detail panel is open
- **WHEN** user clicks "View Log"
- **THEN** extension fetches GET /workflows/:id/log
- **THEN** log opens in new editor tab
- **THEN** log displays as formatted JSONL

### Requirement: Merge Review Panel
The extension SHALL provide merge review UI.

#### Scenario: Open merge review
- **GIVEN** workflow is in `pending_merge` status
- **WHEN** user clicks [Approve] or opens detail
- **THEN** extension opens MergeReviewPanel
- **THEN** panel shows diff summary

#### Scenario: Diff display
- **GIVEN** merge review panel is open
- **WHEN** panel renders
- **THEN** shows list of changed files with +/- counts
- **THEN** shows total additions/deletions
- **THEN** "View Diff" opens VS Code diff view

#### Scenario: Step outputs
- **GIVEN** merge review panel is open
- **WHEN** panel renders
- **THEN** shows summary from each completed step
- **THEN** helps reviewer understand what was done

#### Scenario: Approve merge
- **WHEN** user clicks "Approve & Merge"
- **THEN** extension calls POST /workflows/:id/approve-merge
- **THEN** if success, panel shows success and closes
- **THEN** if conflicts, panel shows conflict files
- **THEN** if conflicts, offers "Open Worktree" to resolve

#### Scenario: Reject merge
- **WHEN** user clicks "Reject"
- **THEN** extension prompts for optional reason
- **THEN** extension calls POST /workflows/:id/reject-merge
- **THEN** panel closes
- **THEN** workflow moves to blocked status

### Requirement: Question Handling
The extension SHALL handle agent questions.

#### Scenario: Question notification
- **WHEN** daemon emits `agent.question` event
- **THEN** extension shows notification
- **THEN** notification shows question preview
- **THEN** [Answer] action opens response dialog

#### Scenario: Answer question
- **WHEN** user answers question
- **THEN** extension calls POST /questions/:id/answer
- **THEN** question removed from sidebar
- **THEN** agent continues execution

#### Scenario: Question in sidebar
- **GIVEN** pending questions exist
- **WHEN** sidebar renders
- **THEN** Questions section shows badge count
- **THEN** each question shows task reference
- **THEN** clicking opens response dialog

### Requirement: Status Bar
The extension SHALL show daemon status in status bar.

#### Scenario: Connected state
- **GIVEN** extension is connected to daemon
- **WHEN** status bar renders
- **THEN** shows "covend: X active, Y pending"
- **THEN** shows connected indicator
- **THEN** clicking reveals sidebar

#### Scenario: Disconnected state
- **GIVEN** extension is not connected
- **WHEN** status bar renders
- **THEN** shows "covend: disconnected"
- **THEN** clicking attempts reconnect

#### Scenario: No daemon
- **GIVEN** workspace has no .coven/ directory
- **WHEN** status bar renders
- **THEN** shows "Coven: not initialized"
- **THEN** clicking opens setup view

### Requirement: Task Actions
The extension SHALL provide task control actions.

#### Scenario: Start task
- **WHEN** user clicks [Start] on ready task
- **THEN** extension calls POST /tasks/:id/start
- **THEN** task moves to active workflows
- **THEN** workflow begins executing

#### Scenario: Stop task
- **WHEN** user clicks [Cancel] on active workflow
- **THEN** extension calls POST /workflows/:id/cancel
- **THEN** daemon terminates agent if running
- **THEN** task returns to ready state

### Requirement: Optimistic UI Updates
The extension SHALL update UI optimistically.

#### Scenario: Start task optimistically
- **WHEN** user clicks [Start] on task
- **THEN** UI immediately shows task as "starting"
- **THEN** actual status updates when SSE confirms

#### Scenario: Action feedback
- **WHEN** user performs any action
- **THEN** button shows loading state
- **THEN** UI updates immediately with expected state
- **THEN** if action fails, UI reverts and shows error
