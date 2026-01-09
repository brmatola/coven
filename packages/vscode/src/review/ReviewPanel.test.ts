import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { ReviewPanel } from './ReviewPanel';
import { ReviewManager, ReviewInfo } from './ReviewManager';
import { WorktreeManager } from '../git/WorktreeManager';
import { BeadsTaskSource } from '../tasks/BeadsTaskSource';
import { FamiliarManager } from '../agents/FamiliarManager';
import { Task, TaskStatus } from '../shared/types';

// Store message handler for testing
let messageHandler: ((msg: unknown) => void) | null = null;
let disposeHandler: (() => void) | null = null;

// Mock webview
const mockWebview = {
  html: '',
  postMessage: vi.fn().mockResolvedValue(true),
  onDidReceiveMessage: vi.fn((handler) => {
    messageHandler = handler;
    return { dispose: vi.fn() };
  }),
  asWebviewUri: vi.fn((uri) => uri),
  cspSource: 'https://test',
};

// Mock panel
const mockPanel = {
  webview: mockWebview,
  title: '',
  onDidDispose: vi.fn((handler) => {
    disposeHandler = handler;
    return { dispose: vi.fn() };
  }),
  reveal: vi.fn(),
  dispose: vi.fn(),
};

// Mock vscode module
vi.mock('vscode', () => {
  return {
    window: {
      createWebviewPanel: vi.fn(() => mockPanel),
      showErrorMessage: vi.fn(),
      showWarningMessage: vi.fn().mockResolvedValue(undefined),
      showInformationMessage: vi.fn(),
      activeTextEditor: { viewColumn: 1 },
    },
    Uri: {
      joinPath: vi.fn((uri, ...segments) => ({
        fsPath: `${uri?.fsPath ?? '/ext'}/${segments.join('/')}`,
        toString: () => `${uri?.fsPath ?? '/ext'}/${segments.join('/')}`,
      })),
    },
    ViewColumn: {
      One: 1,
      Two: 2,
      Active: -1,
    },
  };
});

