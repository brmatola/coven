## ADDED Requirements

### Requirement: CLI Binary
The system SHALL provide a `coven` CLI binary for terminal-based daemon interaction.

#### Scenario: CLI talks to daemon
- **WHEN** user runs `coven status`
- **THEN** CLI connects to `.coven/covend.sock`
- **THEN** CLI calls GET /state
- **THEN** CLI displays human-readable status

**Note:** This spec is DEFERRED. Implementation details TBD post-MVP.
