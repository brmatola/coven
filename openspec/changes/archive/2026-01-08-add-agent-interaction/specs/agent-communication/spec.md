## ADDED Requirements

### Requirement: Agent Output Display
The system SHALL display agent output in real-time via VSCode output channels.

#### Scenario: Output channel creation
- **WHEN** an agent is spawned
- **THEN** a dedicated output channel is created named "Coven: {taskTitle}"
- **THEN** output channel is revealed if configured

#### Scenario: Real-time streaming
- **WHEN** agent produces output
- **THEN** output appears in channel immediately
- **THEN** output includes timestamps

#### Scenario: Output channel cleanup
- **WHEN** task completes or is terminated
- **THEN** output channel remains available for review
- **THEN** channel is disposed when session ends

### Requirement: Output Persistence
The system SHALL persist agent output to disk for recovery and debugging.

#### Scenario: Output file creation
- **WHEN** an agent is spawned
- **THEN** output is written to `.coven/output/{taskId}.log`
- **THEN** file is created immediately, not buffered

#### Scenario: Real-time persistence
- **WHEN** agent produces output
- **THEN** output is appended to log file immediately
- **THEN** output includes timestamps matching the output channel

#### Scenario: Recovery after restart
- **WHEN** VSCode restarts with a task in working/review status
- **THEN** persisted output is loaded into output channel
- **THEN** user can review what happened before restart

#### Scenario: Output for completed tasks
- **WHEN** user opens output for a completed task
- **THEN** persisted log is loaded into output channel on demand
- **THEN** output remains available until session ends

#### Scenario: Output cleanup
- **WHEN** session ends normally
- **THEN** output files for completed tasks are retained (configurable retention)
- **THEN** output files for reverted tasks are deleted

### Requirement: Question Response Flow
The system SHALL provide a UI for responding to agent questions.

#### Scenario: Question panel display
- **WHEN** agent asks a question
- **THEN** a response panel is displayed
- **THEN** panel shows question text and context
- **THEN** suggested responses are shown as quick-select buttons

#### Scenario: Quick response selection
- **WHEN** user clicks a suggested response
- **THEN** response is sent to agent
- **THEN** panel closes and agent continues

#### Scenario: Custom response
- **WHEN** user types a custom response
- **THEN** response is sent to agent when submitted
- **THEN** panel closes and agent continues

#### Scenario: Permission questions
- **WHEN** agent asks for permission (e.g., install package)
- **THEN** panel shows Allow, Deny, Allow All options
- **THEN** Allow All remembers preference for session

### Requirement: Notification System
The system SHALL notify users of events requiring attention.

#### Scenario: Task completion notification
- **WHEN** agent completes a task
- **THEN** notification appears with task title
- **THEN** "Review" action button opens review panel

#### Scenario: Question notification
- **WHEN** agent asks a question
- **THEN** notification appears with question preview
- **THEN** "Respond" action button opens response panel

#### Scenario: Agent stuck notification
- **WHEN** agent reports being blocked or stuck
- **THEN** warning notification appears
- **THEN** "Help" action button opens output with context

#### Scenario: Conflict resolved notification
- **WHEN** merge conflict is automatically resolved
- **THEN** info notification confirms resolution
- **THEN** includes details of resolved files

### Requirement: Activity Log
The system SHALL maintain a log of session events for review.

#### Scenario: Event logging
- **WHEN** significant events occur (task state changes, questions, merges)
- **THEN** events are logged with timestamp
- **THEN** log is visible in sidebar activity section

#### Scenario: Log navigation
- **WHEN** user clicks a log entry
- **THEN** relevant item is revealed (task, output channel, review panel)

#### Scenario: Log persistence
- **WHEN** session is active
- **THEN** log entries are preserved in memory
- **THEN** log is cleared when session ends
