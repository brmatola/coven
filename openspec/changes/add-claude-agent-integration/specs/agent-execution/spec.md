## ADDED Requirements

### Requirement: Agent Spawning
The system SHALL spawn Claude Code CLI processes to execute tasks in isolated worktrees.

#### Scenario: Spawn agent for task
- **WHEN** FamiliarManager requests an agent for a task
- **THEN** ClaudeAgent spawns a claude process in the task's worktree
- **THEN** the initial prompt includes task description and acceptance criteria
- **THEN** output streaming begins immediately

#### Scenario: Agent working directory
- **WHEN** agent is spawned
- **THEN** agent's working directory is set to the task's worktree
- **THEN** agent has access only to files in that worktree

#### Scenario: Agent availability check
- **WHEN** extension activates
- **THEN** system verifies `claude` command is available
- **THEN** user is warned if Claude Code is not installed

### Requirement: Output Streaming
The system SHALL stream agent output in real-time for display and analysis.

#### Scenario: Real-time output
- **WHEN** agent produces output
- **THEN** output is streamed to registered callbacks
- **THEN** output is buffered for later retrieval

#### Scenario: Output parsing
- **WHEN** output is received
- **THEN** system detects agent status changes (thinking, writing, running commands)
- **THEN** system detects completion signals
- **THEN** system detects questions requiring response

### Requirement: Question Handling
The system SHALL detect when agents ask questions and route them for human response.

#### Scenario: Question detection
- **WHEN** agent asks a question in output
- **THEN** question is parsed and categorized
- **THEN** suggested responses are extracted if present
- **THEN** onQuestion callback is invoked with structured data

#### Scenario: Response injection
- **WHEN** human provides response to question
- **THEN** response is written to agent's stdin
- **THEN** agent continues execution

#### Scenario: Permission request
- **WHEN** agent requests permission (e.g., run npm install)
- **THEN** question type is set to "permission"
- **THEN** quick actions include Allow, Deny, Allow All

### Requirement: Agent Termination
The system SHALL support graceful and forced agent termination.

#### Scenario: Graceful termination
- **WHEN** termination is requested
- **THEN** SIGTERM is sent to agent process
- **THEN** system waits up to 10 seconds for graceful exit

#### Scenario: Forced termination
- **WHEN** agent does not exit after SIGTERM timeout
- **THEN** SIGKILL is sent to force termination
- **THEN** any partial work in worktree is preserved

#### Scenario: Timeout termination
- **WHEN** agent exceeds configured timeout without progress
- **THEN** agent is terminated
- **THEN** task is marked as blocked with timeout reason

### Requirement: Agent Completion
The system SHALL detect when agents complete their tasks successfully.

#### Scenario: Successful completion
- **WHEN** agent signals task completion
- **THEN** onComplete callback is invoked with result
- **THEN** result includes summary and list of changed files
- **THEN** familiar status transitions to merging

#### Scenario: Agent failure
- **WHEN** agent exits with error or reports inability to complete
- **THEN** onComplete callback is invoked with failure result
- **THEN** task is marked as blocked with error details
