# Tasks: Workflow-Based Agent Orchestration

## Phase 1: Core Engine

### 1.1 Core Types
- [ ] 1.1.1 Define `Grimoire` struct in `packages/daemon/internal/types/grimoire.go`
- [ ] 1.1.2 Define `Step` struct with fields for all step types
- [ ] 1.1.3 Define `StepType` enum (agent, script, loop)
- [ ] 1.1.4 Define `WorkflowContext` for state tracking
- [ ] 1.1.5 Define `WorkflowStatus` enum (running, blocked, completed, failed)

### 1.2 Workflow Engine
- [ ] 1.2.1 Create `packages/daemon/internal/workflow/` package
- [ ] 1.2.2 Implement `Engine` struct with Run method
- [ ] 1.2.3 Implement step execution loop (sequential)
- [ ] 1.2.4 Implement `when` condition evaluation
- [ ] 1.2.5 Implement variable resolution (`${variable}` syntax)
- [ ] 1.2.6 Implement special variables (`${bead}`, `${previous.output}`, `${previous.failed}`)
- [ ] 1.2.7 Unit tests for engine

### 1.3 Agent Step Executor
- [ ] 1.3.1 Implement agent step execution (spawn agent with spell)
- [ ] 1.3.2 Capture agent output as step output
- [ ] 1.3.3 Handle agent failure
- [ ] 1.3.4 Unit tests for agent step

### 1.4 Script Step Executor
- [ ] 1.4.1 Implement script step execution (run shell command)
- [ ] 1.4.2 Implement `on_fail` handling (continue, block)
- [ ] 1.4.3 Implement `on_success` handling (exit_loop)
- [ ] 1.4.4 Capture stdout/stderr as output
- [ ] 1.4.5 Unit tests for script step

## Phase 2: Loop and Spells

### 2.1 Loop Step Executor
- [ ] 2.1.1 Implement loop step execution
- [ ] 2.1.2 Implement `max_iterations` limit
- [ ] 2.1.3 Implement `on_max_iterations: block` action
- [ ] 2.1.4 Implement `exit_loop` from nested steps
- [ ] 2.1.5 Pass iteration context to nested steps
- [ ] 2.1.6 Unit tests for loop step

### 2.2 Spell Loader
- [ ] 2.2.1 Create `packages/daemon/internal/spell/` package
- [ ] 2.2.2 Implement file-based spell loading (`.coven/spells/`)
- [ ] 2.2.3 Implement inline spell detection (contains newlines)
- [ ] 2.2.4 Embed built-in spells as Go embed files
- [ ] 2.2.5 Implement resolution order (inline → user → builtin)
- [ ] 2.2.6 Unit tests for spell loading

### 2.3 Spell Renderer
- [ ] 2.3.1 Implement Go template rendering for spells
- [ ] 2.3.2 Pass workflow context variables to template
- [ ] 2.3.3 Validate template syntax on load
- [ ] 2.3.4 Clear error messages for template errors
- [ ] 2.3.5 Unit tests for spell rendering

### 2.4 Spell Partials
- [ ] 2.4.1 Implement `{{include "name.md" var="value"}}` syntax
- [ ] 2.4.2 Support literal string variables: `var="value"`
- [ ] 2.4.3 Support context references: `var={{.bead.title}}`
- [ ] 2.4.4 Implement partial resolution (user → builtin)
- [ ] 2.4.5 Implement nesting with depth limit (prevent cycles)
- [ ] 2.4.6 Unit tests for spell partials

## Phase 3: Grimoire Loading

### 3.1 Grimoire Parser
- [ ] 3.1.1 Create `packages/daemon/internal/grimoire/` package
- [ ] 3.1.2 Implement YAML parser for grimoire files
- [ ] 3.1.3 Validate grimoire schema (required fields, valid step types)
- [ ] 3.1.4 Validate variable references in steps
- [ ] 3.1.5 Unit tests for parser

### 3.2 Grimoire Loader
- [ ] 3.2.1 Implement loader to scan `.coven/grimoires/` directory
- [ ] 3.2.2 Embed built-in grimoires as Go embed files
- [ ] 3.2.3 Implement override (user grimoires replace built-in)
- [ ] 3.2.4 Unit tests for loader

### 3.3 Grimoire Selection
- [ ] 3.3.1 Implement label-based selection (`grimoire:*` label)
- [ ] 3.3.2 Implement type mapping fallback from config
- [ ] 3.3.3 Implement default grimoire fallback
- [ ] 3.3.4 Unit tests for selection

## Phase 4: Built-in Grimoires and Spells

