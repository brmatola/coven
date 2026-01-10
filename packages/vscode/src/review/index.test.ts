import { describe, it, expect, vi } from 'vitest';

// Mock vscode to prevent module resolution issues
vi.mock('vscode', () => ({
  window: {
    createWebviewPanel: vi.fn(),
  },
  Uri: {
    joinPath: vi.fn(),
  },
  ViewColumn: {
    One: 1,
  },
}));

// Mock logger
vi.mock('../shared/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Review Module Index', () => {
  it('exports ReviewManager', async () => {
    const module = await import('./index');
    expect(module.ReviewManager).toBeDefined();
  });

  it('exports ReviewPanel', async () => {
    const module = await import('./index');
    expect(module.ReviewPanel).toBeDefined();
  });

  it('exports type guards', async () => {
    const { isReviewMessage } = await import('./types');
    expect(isReviewMessage).toBeDefined();
    expect(typeof isReviewMessage).toBe('function');
  });

  it('isReviewMessage returns true for valid messages', async () => {
    const { isReviewMessage } = await import('./types');
    expect(isReviewMessage({ type: 'ready' })).toBe(true);
    expect(isReviewMessage({ type: 'viewDiff' })).toBe(true);
    expect(isReviewMessage({ type: 'approve' })).toBe(true);
    expect(isReviewMessage({ type: 'reject' })).toBe(true);
    expect(isReviewMessage({ type: 'runChecks' })).toBe(true);
    expect(isReviewMessage({ type: 'refresh' })).toBe(true);
    expect(isReviewMessage({ type: 'viewAllChanges' })).toBe(true);
    expect(isReviewMessage({ type: 'overrideChecks' })).toBe(true);
  });

  it('isReviewMessage returns false for invalid messages', async () => {
    const { isReviewMessage } = await import('./types');
    expect(isReviewMessage({ type: 'unknown' })).toBe(false);
    expect(isReviewMessage({ type: 'other' })).toBe(false);
  });
});
