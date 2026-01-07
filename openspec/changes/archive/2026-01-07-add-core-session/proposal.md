# Change: Add Core Session Management

## Why
The core orchestration layer is needed to coordinate task execution, agent lifecycle, and session state. This is the central nervous system of Coven - managing what work exists, what's being worked on, and coordinating the various subsystems.

## What Changes
- Implement `CovenSession` class as the main orchestrator
- Implement `TaskManager` for task state machine and persistence
- Implement `FamiliarManager` for agent lifecycle coordination
- Define core TypeScript interfaces and types
- Create event-driven communication between components

## Impact
- Affected specs: `session-management` (new), `task-management` (new)
- Affected code: `src/session/CovenSession.ts`, `src/tasks/TaskManager.ts`, `src/agents/FamiliarManager.ts`, `src/shared/types.ts`
- Dependencies: Requires `add-extension-scaffold` to be completed first
