# Change: Add Agent Interaction

## Why
Users need to see what agents are doing in real-time and respond to their questions. This includes output streaming, question handling UI, and the notification system that alerts users when attention is needed.

## What Changes
- Implement output channel for streaming agent output
- Implement question response modal/panel for answering agent questions
- Implement notification system for attention-needed events
- Implement activity log showing session events

## Impact
- Affected specs: `agent-communication` (new capability)
- Affected code: `src/agents/OutputChannel.ts`, `src/agents/QuestionPanel.ts`, `src/shared/notifications.ts`
- Dependencies: Requires `add-claude-agent-integration` for output streaming, `add-sidebar-views` for integration
