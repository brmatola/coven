# Tasks: Workflow-Based Agent Orchestration

## Phase 1: Core Engine

### 1.1 Core Types
- [ ] 1.1.1 Define `AgentOutput` struct (success, summary, outputs, error)
- [ ] 1.1.2 Define `Grimoire` struct in `packages/daemon/internal/types/grimoire.go`
- [ ] 1.1.3 Define `Step` struct with fields for all step types (including timeout, merge fields)
- [ ] 1.1.4 Define `StepType` enum (agent, script, loop, merge)
- [ ] 1.1.5 Define `WorkflowContext` for state tracking
- [ ] 1.1.6 Define `WorkflowStatus` enum (running, blocked, completed, failed, pending_merge, cancelled)
- [ ] 1.1.7 Define `PersistedWorkflowState` for state persistence
- [ ] 1.1.8 Define `LoopState` for loop iteration tracking

### 1.2 Workflow Engine
- [ ] 1.2.1 Create `packages/daemon/internal/workflow/` package
- [ ] 1.2.2 Implement `Engine` struct with Run method
- [ ] 1.2.3 Implement step execution loop (sequential)
- [ ] 1.2.4 Implement `when` condition evaluation with strict boolean check
- [ ] 1.2.5 Implement variable resolution (`{{.variable}}` Go template syntax)
- [ ] 1.2.6 Implement special variables (`{{.bead}}`, `{{.previous.output}}`, `{{.previous.failed}}`)
- [ ] 1.2.7 Implement loop variable scoping (`{{.loop_entry.*}}` for pre-loop context, `{{.previous}}` undefined on first step of first iteration)
- [ ] 1.2.8 Implement variable type rendering (strings as-is, arrays/objects as JSON)
- [ ] 1.2.9 Implement workflow-level timeout (default: 2h)
- [ ] 1.2.10 Unit tests for engine
- [ ] 1.2.11 Unit tests for variable type rendering
- [ ] 1.2.12 Unit tests for strict boolean condition evaluation

### 1.3 Agent Step Executor
- [ ] 1.3.1 Implement agent step execution (spawn agent with composed prompt)
- [ ] 1.3.2 Implement system prompt composition (system prompt + spell content)
- [ ] 1.3.3 Parse agent output for AgentOutput JSON block
- [ ] 1.3.4 Store parsed AgentOutput in workflow context
- [ ] 1.3.5 Handle missing/invalid AgentOutput as failure
- [ ] 1.3.6 Implement step timeout (default: 15m)
- [ ] 1.3.7 Kill agent process on timeout
- [ ] 1.3.8 Unit tests for agent step
- [ ] 1.3.9 Unit tests for agent timeout

### 1.4 Script Step Executor
- [ ] 1.4.1 Implement script step execution (run shell command)
- [ ] 1.4.2 Implement `on_fail` handling (continue, block)
- [ ] 1.4.3 Implement `on_success` handling (exit_loop)
- [ ] 1.4.4 Capture stdout/stderr as output
- [ ] 1.4.5 Implement shell variable escaping (single-quote wrapping)
- [ ] 1.4.6 Implement `{{raw .var}}` for unescaped interpolation (with warning log)
- [ ] 1.4.7 Implement step timeout (default: 5m)
- [ ] 1.4.8 Kill script process on timeout
- [ ] 1.4.9 Unit tests for script step
- [ ] 1.4.10 Unit tests for shell escaping (injection prevention)
- [ ] 1.4.11 Unit tests for script timeout

### 1.5 Merge Step Executor
- [ ] 1.5.1 Implement merge step execution
- [ ] 1.5.2 Implement `require_review` handling (pause workflow, set status to pending_merge)
- [ ] 1.5.3 Emit `workflow.merge_pending` event
- [ ] 1.5.4 Implement merge approval flow (resume workflow after approval)
- [ ] 1.5.5 Implement merge rejection flow (block workflow)
- [ ] 1.5.6 Implement merge conflict detection and blocking
- [ ] 1.5.7 Include conflict details in blocked state (files, conflict markers)
- [ ] 1.5.8 Unit tests for merge step
- [ ] 1.5.9 Unit tests for merge conflict blocking

