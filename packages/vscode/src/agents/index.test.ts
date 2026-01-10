import { describe, it, expect } from 'vitest';

describe('agents module exports', () => {
  it('should export all agent types and classes', async () => {
    const agentsModule = await import('./index');

    // Output channel and question handler
    expect(agentsModule.FamiliarOutputChannel).toBeDefined();
    expect(agentsModule.QuestionHandler).toBeDefined();

    // Prompt functions
    expect(agentsModule.generateTaskPrompt).toBeDefined();
    expect(agentsModule.generateSimpleTaskPrompt).toBeDefined();
    expect(agentsModule.generateConflictResolutionPrompt).toBeDefined();
    expect(agentsModule.generateAutoAcceptPrompt).toBeDefined();
  });

  it('should export classes that are constructable', async () => {
    const { FamiliarOutputChannel, QuestionHandler } = await import('./index');

    // Verify classes are constructable (types)
    expect(typeof FamiliarOutputChannel).toBe('function');
    expect(typeof QuestionHandler).toBe('function');
  });
});
