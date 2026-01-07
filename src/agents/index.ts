// Agent types
export * from './types';

// Agent implementations
export { ClaudeAgent } from './ClaudeAgent';
export { AgentOrchestrator } from './AgentOrchestrator';
export type { SpawnOptions, AgentOrchestratorEvents } from './AgentOrchestrator';

// Prompts
export {
  generateTaskPrompt,
  generateSimpleTaskPrompt,
  generateConflictResolutionPrompt,
  generateAutoAcceptPrompt,
} from './prompts';
export type { TaskPromptOptions, CodebaseContext } from './prompts';

// FamiliarManager (existing)
export { FamiliarManager } from './FamiliarManager';
