import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReviewManager } from './ReviewManager';
import { WorktreeManager } from '../git/WorktreeManager';
import { BeadsTaskSource } from '../tasks/BeadsTaskSource';
import { FamiliarManager } from '../agents/FamiliarManager';
import { SessionConfig, DEFAULT_SESSION_CONFIG } from '../shared/types';
import { Worktree, MergeResult } from '../git/types';

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

// Mock util.promisify to return our mock exec
vi.mock('util', async (importOriginal) => {
  const original = await importOriginal<typeof import('util')>();
  return {
    ...original,
    promisify: vi.fn(() => vi.fn()),
  };
});

// Mock GitCLI
vi.mock('../git/GitCLI', () => ({
  GitCLI: vi.fn().mockImplementation(() => ({
    getDiff: vi.fn().mockResolvedValue({
      added: [],
      modified: [],
      deleted: [],
      renamed: [],
    }),
  })),
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

function createMockWorktree(taskId: string): Worktree {
  return {
    path: `/worktrees/${taskId}`,
    branch: `task/${taskId}`,
    head: 'abc123',
    isMain: false,
  };
}

function createMockConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    ...DEFAULT_SESSION_CONFIG,
    ...overrides,
  };
}

describe('ReviewManager', () => {
  let reviewManager: ReviewManager;
  let mockWorktreeManager: WorktreeManager;
  let mockBeadsTaskSource: BeadsTaskSource;
  let mockFamiliarManager: FamiliarManager;
  let mockGetConfig: () => SessionConfig;
  let config: SessionConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    config = createMockConfig();
    mockGetConfig = vi.fn(() => config);

    mockWorktreeManager = {
      getWorktree: vi.fn(),
      mergeToFeature: vi.fn(),
      cleanupForTask: vi.fn(),
    } as unknown as WorktreeManager;

    mockBeadsTaskSource = {
      updateTaskStatus: vi.fn(),
    } as unknown as BeadsTaskSource;

    mockFamiliarManager = {
      getFamiliar: vi.fn(),
    } as unknown as FamiliarManager;

    reviewManager = new ReviewManager(
      '/workspace',
      mockWorktreeManager,
      mockBeadsTaskSource,
      mockFamiliarManager,
      mockGetConfig
    );
  });

  afterEach(() => {
    reviewManager.dispose();
  });

  describe('constructor', () => {
    it('creates a ReviewManager instance', () => {
      expect(reviewManager).toBeInstanceOf(ReviewManager);
    });
  });

  describe('startReview', () => {
    it('starts a new review for a task', async () => {
      vi.mocked(mockWorktreeManager.getWorktree).mockReturnValue(undefined);

      const startedHandler = vi.fn();
      reviewManager.on('review:started', startedHandler);

      const review = await reviewManager.startReview('task-1');

      expect(review).toMatchObject({
        taskId: 'task-1',
        status: 'pending',
        changedFiles: [],
        checkResults: [],
      });
      expect(review.startedAt).toBeGreaterThan(0);
      expect(startedHandler).toHaveBeenCalledWith({ taskId: 'task-1' });
    });

    it('returns existing review if already started', async () => {
      vi.mocked(mockWorktreeManager.getWorktree).mockReturnValue(undefined);

      const review1 = await reviewManager.startReview('task-1');
      const review2 = await reviewManager.startReview('task-1');

      expect(review1).toBe(review2);
    });
  });

  describe('getChangedFiles', () => {
    it('returns empty array when no worktree exists', async () => {
      vi.mocked(mockWorktreeManager.getWorktree).mockReturnValue(undefined);

      const files = await reviewManager.getChangedFiles('task-1');

      expect(files).toEqual([]);
    });
  });

  describe('getReview', () => {
    it('returns undefined for non-existent review', () => {
      const review = reviewManager.getReview('non-existent');

      expect(review).toBeUndefined();
    });

    it('returns the review for an active task', async () => {
      vi.mocked(mockWorktreeManager.getWorktree).mockReturnValue(undefined);
      await reviewManager.startReview('task-1');

      const review = reviewManager.getReview('task-1');

      expect(review).toBeDefined();
      expect(review?.taskId).toBe('task-1');
    });
  });

  describe('hasReview', () => {
    it('returns false for non-existent review', () => {
      expect(reviewManager.hasReview('non-existent')).toBe(false);
    });

    it('returns true for active review', async () => {
      vi.mocked(mockWorktreeManager.getWorktree).mockReturnValue(undefined);
      await reviewManager.startReview('task-1');

      expect(reviewManager.hasReview('task-1')).toBe(true);
    });
  });

  describe('getAllReviews', () => {
    it('returns empty array when no reviews exist', () => {
      expect(reviewManager.getAllReviews()).toEqual([]);
    });

    it('returns all active reviews', async () => {
      vi.mocked(mockWorktreeManager.getWorktree).mockReturnValue(undefined);
      await reviewManager.startReview('task-1');
      await reviewManager.startReview('task-2');

      const reviews = reviewManager.getAllReviews();

      expect(reviews).toHaveLength(2);
      expect(reviews.map((r) => r.taskId)).toContain('task-1');
      expect(reviews.map((r) => r.taskId)).toContain('task-2');
    });
  });

  describe('runPreMergeChecks', () => {
    it('throws if no active review exists', async () => {
      await expect(reviewManager.runPreMergeChecks('non-existent')).rejects.toThrow(
        'No active review for task: non-existent'
      );
    });

    it('returns empty array if checks are disabled', async () => {
      vi.mocked(mockWorktreeManager.getWorktree).mockReturnValue(undefined);
      config = createMockConfig({ preMergeChecks: { enabled: false, commands: [] } });

      await reviewManager.startReview('task-1');
      const results = await reviewManager.runPreMergeChecks('task-1');

      expect(results).toEqual([]);
    });

    it('throws if no worktree exists when checks enabled', async () => {
      vi.mocked(mockWorktreeManager.getWorktree).mockReturnValue(undefined);
      config = createMockConfig({
        preMergeChecks: { enabled: true, commands: ['npm test'] },
      });

      await reviewManager.startReview('task-1');

      await expect(reviewManager.runPreMergeChecks('task-1')).rejects.toThrow(
        'No worktree found for task: task-1'
      );
    });
  });

  describe('approve', () => {
    it('throws if no active review exists', async () => {
      await expect(reviewManager.approve('non-existent')).rejects.toThrow(
        'No active review for task: non-existent'
      );
    });

    it('successfully approves and merges a task', async () => {
      const worktree = createMockWorktree('task-1');
      vi.mocked(mockWorktreeManager.getWorktree).mockReturnValue(worktree);

      const mergeResult: MergeResult = {
        success: true,
        conflicts: [],
        mergedCommit: 'def456',
      };
      vi.mocked(mockWorktreeManager.mergeToFeature).mockResolvedValue(mergeResult);
      vi.mocked(mockBeadsTaskSource.updateTaskStatus).mockResolvedValue();

      await reviewManager.startReview('task-1');

      const approvedHandler = vi.fn();
      reviewManager.on('review:approved', approvedHandler);

      await reviewManager.approve('task-1', 'Great work!');

      expect(mockWorktreeManager.mergeToFeature).toHaveBeenCalled();
      expect(mockBeadsTaskSource.updateTaskStatus).toHaveBeenCalledWith('task-1', 'done');
      expect(approvedHandler).toHaveBeenCalledWith({ taskId: 'task-1', feedback: 'Great work!' });
      expect(reviewManager.hasReview('task-1')).toBe(false);
    });

    it('throws on merge conflicts', async () => {
      const worktree = createMockWorktree('task-1');
      vi.mocked(mockWorktreeManager.getWorktree).mockReturnValue(worktree);

      const mergeResult: MergeResult = {
        success: false,
        conflicts: [{ path: 'file.ts', type: 'content' }],
      };
      vi.mocked(mockWorktreeManager.mergeToFeature).mockResolvedValue(mergeResult);

      await reviewManager.startReview('task-1');

      const errorHandler = vi.fn();
      reviewManager.on('error', errorHandler);

      await expect(reviewManager.approve('task-1')).rejects.toThrow('Merge failed with conflicts');
      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('revert', () => {
    it('throws if no active review exists', async () => {
      await expect(reviewManager.revert('non-existent')).rejects.toThrow(
        'No active review for task: non-existent'
      );
    });

    it('successfully reverts a task', async () => {
      vi.mocked(mockWorktreeManager.getWorktree).mockReturnValue(undefined);
      vi.mocked(mockWorktreeManager.cleanupForTask).mockResolvedValue();
      vi.mocked(mockBeadsTaskSource.updateTaskStatus).mockResolvedValue();

      await reviewManager.startReview('task-1');

      const revertedHandler = vi.fn();
      reviewManager.on('review:reverted', revertedHandler);

      await reviewManager.revert('task-1', 'Needs more work');

      expect(mockWorktreeManager.cleanupForTask).toHaveBeenCalledWith('task-1');
      expect(mockBeadsTaskSource.updateTaskStatus).toHaveBeenCalledWith('task-1', 'ready');
      expect(revertedHandler).toHaveBeenCalledWith({ taskId: 'task-1', reason: 'Needs more work' });
      expect(reviewManager.hasReview('task-1')).toBe(false);
    });

    it('emits error event on failure', async () => {
      vi.mocked(mockWorktreeManager.getWorktree).mockReturnValue(undefined);
      vi.mocked(mockWorktreeManager.cleanupForTask).mockRejectedValue(new Error('Cleanup failed'));

      await reviewManager.startReview('task-1');

      const errorHandler = vi.fn();
      reviewManager.on('error', errorHandler);

      await expect(reviewManager.revert('task-1')).rejects.toThrow('Cleanup failed');
      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('getPreMergeChecksConfig', () => {
    it('returns pre-merge checks config from session config', () => {
      config = createMockConfig({
        preMergeChecks: { enabled: true, commands: ['npm test', 'npm run lint'] },
      });

      const result = reviewManager.getPreMergeChecksConfig();

      expect(result).toEqual({
        enabled: true,
        commands: ['npm test', 'npm run lint'],
      });
    });
  });

  describe('dispose', () => {
    it('clears active reviews and removes listeners', async () => {
      vi.mocked(mockWorktreeManager.getWorktree).mockReturnValue(undefined);
      await reviewManager.startReview('task-1');

      const handler = vi.fn();
      reviewManager.on('review:started', handler);

      reviewManager.dispose();

      expect(reviewManager.getAllReviews()).toEqual([]);
      expect(reviewManager.listenerCount('review:started')).toBe(0);
    });
  });
});
