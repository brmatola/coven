# Agent Roles Specification

## ADDED Requirements

### Requirement: Role Definition
The system SHALL support role definitions that specify agent behavior and prompt templates.

A role definition SHALL include:
- A unique role name (kebab-case identifier)
- A human-readable description
- A list of applicable task types
- A prompt template with placeholders for context injection
- Context requirements specifying what context to gather

#### Scenario: Role loaded from built-in defaults
- **WHEN** the daemon starts
- **THEN** built-in roles (implement, fix, refactor, test, review) SHALL be available
- **AND** each role SHALL have a complete prompt template

#### Scenario: Role loaded from custom file
- **WHEN** a YAML file exists in `.coven/roles/`
- **THEN** the role SHALL be loaded and available for selection
- **AND** the role MAY override or extend built-in roles

### Requirement: Role Selection
The system SHALL select the appropriate role for a task based on configurable rules.

Role selection SHALL follow this priority order:
1. Explicit role override in task metadata (if specified)
2. Task type mapping from configuration
3. Default role from configuration

#### Scenario: Role selected by task type
- **WHEN** a task has type "bug"
- **AND** no explicit role override is specified
- **THEN** the "fix" role SHALL be selected

#### Scenario: Role selected by explicit override
- **WHEN** a task specifies role "custom-review"
- **THEN** the "custom-review" role SHALL be selected
- **AND** task type mapping SHALL be ignored

#### Scenario: Fallback to default role
- **WHEN** a task has no type or an unknown type
- **AND** no role override is specified
- **THEN** the default role (implement) SHALL be selected

### Requirement: Built-in Roles
The system SHALL provide built-in roles for common development tasks.

| Role | Task Types | Purpose |
|------|------------|---------|
| `implement` | feature, task | Implementing new functionality |
| `fix` | bug | Fixing bugs and issues |
| `refactor` | refactor | Improving code without changing behavior |
| `test` | test | Writing tests for existing code |
| `review` | (internal) | Reviewing changes made by other agents |

#### Scenario: Implement role usage
- **WHEN** a task with type "feature" is started
- **THEN** the "implement" role SHALL be used
- **AND** the prompt SHALL include guidelines for writing new code with tests

#### Scenario: Fix role usage
- **WHEN** a task with type "bug" is started
- **THEN** the "fix" role SHALL be used
- **AND** the prompt SHALL include guidelines for diagnosing and fixing issues

#### Scenario: Review role usage
- **WHEN** an implementation completes and review is enabled
- **THEN** the "review" role SHALL be used for the review agent
- **AND** the prompt SHALL include the changes made and review checklist

### Requirement: Custom Roles
Users SHALL be able to define custom roles in `.coven/roles/` directory.

Custom role files SHALL:
- Use YAML format
- Include all required fields (name, description, prompt_template)
- Support template inheritance via `base` field (optional)

#### Scenario: Custom role creation
- **GIVEN** a file `.coven/roles/team-implement.yaml` exists
- **AND** it contains a valid role definition
- **WHEN** the daemon loads roles
- **THEN** the "team-implement" role SHALL be available
- **AND** it MAY be selected via task metadata or type mapping

#### Scenario: Custom role inherits from built-in
- **GIVEN** a custom role specifies `base: implement`
- **WHEN** the role is loaded
- **THEN** the custom role SHALL inherit unspecified fields from "implement"
- **AND** explicit fields in the custom role SHALL override inherited values

### Requirement: Role Template Rendering
The system SHALL render role prompt templates with task and context data.

Template rendering SHALL support:
- Go template syntax (`{{.Field}}`, `{{if}}`, `{{range}}`)
- Task fields: Title, Description, AcceptanceCriteria, Type, ID
- Context fields: RepoContext, RelevantFiles, PriorAttempts, SessionContext
- Custom instructions from configuration

#### Scenario: Template renders task fields
- **GIVEN** a role template containing `{{.Title}}`
- **WHEN** the prompt is built for a task with title "Add login button"
- **THEN** the rendered prompt SHALL contain "Add login button"

#### Scenario: Template renders conditional sections
- **GIVEN** a role template with `{{if .AcceptanceCriteria}}...{{end}}`
- **WHEN** the task has acceptance criteria
- **THEN** the conditional section SHALL be rendered
- **WHEN** the task has no acceptance criteria
- **THEN** the conditional section SHALL be omitted

### Requirement: Role Validation
The system SHALL validate role definitions and report errors.

Validation SHALL check:
- Required fields are present (name, prompt_template)
- Template syntax is valid (parseable by Go template engine)
- Referenced base role exists (for custom roles)
- No duplicate role names

#### Scenario: Invalid role template rejected
- **GIVEN** a custom role with invalid template syntax `{{.Unclosed`
- **WHEN** the daemon attempts to load roles
- **THEN** the invalid role SHALL be rejected with an error
- **AND** other valid roles SHALL still be loaded

#### Scenario: Duplicate role name rejected
- **GIVEN** a custom role with name "implement" (same as built-in)
- **AND** the role does not specify `base: implement`
- **WHEN** the daemon attempts to load roles
- **THEN** the custom role SHALL override the built-in
- **OR** an error SHALL be logged if override is not intended
