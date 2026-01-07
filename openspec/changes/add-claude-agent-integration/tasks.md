# Tasks: Add Claude Agent Integration

## Implementation
Epic: `coven-34a` (add-claude-agent-integration)
Track progress: `bd epic status coven-34a`
List tasks: `bd list --parent coven-34a`

## 1. AgentProvider Interface
- [ ] 1.1 Define `AgentProvider` interface with spawn, terminate operations
- [ ] 1.2 Define `AgentSpawnConfig` interface (task, workingDirectory, callbacks)
- [ ] 1.3 Define `AgentHandle` interface for controlling spawned agent
- [ ] 1.4 Define `AgentOutput` type for structured output events
- [ ] 1.5 Define `AgentQuestion` interface (id, type, question, suggestedResponses)
- [ ] 1.6 Define `AgentResult` interface (success, summary, filesChanged)

## 2. ClaudeAgent Implementation
- [ ] 2.1 Implement Claude Code CLI process spawning with PTY
- [ ] 2.2 Implement output stream parsing (detect questions, progress, completion)
- [ ] 2.3 Implement stdin injection for responding to questions
- [ ] 2.4 Implement graceful termination (SIGTERM, then SIGKILL)
- [ ] 2.5 Implement timeout handling for hung agents
- [ ] 2.6 Implement agent status tracking from output
- [ ] 2.7 Write integration tests for ClaudeAgent

## 3. Prompt Templates
- [ ] 3.1 Create base task prompt template
- [ ] 3.2 Include task title, description, acceptance criteria in prompt
- [ ] 3.3 Include relevant codebase context (file structure, conventions)
- [ ] 3.4 Include instructions for signaling completion
- [ ] 3.5 Create conflict resolution prompt template

## 4. Question Detection
- [ ] 4.1 Implement question detection from Claude Code output
- [ ] 4.2 Parse suggested responses when provided
- [ ] 4.3 Categorize question types (clarification, permission, decision, blocked)
- [ ] 4.4 Emit question events with structured data

## 5. Integration
- [ ] 5.1 Wire ClaudeAgent into FamiliarManager
- [ ] 5.2 Implement agent availability check (is `claude` command present)
- [ ] 5.3 Add configuration for Claude model selection
- [ ] 5.4 Add configuration for allowed tools/permissions

## 6. E2E Tests
- [ ] 6.1 Test: Agent spawns and produces output
- [ ] 6.2 Test: Agent output streams to output channel
- [ ] 6.3 Test: Agent termination works cleanly
- [ ] 6.4 Test: Question detection triggers notification
