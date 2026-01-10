// Agent types
export * from './types';

// Prompts
export {
  generateTaskPrompt,
  generateSimpleTaskPrompt,
  generateConflictResolutionPrompt,
  generateAutoAcceptPrompt,
} from './prompts';
export type { TaskPromptOptions, CodebaseContext } from './prompts';

// Output channel management
export { FamiliarOutputChannel } from './FamiliarOutputChannel';

// Question handling
export { QuestionHandler } from './QuestionHandler';
