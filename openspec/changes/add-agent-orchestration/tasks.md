# Tasks: Workflow-Based Agent Orchestration

## Phase 1: Workflow Engine Core

### 1.1 Core Types
- [ ] 1.1.1 Define `Grimoire` struct in `packages/daemon/internal/types/grimoire.go`
- [ ] 1.1.2 Define `Step` struct with all step type fields
- [ ] 1.1.3 Define `StepType` enum (agent, agent-loop, parallel-agents, script, gate)
- [ ] 1.1.4 Define `WorkflowContext` for state tracking
- [ ] 1.1.5 Define `WorkflowStatus` enum (pending, running, blocked, completed, failed)

### 1.2 Workflow Engine
- [ ] 1.2.1 Create `packages/daemon/internal/workflow/` package
- [ ] 1.2.2 Implement `Engine` struct with Start, Stop, Status methods
- [ ] 1.2.3 Implement step execution loop (sequential)
- [ ] 1.2.4 Implement variable resolution (`${variable}` syntax)
- [ ] 1.2.5 Implement step output capture and storage
- [ ] 1.2.6 Unit tests for engine

### 1.3 Basic Step Executors
- [ ] 1.3.1 Define `StepExecutor` interface
- [ ] 1.3.2 Implement `AgentStepExecutor` (single agent invocation)
- [ ] 1.3.3 Implement `ScriptStepExecutor` (shell command execution)
- [ ] 1.3.4 Unit tests for step executors

### 1.4 Integration with Daemon
- [ ] 1.4.1 Add workflow engine to daemon initialization
- [ ] 1.4.2 Add API endpoints: POST /workflows, GET /workflows/:id, DELETE /workflows/:id
- [ ] 1.4.3 Add workflow events to SSE stream
- [ ] 1.4.4 Integration tests for workflow API

## Phase 2: Grimoire Loading

### 2.1 YAML Parser
- [ ] 2.1.1 Create `packages/daemon/internal/grimoire/` package
- [ ] 2.1.2 Implement YAML parser for grimoire files
- [ ] 2.1.3 Implement schema validation (required fields, valid step types)
- [ ] 2.1.4 Implement variable syntax validation
- [ ] 2.1.5 Unit tests for parser

### 2.2 Grimoire Loader
- [ ] 2.2.1 Implement loader to scan `.coven/grimoires/` directory
- [ ] 2.2.2 Embed built-in grimoires as Go embed files
- [ ] 2.2.3 Implement merging (user grimoires override built-in)
- [ ] 2.2.4 Implement hot-reload on file changes (optional)
- [ ] 2.2.5 Unit tests for loader

### 2.3 Prompt Templates
- [ ] 2.3.1 Create `packages/daemon/internal/prompts/` for embedded prompts
- [ ] 2.3.2 Implement prompt template loading
- [ ] 2.3.3 Implement Go template rendering for prompts
- [ ] 2.3.4 Unit tests for prompt rendering

## Phase 3: Advanced Step Types

### 3.1 Parallel Agents
- [ ] 3.1.1 Implement `ParallelAgentsExecutor`
- [ ] 3.1.2 Support `for_each` iteration over array variables
- [ ] 3.1.3 Support `max_concurrent` limit
- [ ] 3.1.4 Aggregate outputs from all parallel agents
- [ ] 3.1.5 Handle partial failures (some agents fail)
- [ ] 3.1.6 Unit tests for parallel execution

### 3.2 Agent Loop with Arbiter
- [ ] 3.2.1 Implement `AgentLoopExecutor`
- [ ] 3.2.2 Support `max_iterations` limit
- [ ] 3.2.3 Implement arbiter agent invocation after each iteration
- [ ] 3.2.4 Implement `exit_when` condition evaluation
- [ ] 3.2.5 Pass iteration history to subsequent iterations
- [ ] 3.2.6 Unit tests for agent loop

### 3.3 Gate Step
- [ ] 3.3.1 Implement `GateExecutor`
- [ ] 3.3.2 Support `on_fail` options: block, retry, escalate
- [ ] 3.3.3 Support retry with backoff
- [ ] 3.3.4 Capture gate output for error messages
- [ ] 3.3.5 Unit tests for gate execution

## Phase 4: Built-in Grimoires

### 4.1 Spec-to-Beads Grimoire
- [ ] 4.1.1 Write `spec-to-beads.yaml` grimoire definition
- [ ] 4.1.2 Write `spec-to-beads.md` prompt template
- [ ] 4.1.3 Define expected output format (list of bead IDs)
- [ ] 4.1.4 E2E test: openspec → beads created with AC and testing requirements

### 4.2 Implement-Bead Grimoire
- [ ] 4.2.1 Write `implement-bead.yaml` grimoire definition
- [ ] 4.2.2 Write `implement-bead.md` prompt template
- [ ] 4.2.3 Ensure bead context (AC, testing requirements) passed to agent
- [ ] 4.2.4 E2E test: bead → implementation in worktree

### 4.3 Review-Loop Grimoire
- [ ] 4.3.1 Write `review-loop.yaml` grimoire definition
- [ ] 4.3.2 Write `review-changes.md` prompt template
- [ ] 4.3.3 Write `is-actionable.md` arbiter prompt template
- [ ] 4.3.4 Define review output format (findings, verdict)
- [ ] 4.3.5 E2E test: changes → review loop → fixes applied → passes

### 4.4 Prepare-PR Grimoire
- [ ] 4.4.1 Write `prepare-pr.yaml` grimoire definition
- [ ] 4.4.2 Write `prepare-pr.md` prompt template
- [ ] 4.4.3 Include gh CLI usage for PR creation
- [ ] 4.4.4 Include final security/test review step
- [ ] 4.4.5 E2E test: branch → PR created with summary

### 4.5 Full Pipeline Grimoire
- [ ] 4.5.1 Write `implement-feature.yaml` combining all steps
- [ ] 4.5.2 Test variable passing through full pipeline
- [ ] 4.5.3 E2E test: openspec → beads → implement → review → PR

## Phase 5: Polish and Documentation

### 5.1 Error Handling
- [ ] 5.1.1 Implement workflow pause/resume on intervention needed
- [ ] 5.1.2 Implement clear error messages for each failure mode
- [ ] 5.1.3 Add workflow history/audit log
- [ ] 5.1.4 Unit tests for error scenarios

### 5.2 User Intervention
- [ ] 5.2.1 Define intervention request format
- [ ] 5.2.2 Emit intervention events via SSE
- [ ] 5.2.3 Add API endpoint to respond to intervention requests
- [ ] 5.2.4 E2E test: workflow blocks, user responds, workflow continues

### 5.3 Documentation
- [ ] 5.3.1 Document grimoire YAML schema
- [ ] 5.3.2 Document step types and their options
- [ ] 5.3.3 Document built-in grimoires and how to customize
- [ ] 5.3.4 Add example custom grimoires

### 5.4 Final Validation
- [ ] 5.4.1 Run full test suite (unit + E2E)
- [ ] 5.4.2 Manual testing of spec → PR flow
- [ ] 5.4.3 Performance testing (concurrent workflows)
- [ ] 5.4.4 Update README with workflow features
