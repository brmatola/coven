# Agent Execution Spec Delta

## MODIFIED Requirements

### Requirement: Output Streaming
The system SHALL stream agent output in real-time AND persist it to survive daemon restarts.

#### Scenario: Real-time output
- **WHEN** agent produces output
- **THEN** output is streamed to registered callbacks (unchanged)
- **AND** output is written to persistent JSONL file

#### Scenario: Output persistence
- **WHEN** agent output is received
- **THEN** output is appended to `.coven/output/{taskId}.jsonl`
- **AND** each line includes: sequence number, timestamp, stream (stdout/stderr), data
- **AND** output survives daemon restart

#### Scenario: Output file format
- **GIVEN** output is stored in JSONL format
- **WHEN** a line is written
- **THEN** it follows this structure:
  ```json
  {"seq":1,"ts":"2024-01-15T10:00:00Z","stream":"stdout","data":"Starting task..."}
  ```
- **AND** `seq` is monotonically increasing within the file
- **AND** `stream` is either "stdout" or "stderr"

#### Scenario: Output retrieval after restart
- **WHEN** daemon restarts
- **AND** agent output file exists at `.coven/output/{taskId}.jsonl`
- **THEN** `/agents/{id}/output` API returns persisted output
- **AND** output is available for display in extension

#### Scenario: Output delta queries
- **WHEN** `/agents/{id}/output?since={seq}` is called
- **THEN** only lines with sequence > `since` are returned
- **AND** response includes `last_seq` for next delta query

#### Scenario: Output buffer removed
- **GIVEN** output was previously stored in an in-memory RingBuffer
- **WHEN** this change is applied
- **THEN** the RingBuffer is removed
- **AND** all output is read from persistent files

### Requirement: Agent Completion
The system SHALL persist agent state to support restart recovery.

#### Scenario: Agent state persistence
- **WHEN** agent is spawned
- **THEN** agent metadata is written to unified store (bbolt)
- **AND** metadata includes: task_id, status, worktree, branch, PID, output_file path

#### Scenario: Agent state on restart
- **WHEN** daemon restarts
- **AND** agent records exist in store with status "running"
- **THEN** daemon checks if PID is still running
- **AND** if process exists and is claude, reconnects to output stream
- **AND** if process is dead, marks agent as "failed" with error "daemon restarted"

#### Scenario: Agent state transitions persisted
- **WHEN** agent status changes (starting → running → completed/failed/killed)
- **THEN** status is persisted to store atomically
- **AND** timestamps (started_at, ended_at) are persisted

### Requirement: Question Handling
The system SHALL persist questions to survive daemon restarts.

#### Scenario: Question persistence
- **WHEN** agent asks a question
- **THEN** question is written to unified store (bbolt)
- **AND** question includes: id, task_id, prompt, options, status

#### Scenario: Question survives restart
- **WHEN** daemon restarts
- **AND** pending questions exist in store
- **THEN** questions are re-emitted via SSE on reconnect
- **AND** user can still respond to questions

#### Scenario: Question response persisted
- **WHEN** user responds to a question
- **THEN** response is written to agent stdin
- **AND** response is stored in question record
- **AND** question status transitions to "answered"

#### Scenario: Question cleanup
- **WHEN** agent record is purged (via retention policy)
- **THEN** all associated questions are deleted

## ADDED Requirements

### Requirement: Agent Output Retention
The system SHALL manage agent output file lifecycle.

#### Scenario: Output file creation
- **WHEN** agent is spawned
- **THEN** output file is created at `.coven/output/{taskId}.jsonl`
- **AND** file path is stored in agent record

#### Scenario: Output file cleanup
- **WHEN** agent record is purged (via retention policy)
- **THEN** associated output file is deleted

#### Scenario: Output directory management
- **WHEN** daemon starts
- **THEN** `.coven/output/` directory is created if not exists
- **AND** orphan output files (no matching agent record) are cleaned up

### Requirement: Agent Event Logging
The system SHALL persist agent events for replay on reconnection.

#### Scenario: Agent events persisted
- **WHEN** agent event occurs (started, output, completed, failed, killed)
- **THEN** event is written to unified store before SSE broadcast
- **AND** event is available for replay

#### Scenario: Agent event replay
- **WHEN** extension reconnects via `GET /events?since={timestamp}&entity={taskId}`
- **THEN** missed agent events are returned
- **AND** extension can update its cache
