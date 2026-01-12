## ADDED Requirements

### Requirement: Grimoire JSON Schema
The system SHALL provide a JSON schema for grimoire validation and IDE support.

#### Scenario: Schema file exists
- **WHEN** a user looks for IDE integration
- **THEN** `schemas/grimoire-schema.json` exists in the repository

#### Scenario: VS Code autocomplete
- **WHEN** user configures YAML schema association
- **AND** edits a grimoire file
- **THEN** VS Code provides autocomplete for grimoire fields

#### Scenario: VS Code inline validation
- **WHEN** user configures YAML schema association
- **AND** writes an invalid grimoire (e.g., unknown step type)
- **THEN** VS Code shows inline error before daemon startup

#### Scenario: Hover documentation
- **WHEN** user hovers over a grimoire field in VS Code
- **THEN** a description of the field is shown

#### Scenario: Timeout format validation
- **WHEN** a grimoire specifies `timeout: "15 minutes"`
- **THEN** schema validation fails with pattern mismatch
- **AND** expected format (Go duration) is shown

#### Scenario: Step type discrimination
- **WHEN** a step has `type: agent`
- **THEN** only agent-specific fields are suggested
- **AND** script-specific fields show as invalid