// Mock logger
vi.mock('../shared/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test Task',
    description: 'Test description',
    status: 'review' as TaskStatus,
    priority: 'medium',
    dependencies: [],
    sourceId: 'test',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createMockReview(taskId: string): ReviewInfo {
  return {
    taskId,
    status: 'pending',
    changedFiles: [
      { path: 'file1.ts', linesAdded: 10, linesDeleted: 5, changeType: 'modified' },
      { path: 'file2.ts', linesAdded: 20, linesDeleted: 0, changeType: 'added' },
    ],
    checkResults: [],
    startedAt: Date.now(),
  };
}

describe('ReviewPanel', () => {
  let mockExtensionUri: vscode.Uri;
  let mockReviewManager: ReviewManager;
  let mockWorktreeManager: WorktreeManager;
  let mockBeadsTaskSource: BeadsTaskSource;
  let mockFamiliarManager: FamiliarManager;

  beforeEach(() => {
    vi.clearAllMocks();
    messageHandler = null;
    disposeHandler = null;

    // Close any existing panels
    ReviewPanel.closeAll();

    mockExtensionUri = { fsPath: '/ext' } as unknown as vscode.Uri;

    mockReviewManager = {
      startReview: vi.fn().mockResolvedValue(createMockReview('task-1')),
      getReview: vi.fn().mockReturnValue(createMockReview('task-1')),
      getPreMergeChecksConfig: vi.fn().mockReturnValue({ enabled: false, commands: [] }),
      runPreMergeChecks: vi.fn().mockResolvedValue([]),
      approve: vi.fn().mockResolvedValue(undefined),
      revert: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as ReviewManager;

    mockWorktreeManager = {
      getWorktree: vi.fn().mockReturnValue({
        path: '/worktrees/task-1',
        branch: 'task/task-1',
        head: 'abc123',
        isMain: false,
      }),
    } as unknown as WorktreeManager;

    mockBeadsTaskSource = {
      getTask: vi.fn().mockReturnValue(createMockTask()),
    } as unknown as BeadsTaskSource;

    mockFamiliarManager = {
      getFamiliar: vi.fn().mockReturnValue(null),
    } as unknown as FamiliarManager;
  });

  afterEach(() => {
    ReviewPanel.closeAll();
  });

  describe('createOrShow', () => {
    it('creates a new panel for a task in review status', async () => {
      const panel = await ReviewPanel.createOrShow(
        mockExtensionUri,
        mockReviewManager,
        mockWorktreeManager,
        mockBeadsTaskSource,
        mockFamiliarManager,
        'task-1'
      );

      expect(panel).toBeDefined();
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'covenReview',
        expect.stringContaining('Review:'),
        1,
        expect.any(Object)
      );
      expect(mockReviewManager.startReview).toHaveBeenCalledWith('task-1');
    });

    it('returns null if task not found', async () => {
      vi.mocked(mockBeadsTaskSource.getTask).mockReturnValue(undefined);

      const panel = await ReviewPanel.createOrShow(
        mockExtensionUri,
        mockReviewManager,
        mockWorktreeManager,
        mockBeadsTaskSource,
        mockFamiliarManager,
        'non-existent'
      );

      expect(panel).toBeNull();
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Task not found: non-existent'
      );
    });

    it('returns null if task is not in review status', async () => {
      vi.mocked(mockBeadsTaskSource.getTask).mockReturnValue(
        createMockTask({ status: 'working' })
      );

      const panel = await ReviewPanel.createOrShow(
        mockExtensionUri,
        mockReviewManager,
        mockWorktreeManager,
        mockBeadsTaskSource,
        mockFamiliarManager,
        'task-1'
      );

      expect(panel).toBeNull();
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('not ready for review')
      );
    });

    it('reveals existing panel for same task', async () => {
      const panel1 = await ReviewPanel.createOrShow(
        mockExtensionUri,
        mockReviewManager,
        mockWorktreeManager,
        mockBeadsTaskSource,
        mockFamiliarManager,
        'task-1'
      );

      // Reset mocks
      vi.mocked(vscode.window.createWebviewPanel).mockClear();

      const panel2 = await ReviewPanel.createOrShow(
        mockExtensionUri,
        mockReviewManager,
        mockWorktreeManager,
        mockBeadsTaskSource,
        mockFamiliarManager,
        'task-1'
      );

      expect(panel1).toBe(panel2);
      expect(mockPanel.reveal).toHaveBeenCalled();
      expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('returns undefined for non-existent panel', () => {
      expect(ReviewPanel.get('non-existent')).toBeUndefined();
    });

    it('returns existing panel', async () => {
      const panel = await ReviewPanel.createOrShow(
        mockExtensionUri,
        mockReviewManager,
        mockWorktreeManager,
        mockBeadsTaskSource,
        mockFamiliarManager,
        'task-1'
      );

      expect(ReviewPanel.get('task-1')).toBe(panel);
    });
  });

  describe('closeAll', () => {
    it('closes all open panels', async () => {
      await ReviewPanel.createOrShow(
        mockExtensionUri,
        mockReviewManager,
        mockWorktreeManager,
        mockBeadsTaskSource,
        mockFamiliarManager,
        'task-1'
      );

      vi.mocked(mockBeadsTaskSource.getTask).mockReturnValue(
        createMockTask({ id: 'task-2' })
      );

      await ReviewPanel.createOrShow(
        mockExtensionUri,
        mockReviewManager,
        mockWorktreeManager,
        mockBeadsTaskSource,
        mockFamiliarManager,
        'task-2'
      );

      ReviewPanel.closeAll();

      expect(ReviewPanel.get('task-1')).toBeUndefined();
      expect(ReviewPanel.get('task-2')).toBeUndefined();
    });
  });

  describe('message handling', () => {
    it('handles refresh message', async () => {
      await ReviewPanel.createOrShow(
        mockExtensionUri,
        mockReviewManager,
        mockWorktreeManager,
        mockBeadsTaskSource,
        mockFamiliarManager,
        'task-1'
      );

      expect(messageHandler).toBeDefined();
      messageHandler!({ type: 'refresh' });

      // Should update state via postMessage
      expect(mockWebview.postMessage).toHaveBeenCalled();
    });

    it('handles viewDiff message', async () => {
      await ReviewPanel.createOrShow(
        mockExtensionUri,
        mockReviewManager,
        mockWorktreeManager,
        mockBeadsTaskSource,
        mockFamiliarManager,
        'task-1'
      );

      expect(messageHandler).toBeDefined();
      messageHandler!({ type: 'viewDiff', payload: { filePath: 'file1.ts' } });

      // viewDiff triggers vscode.commands.executeCommand which is mocked
    });

    it('handles approve message', async () => {
      await ReviewPanel.createOrShow(
        mockExtensionUri,
        mockReviewManager,
        mockWorktreeManager,
        mockBeadsTaskSource,
        mockFamiliarManager,
        'task-1'
      );

      expect(messageHandler).toBeDefined();
      messageHandler!({ type: 'approve', payload: { feedback: 'LGTM' } });

      // approve is async, give it time to execute
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockReviewManager.approve).toHaveBeenCalledWith('task-1', 'LGTM');
    });

    it('handles revert message', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Revert' as unknown as undefined);

      await ReviewPanel.createOrShow(
        mockExtensionUri,
        mockReviewManager,
        mockWorktreeManager,
        mockBeadsTaskSource,
        mockFamiliarManager,
        'task-1'
      );

      expect(messageHandler).toBeDefined();
      messageHandler!({ type: 'revert', payload: { reason: 'Needs work' } });

      // revert is async, give it time to execute
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockReviewManager.revert).toHaveBeenCalledWith('task-1', 'Needs work');
    });
  });

  describe('dispose', () => {
    it('removes panel from static map on dispose', async () => {
      const panel = await ReviewPanel.createOrShow(
        mockExtensionUri,
        mockReviewManager,
        mockWorktreeManager,
        mockBeadsTaskSource,
        mockFamiliarManager,
        'task-1'
      );

      expect(ReviewPanel.get('task-1')).toBe(panel);

      // Trigger dispose
      disposeHandler!();

      expect(ReviewPanel.get('task-1')).toBeUndefined();
    });
  });
});