### 4.1 Built-in Spells
- [ ] 4.1.1 Create `implement.md` spell
- [ ] 4.1.2 Create `fix-tests.md` spell
- [ ] 4.1.3 Create `review.md` spell
- [ ] 4.1.4 Create `is-actionable.md` arbiter spell
- [ ] 4.1.5 Create `apply-review-fixes.md` spell

### 4.2 Implement-Bead Grimoire
- [ ] 4.2.1 Create `implement-bead.yaml` with quality loop pattern
- [ ] 4.2.2 Test: implement step spawns agent correctly
- [ ] 4.2.3 Test: quality loop iterates on test failure
- [ ] 4.2.4 Test: quality loop iterates on review findings
- [ ] 4.2.5 Test: exits on final test pass
- [ ] 4.2.6 Test: blocks after max iterations
- [ ] 4.2.7 E2E test: full implement-bead flow

### 4.3 Spec-to-Beads Grimoire
- [ ] 4.3.1 Create `spec-to-beads.md` spell
- [ ] 4.3.2 Create `spec-to-beads.yaml` grimoire
- [ ] 4.3.3 E2E test: openspec → beads created with labels

### 4.4 Prepare-PR Grimoire
- [ ] 4.4.1 Create `prepare-pr.md` spell
- [ ] 4.4.2 Create `prepare-pr.yaml` grimoire
- [ ] 4.4.3 E2E test: branch → PR created

## Phase 5: Scheduler Integration

### 5.1 Bead Lifecycle
- [ ] 5.1.1 Query ready beads (open, no blockers)
- [ ] 5.1.2 Set bead to `in_progress` on pickup
- [ ] 5.1.3 Set bead to `closed` on grimoire success
- [ ] 5.1.4 Set bead to `blocked` on grimoire block action
- [ ] 5.1.5 Respect concurrency limit (N beads at a time)
- [ ] 5.1.6 Unit tests for lifecycle

### 5.2 Workflow Events
- [ ] 5.2.1 Emit `workflow.started` event
- [ ] 5.2.2 Emit `workflow.step.started` event
- [ ] 5.2.3 Emit `workflow.step.completed` event
- [ ] 5.2.4 Emit `workflow.completed` event
- [ ] 5.2.5 Emit `workflow.blocked` event with reason
- [ ] 5.2.6 Integration tests for events

### 5.3 Workflow Logging
- [ ] 5.3.1 Create `.coven/logs/workflows/` directory structure
- [ ] 5.3.2 Implement JSONL logger (one file per workflow: `{workflow-id}.jsonl`)
- [ ] 5.3.3 Log `workflow.start` with workflow_id, bead_id, grimoire
- [ ] 5.3.4 Log `step.start` with step name, type, spell/command
- [ ] 5.3.5 Log `step.input` with resolved input variables
- [ ] 5.3.6 Log `step.output` with full stdout/stderr, exit code
- [ ] 5.3.7 Log `step.end` with status, duration_ms
- [ ] 5.3.8 Log `loop.iteration` with iteration number, continue/exit reason
- [ ] 5.3.9 Log `workflow.end` with final status, total duration
- [ ] 5.3.10 Capture token usage from Claude CLI (if available)
- [ ] 5.3.11 Aggregate token totals at workflow end
- [ ] 5.3.12 Unit tests for logging

### 5.4 Workflow API
- [ ] 5.4.1 Add `GET /workflows` endpoint (list active)
- [ ] 5.4.2 Add `GET /workflows/:id` endpoint (status)
- [ ] 5.4.3 Add `GET /workflows/:id/log` endpoint (fetch log file)
- [ ] 5.4.4 Add `DELETE /workflows/:id` endpoint (cancel)
- [ ] 5.4.5 Integration tests for API

### 5.5 E2E Tests
- [ ] 5.5.1 E2E: bead pickup → grimoire runs → bead closed
- [ ] 5.5.2 E2E: grimoire blocks → bead blocked
- [ ] 5.5.3 E2E: concurrent beads respect limit
- [ ] 5.5.4 E2E: custom grimoire via label
- [ ] 5.5.5 E2E: workflow log file created with expected structure

## Phase 6: Documentation

### 6.1 Documentation
- [ ] 6.1.1 Document grimoire YAML schema
- [ ] 6.1.2 Document step types and options
- [ ] 6.1.3 Document spell template syntax
- [ ] 6.1.4 Document spell partials with variable passing
- [ ] 6.1.5 Document grimoire selection (labels, config)
- [ ] 6.1.6 Document workflow logging format and location
- [ ] 6.1.7 Add example custom grimoire
- [ ] 6.1.8 Add example custom spell with partials