### 1.6 Worktree Lifecycle
- [ ] 1.6.1 Create worktree at `.worktrees/{bead-id}/` when scheduler picks up bead
- [ ] 1.6.2 Set workflow working directory to worktree
- [ ] 1.6.3 Implement worktree cleanup after successful merge (background)
- [ ] 1.6.4 Implement worktree retention on cancel (configurable)
- [ ] 1.6.5 Unit tests for worktree lifecycle

## Phase 2: Loop and Spells

### 2.1 Loop Step Executor
- [ ] 2.1.1 Implement loop step execution
- [ ] 2.1.2 Implement `max_iterations` limit
- [ ] 2.1.3 Implement `on_max_iterations: block` action
- [ ] 2.1.4 Implement `exit_loop` from nested steps
- [ ] 2.1.5 Implement `{{.loop_entry}}` context capture (step before loop)
- [ ] 2.1.6 Implement `{{.previous}}` scoping within iteration
- [ ] 2.1.7 Unit tests for loop step

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

### 2.4 System Prompt
- [ ] 2.4.1 Create built-in system prompt template
- [ ] 2.4.2 Implement system prompt loading (user override → builtin)
- [ ] 2.4.3 Implement prompt composition (system prompt wraps spell content)
- [ ] 2.4.4 Render `{{.spell_content}}` placeholder with spell
- [ ] 2.4.5 Unit tests for system prompt composition

### 2.5 Spell Partials
- [ ] 2.5.1 Implement `{{include "name.md" var="value"}}` syntax
- [ ] 2.5.2 Support literal string variables: `var="value"`
- [ ] 2.5.3 Support context references: `var={{.bead.title}}`
- [ ] 2.5.4 Implement partial resolution (user → builtin)
- [ ] 2.5.5 Implement nesting with depth limit (prevent cycles)
- [ ] 2.5.6 Unit tests for spell partials

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

### 3.4 Dry-Run Mode
- [ ] 3.4.1 Implement `coven grimoire preview` command
- [ ] 3.4.2 Resolve grimoire for given bead (label → type → default)
- [ ] 3.4.3 Resolve all spell references (file or inline)
- [ ] 3.4.4 Validate template syntax (Go templates parse correctly)
- [ ] 3.4.5 Validate static variable references (`{{.bead.id}}`, etc.)
- [ ] 3.4.6 Validate step structure (required fields, valid types)
- [ ] 3.4.7 Display step sequence with types and inputs
- [ ] 3.4.8 Display validation results (pass/fail with details)
- [ ] 3.4.9 Return non-zero exit code on validation failure
- [ ] 3.4.10 Unit tests for dry-run validation
- [ ] 3.4.11 Integration test: valid grimoire passes dry-run
- [ ] 3.4.12 Integration test: invalid spell reference fails dry-run
- [ ] 3.4.13 Integration test: invalid template syntax fails dry-run

## Phase 4: Built-in Grimoires and Spells

### 4.1 Built-in Spells
- [ ] 4.1.1 Create `implement.md` spell
- [ ] 4.1.2 Create `fix-tests.md` spell
- [ ] 4.1.3 Create `review.md` spell
- [ ] 4.1.4 Create `is-actionable.md` arbiter spell
- [ ] 4.1.5 Create `apply-review-fixes.md` spell
- [ ] 4.1.6 Create `analyze-spec.md` spell (for spec-to-beads)
- [ ] 4.1.7 Create `create-beads.md` spell (for spec-to-beads)
- [ ] 4.1.8 Create `pr-summary.md` spell (for prepare-pr)

### 4.2 Implement-Bead Grimoire
- [ ] 4.2.1 Create `implement-bead.yaml` with quality loop pattern and merge step
- [ ] 4.2.2 Test: implement step spawns agent correctly
- [ ] 4.2.3 Test: quality loop iterates on test failure
- [ ] 4.2.4 Test: quality loop iterates on review findings
- [ ] 4.2.5 Test: exits on final test pass
- [ ] 4.2.6 Test: blocks after max iterations
- [ ] 4.2.7 Test: merge step triggers pending_merge status
- [ ] 4.2.8 E2E test: full implement-bead flow (implement → quality loop → merge)

