import { describe, it, expect } from 'vitest';

describe('git module exports', () => {
  it('should export all git types', async () => {
    const gitModule = await import('./index');

    // Types
    expect(gitModule.GitCLI).toBeDefined();
    expect(gitModule.GitCLIError).toBeDefined();
    expect(gitModule.WorktreeManager).toBeDefined();
    expect(gitModule.ConflictResolver).toBeDefined();
  });

  it('should export classes that can be instantiated', async () => {
    const { GitCLI, WorktreeManager, ConflictResolver } = await import('./index');

    expect(typeof GitCLI).toBe('function');
    expect(typeof WorktreeManager).toBe('function');
    expect(typeof ConflictResolver).toBe('function');
  });
});
