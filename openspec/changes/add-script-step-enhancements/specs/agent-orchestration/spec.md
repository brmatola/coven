## ADDED Requirements

### Requirement: Script Step Environment Variables
Script steps SHALL support custom environment variables.

#### Scenario: Static environment variables
- **WHEN** a script step defines `env: {NODE_ENV: "production"}`
- **THEN** the command executes with `NODE_ENV=production` in its environment

#### Scenario: Template-rendered environment variables
- **WHEN** a script step defines `env: {API_KEY: "{{.secrets.api_key}}"}`
- **AND** `.coven/secrets.yaml` contains `api_key: "secret123"`
- **THEN** the command executes with `API_KEY=secret123` in its environment

#### Scenario: Environment variables merge with parent
- **WHEN** the daemon process has `PATH=/usr/bin`
- **AND** a script step defines `env: {NODE_ENV: "production"}`
- **THEN** the command inherits `PATH` and adds `NODE_ENV`

### Requirement: Script Step Working Directory
Script steps SHALL support custom working directories.

#### Scenario: Relative working directory
- **WHEN** a script step defines `workdir: "packages/frontend"`
- **AND** the worktree root is `/tmp/worktree/abc123`
- **THEN** the command executes in `/tmp/worktree/abc123/packages/frontend`

#### Scenario: Default working directory
- **WHEN** a script step does not define `workdir`
- **THEN** the command executes in the worktree root

#### Scenario: Invalid working directory
- **WHEN** a script step defines `workdir: "nonexistent/path"`
- **AND** the path does not exist
- **THEN** the step fails with error "workdir not found: nonexistent/path"

### Requirement: Secrets Context
The workflow engine SHALL provide a secrets context for sensitive values.

#### Scenario: Load secrets from file
- **WHEN** `.coven/secrets.yaml` contains `api_key: "secret123"`
- **THEN** `{{.secrets.api_key}}` renders as "secret123"

#### Scenario: Environment variable fallback
- **WHEN** `.coven/secrets.yaml` does not contain `api_key`
- **AND** environment variable `API_KEY` is set to "env_secret"
- **THEN** `{{.secrets.api_key}}` renders as "env_secret"

#### Scenario: Missing secret error
- **WHEN** `{{.secrets.undefined_key}}` is referenced
- **AND** no file or env fallback exists
- **THEN** template rendering fails with "secret not found: undefined_key"

### Requirement: Secret Redaction
Secrets SHALL be redacted from workflow logs.

#### Scenario: Redact secrets in script output
- **WHEN** a script outputs "Using API key: secret123"
- **AND** "secret123" is a value from secrets context
- **THEN** the log shows "Using API key: ***"

#### Scenario: Redact secrets in agent output
- **WHEN** an agent outputs "Configured with secret123"
- **AND** "secret123" is a value from secrets context
- **THEN** the log shows "Configured with ***"
