# Tasks: Agent Orchestration and Role-Based Prompt System

## Phase 1: Role System Foundation

### 1.1 Role Types and Interfaces
- [ ] 1.1.1 Define `Role` struct in `packages/daemon/internal/types/role.go`
- [ ] 1.1.2 Define `RoleLoader` interface
- [ ] 1.1.3 Define `RoleResolver` interface
- [ ] 1.1.4 Add role-related fields to `Task` type (role override, acceptance criteria)

### 1.2 Built-in Roles
- [ ] 1.2.1 Create `packages/daemon/internal/roles/` package
- [ ] 1.2.2 Implement `implement` role template
- [ ] 1.2.3 Implement `fix` role template
- [ ] 1.2.4 Implement `refactor` role template
- [ ] 1.2.5 Implement `test` role template
- [ ] 1.2.6 Implement `review` role template

### 1.3 Role Loader
- [ ] 1.3.1 Implement default role loader (embedded templates)
- [ ] 1.3.2 Implement file-based role loader (reads from `.coven/roles/`)
- [ ] 1.3.3 Implement role merging (custom extends/overrides built-in)
- [ ] 1.3.4 Add role validation (required fields, template syntax)
- [ ] 1.3.5 Unit tests for role loader

### 1.4 Role Resolver
- [ ] 1.4.1 Implement task-type to role mapping
- [ ] 1.4.2 Implement role override from task metadata
- [ ] 1.4.3 Implement fallback to default role
- [ ] 1.4.4 Unit tests for role resolver

### 1.5 Integration with Scheduler
- [ ] 1.5.1 Update scheduler to use role resolver
- [ ] 1.5.2 Pass resolved role to prompt builder
- [ ] 1.5.3 Integration tests for role selection

### 1.6 E2E Tests: Role Selection
- [ ] 1.6.1 Test default role selection by task type
- [ ] 1.6.2 Test role override via task metadata
- [ ] 1.6.3 Test custom role loading from `.coven/roles/`
- [ ] 1.6.4 Test invalid role handling

## Phase 2: Prompt Building

### 2.1 Prompt Builder Package
- [ ] 2.1.1 Create `packages/daemon/internal/prompt/` package
- [ ] 2.1.2 Define `PromptBuilder` interface
- [ ] 2.1.3 Define `PromptContext` struct (all context components)
- [ ] 2.1.4 Implement template rendering with Go templates
- [ ] 2.1.5 Unit tests for template rendering

### 2.2 Context Gatherer
- [ ] 2.2.1 Implement `RepoStructureGatherer` (directory tree)
- [ ] 2.2.2 Implement `RelevantFilesGatherer` (keyword-based file search)
- [ ] 2.2.3 Implement `PriorAttemptsGatherer` (load from state)
- [ ] 2.2.4 Implement `SessionContextGatherer` (other active tasks)
- [ ] 2.2.5 Implement context budget management (limit tokens)
- [ ] 2.2.6 Unit tests for context gatherers

### 2.3 Acceptance Criteria Support
- [ ] 2.3.1 Add acceptance criteria parsing from task description
- [ ] 2.3.2 Support explicit acceptance criteria field in beads
- [ ] 2.3.3 Include acceptance criteria in prompt templates
- [ ] 2.3.4 Unit tests for acceptance criteria handling

### 2.4 Integration with Scheduler
- [ ] 2.4.1 Replace simple prompt building with PromptBuilder
- [ ] 2.4.2 Wire context gatherers into scheduler
- [ ] 2.4.3 Add prompt building error handling
- [ ] 2.4.4 Integration tests for prompt building

### 2.5 E2E Tests: Prompt Building
- [ ] 2.5.1 Test prompt contains task title and description
- [ ] 2.5.2 Test prompt contains repo context
- [ ] 2.5.3 Test prompt contains acceptance criteria
- [ ] 2.5.4 Test prompt contains custom instructions from config
- [ ] 2.5.5 Test context budget enforcement