### 4.3 Spec-to-Beads Grimoire
- [ ] 4.3.1 Create `spec-to-beads.yaml` grimoire
- [ ] 4.3.2 E2E test: openspec → beads created with labels

### 4.4 Prepare-PR Grimoire
- [ ] 4.4.1 Create `prepare-pr.yaml` grimoire
- [ ] 4.4.2 E2E test: branch → PR created

## Phase 5: Workflow State Persistence

### 5.1 State Storage
- [ ] 5.1.1 Create `.coven/state/workflows/` directory structure
- [ ] 5.1.2 Implement state serialization to JSON
- [ ] 5.1.3 Persist state after each step completion
- [ ] 5.1.4 Persist state at loop iteration boundaries
- [ ] 5.1.5 Persist blocked reason and context when workflow blocks
- [ ] 5.1.6 Unit tests for state persistence

### 5.2 State Resumption
- [ ] 5.2.1 Scan state directory on daemon startup
- [ ] 5.2.2 Resume running workflows from last completed step
- [ ] 5.2.3 Restore workflow context variables from step results
- [ ] 5.2.4 Re-execute current step on resume
- [ ] 5.2.5 Handle blocked workflows (remain blocked until user action)
- [ ] 5.2.6 Unit tests for resumption

### 5.3 State Cleanup
- [ ] 5.3.1 Implement retention policy for completed workflows
- [ ] 5.3.2 Delete state files after configurable retention (default: 7 days)
- [ ] 5.3.3 Retain blocked workflow state until resolved

## Phase 6: Scheduler Integration

### 6.1 Bead Lifecycle
- [ ] 6.1.1 Query ready beads (open, no blockers)
- [ ] 6.1.2 Set bead to `in_progress` on pickup
- [ ] 6.1.3 Set bead to `closed` on grimoire success
- [ ] 6.1.4 Set bead to `blocked` on grimoire block action
- [ ] 6.1.5 Respect concurrency limit (N beads at a time)
- [ ] 6.1.6 Unit tests for lifecycle

### 6.2 Workflow Events
- [ ] 6.2.1 Emit `workflow.started` event
- [ ] 6.2.2 Emit `workflow.step.started` event
- [ ] 6.2.3 Emit `workflow.step.completed` event
- [ ] 6.2.4 Emit `workflow.loop.iteration` event
- [ ] 6.2.5 Emit `workflow.completed` event
- [ ] 6.2.6 Emit `workflow.blocked` event with reason and context
- [ ] 6.2.7 Emit `workflow.cancelled` event
- [ ] 6.2.8 Emit `workflow.merge_pending` event with worktree path and diff summary
- [ ] 6.2.9 Integration tests for events

### 6.3 Workflow Logging
- [ ] 6.3.1 Create `.coven/logs/workflows/` directory structure
- [ ] 6.3.2 Implement JSONL logger (one file per workflow: `{workflow-id}.jsonl`)
- [ ] 6.3.3 Log `workflow.start` with workflow_id, bead_id, grimoire
- [ ] 6.3.4 Log `step.start` with step name, type, spell/command
- [ ] 6.3.5 Log `step.input` with resolved input variables
- [ ] 6.3.6 Log `step.output` with summary, exit code
- [ ] 6.3.7 Log `step.end` with status, duration_ms
- [ ] 6.3.8 Log `loop.iteration` with iteration number, continue/exit reason
- [ ] 6.3.9 Log `workflow.end` with final status, total duration
- [ ] 6.3.10 Capture token usage from Claude CLI (if available)
- [ ] 6.3.11 Aggregate token totals at workflow end
- [ ] 6.3.12 Unit tests for workflow-level logging

### 6.4 Agent Event Logging
- [ ] 6.4.1 Parse Claude CLI output stream for structured events
- [ ] 6.4.2 Log `agent.thinking` with reasoning content
- [ ] 6.4.3 Log `agent.tool_call` with tool name and input parameters
- [ ] 6.4.4 Log `agent.tool_result` with output, duration, exit code
- [ ] 6.4.5 Log `agent.message` for assistant text responses
- [ ] 6.4.6 Handle streaming output (log events as they arrive)
- [ ] 6.4.7 Unit tests for agent event parsing

## Phase 7: Workflow REST API

