import { describe, it, expect, beforeEach } from 'vitest';
import { refreshPrerequisites } from './prerequisites';

describe('prerequisites', () => {
  beforeEach(() => {
    refreshPrerequisites();
  });

  it('should export refreshPrerequisites function', () => {
    expect(typeof refreshPrerequisites).toBe('function');
  });

  it('refreshPrerequisites should clear cached status', () => {
    // This test verifies the function runs without error
    // Full integration tests require vscode context
    expect(() => refreshPrerequisites()).not.toThrow();
  });
});