## Phase 3: Review Workflow

### 3.1 Review Agent Package
- [ ] 3.1.1 Create `packages/daemon/internal/review/` package
- [ ] 3.1.2 Define `ReviewAgent` struct
- [ ] 3.1.3 Define `ReviewResult` struct (verdict, findings, suggestions)
- [ ] 3.1.4 Implement review agent lifecycle (spawn after implementation)

### 3.2 Review Checks
- [ ] 3.2.1 Implement `TestCoverageCheck` (detect new code without tests)
- [ ] 3.2.2 Implement `BuildPassesCheck` (run build command)
- [ ] 3.2.3 Implement `LintPassesCheck` (run lint command)
- [ ] 3.2.4 Implement `E2ETestsCheck` (detect user-facing changes without E2E)
- [ ] 3.2.5 Define check severity levels (error, warning, info)
- [ ] 3.2.6 Unit tests for review checks

### 3.3 Review Configuration
- [ ] 3.3.1 Define review config schema
- [ ] 3.3.2 Implement review mode handling (strict, normal, yolo)
- [ ] 3.3.3 Implement configurable check enablement
- [ ] 3.3.4 Load review config from `.coven/config.json`
- [ ] 3.3.5 Unit tests for review configuration

### 3.4 Review Integration
- [ ] 3.4.1 Trigger review agent after implementation completes
- [ ] 3.4.2 Report review results via events/API
- [ ] 3.4.3 Block merge on review failure (configurable)
- [ ] 3.4.4 Support auto-merge on review pass (yolo mode)
- [ ] 3.4.5 Integration tests for review workflow

### 3.5 E2E Tests: Review Workflow
- [ ] 3.5.1 Test review agent spawns after implementation
- [ ] 3.5.2 Test review checks execute and report findings
- [ ] 3.5.3 Test strict mode blocks on any failure
- [ ] 3.5.4 Test normal mode reports warnings but allows proceed
- [ ] 3.5.5 Test yolo mode auto-merges on no errors

## Phase 4: Configuration System

### 4.1 Config Schema
- [ ] 4.1.1 Define full config schema with all options
- [ ] 4.1.2 Implement config validation
- [ ] 4.1.3 Implement config defaults
- [ ] 4.1.4 Unit tests for config schema

### 4.2 Config Loading
- [ ] 4.2.1 Implement `.coven/config.json` loader
- [ ] 4.2.2 Implement config file watcher (hot reload)
- [ ] 4.2.3 Merge user config with defaults
- [ ] 4.2.4 Unit tests for config loading

### 4.3 Custom Roles
- [ ] 4.3.1 Support YAML role files in `.coven/roles/`
- [ ] 4.3.2 Implement role inheritance (custom extends built-in)
- [ ] 4.3.3 Validate custom role templates
- [ ] 4.3.4 Unit tests for custom roles

### 4.4 Context Configuration
- [ ] 4.4.1 Support custom instructions in config
- [ ] 4.4.2 Support excluded paths for context gathering
- [ ] 4.4.3 Support relevant files limit
- [ ] 4.4.4 Unit tests for context configuration

### 4.5 E2E Tests: Configuration
- [ ] 4.5.1 Test config loading from `.coven/config.json`
- [ ] 4.5.2 Test custom role loading from `.coven/roles/`
- [ ] 4.5.3 Test config defaults apply when no config present
- [ ] 4.5.4 Test invalid config handling

## Phase 5: Documentation and Polish

### 5.1 Documentation
- [ ] 5.1.1 Document role system in README
- [ ] 5.1.2 Document configuration options
- [ ] 5.1.3 Provide example `.coven/` configuration
- [ ] 5.1.4 Document review workflow

### 5.2 Final Validation
- [ ] 5.2.1 Run full test suite (unit + E2E)
- [ ] 5.2.2 Manual testing of complete workflow
- [ ] 5.2.3 Performance testing (context gathering overhead)
- [ ] 5.2.4 Update daemon README with new features
