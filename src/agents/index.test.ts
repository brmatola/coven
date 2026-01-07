import { describe, it, expect } from 'vitest';

describe('agents module exports', () => {
  it('should export all agent types and classes', async () => {
    const agentsModule = await import('./index');

    // Core classes
    expect(agentsModule.ClaudeAgent).toBeDefined();
    expect(agentsModule.AgentOrchestrator).toBeDefined();
    expect(agentsModule.FamiliarManager).toBeDefined();

    // Prompt functions
    expect(agentsModule.generateTaskPrompt).toBeDefined();
    expect(agentsModule.generateSimpleTaskPrompt).toBeDefined();
    expect(agentsModule.generateConflictResolutionPrompt).toBeDefined();
    expect(agentsModule.generateAutoAcceptPrompt).toBeDefined();
  });

  it('should export types that work correctly', async () => {
    const { ClaudeAgent, AgentOrchestrator, FamiliarManager } = await import('./index');

    // Verify classes are constructable (types)
    expect(typeof ClaudeAgent).toBe('function');
    expect(typeof AgentOrchestrator).toBe('function');
    expect(typeof FamiliarManager).toBe('function');
  });
});
