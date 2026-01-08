# Change: Add Claude Agent Integration

## Why
Claude Code CLI is the primary AI agent for executing tasks. This integration spawns Claude Code processes, streams their output, handles their questions, and manages their lifecycle within the Coven orchestration.

## What Changes
- Implement `AgentProvider` interface abstracting AI agent operations
- Implement `ClaudeAgent` provider wrapping Claude Code CLI
- Implement prompt templates for task instructions
- Implement output parsing for agent status and questions
- Implement response injection for answering agent questions

## Impact
- Affected specs: `agent-execution` (new capability)
- Affected code: `src/agents/AgentProvider.ts`, `src/agents/ClaudeAgent.ts`, `src/agents/prompts.ts`
- Dependencies: Requires `add-core-session` (FamiliarManager), `add-git-worktree-management` (worktree paths)