### 7.1 Workflow Endpoints
- [ ] 7.1.1 Add `GET /workflows` endpoint (list active, blocked, pending_merge, recent)
- [ ] 7.1.2 Add `GET /workflows/:id` endpoint (full workflow state)
- [ ] 7.1.3 Add `GET /workflows/:id/log` endpoint (fetch/stream log file)
- [ ] 7.1.4 Add `POST /workflows/:id/cancel` endpoint (cancel running workflow, kill process, cleanup worktree)
- [ ] 7.1.5 Add `POST /workflows/:id/retry` endpoint (retry blocked workflow)
- [ ] 7.1.6 Add `POST /workflows/:id/restart` endpoint (restart from beginning)
- [ ] 7.1.7 Add `POST /workflows/:id/approve-merge` endpoint (approve pending merge)
- [ ] 7.1.8 Add `POST /workflows/:id/reject-merge` endpoint (reject pending merge, block workflow)
- [ ] 7.1.9 Integration tests for API
- [ ] 7.1.10 Integration tests for merge approval/rejection flow
- [ ] 7.1.11 Integration tests for merge conflict blocking

### 7.2 Blocked State Context
- [ ] 7.2.1 Capture iteration summaries in blocked context
- [ ] 7.2.2 Capture last test output in blocked context
- [ ] 7.2.3 Capture last review findings in blocked context
- [ ] 7.2.4 Include worktree path in blocked response
- [ ] 7.2.5 Include suggested actions in blocked response

### 7.3 API Response Updates
- [ ] 7.3.1 Add `workflow_id` to task responses when actively processing
- [ ] 7.3.2 Add `workflow_id` and `step_name` to agent responses
- [ ] 7.3.3 Deprecate `POST /tasks/:id/start` for workflow beads

## Phase 8: E2E Tests

### 8.1 Workflow E2E Tests
- [ ] 8.1.1 E2E: bead pickup → grimoire runs → merge pending → approve → bead closed
- [ ] 8.1.2 E2E: grimoire blocks → bead blocked → user retry
- [ ] 8.1.3 E2E: concurrent beads respect limit
- [ ] 8.1.4 E2E: custom grimoire via label
- [ ] 8.1.5 E2E: workflow log file created with expected structure
- [ ] 8.1.6 E2E: daemon restart resumes workflow
- [ ] 8.1.7 E2E: workflow cancel terminates agent and cleans up worktree
- [ ] 8.1.8 E2E: merge pending → reject → workflow blocked
- [ ] 8.1.9 E2E: merge conflict → workflow blocked with conflict details (files, markers)
- [ ] 8.1.10 E2E: step timeout triggers → step marked failed
- [ ] 8.1.11 E2E: workflow timeout → workflow blocked
- [ ] 8.1.12 E2E: worktree created → workflow runs → merge → worktree cleaned up

## Phase 9: Documentation

### 9.1 Documentation
- [ ] 9.1.1 Document grimoire YAML schema (including merge step)
- [ ] 9.1.2 Document step types and options (agent, script, loop, merge)
- [ ] 9.1.3 Document spell template syntax (`{{.variable}}`)
- [ ] 9.1.4 Document system prompt and output contract
- [ ] 9.1.5 Document spell partials with variable passing
- [ ] 9.1.6 Document grimoire selection (labels, config)
- [ ] 9.1.7 Document workflow logging format and location
- [ ] 9.1.8 Document workflow REST API endpoints (including merge approval/rejection)
- [ ] 9.1.9 Document blocked state handling and retry workflow
- [ ] 9.1.10 Document timeout configuration (step-level, workflow-level)
- [ ] 9.1.11 Document shell variable escaping and `{{raw}}` usage
- [ ] 9.1.12 Document variable type rendering (arrays/objects as JSON)
- [ ] 9.1.13 Document strict boolean condition evaluation
- [ ] 9.1.14 Document worktree lifecycle (creation, merge, cleanup)
- [ ] 9.1.15 Document merge conflict handling (always blocks for manual resolution)
- [ ] 9.1.16 Document dry-run mode (`coven grimoire preview`)
- [ ] 9.1.17 Add example custom grimoire
- [ ] 9.1.18 Add example custom spell with partials
- [ ] 9.1.19 Add example grimoire with merge step
