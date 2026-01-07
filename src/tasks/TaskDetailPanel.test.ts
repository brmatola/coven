import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { TaskDetailPanel } from './TaskDetailPanel';
import { BeadsTaskSource } from './BeadsTaskSource';

// Mock vscode module
vi.mock('vscode', () => {
  return {
    window: {
      createWebviewPanel: vi.fn(),
      showErrorMessage: vi.fn(),
      showWarningMessage: vi.fn().mockResolvedValue(undefined),
      showInformationMessage: vi.fn(),
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

describe('TaskDetailPanel', () => {
  let mockBeadsTaskSource: Partial<BeadsTaskSource>;
  let extensionUri: vscode.Uri;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup mock BeadsTaskSource
    mockBeadsTaskSource = {
      getTask: vi.fn().mockReturnValue(undefined),
      updateTask: vi.fn().mockResolvedValue(true),
      updateTaskStatus: vi.fn().mockResolvedValue({}),
      closeTask: vi.fn().mockResolvedValue(true),
      on: vi.fn().mockReturnThis(),
      off: vi.fn().mockReturnThis(),
    };

    // Setup extension URI
    extensionUri = {
      fsPath: '/test/extension',
      toString: () => '/test/extension',
    } as vscode.Uri;
  });

  describe('createOrShow', () => {
    it('should show error when task not found', async () => {
      // Task doesn't exist
      vi.mocked(mockBeadsTaskSource.getTask!).mockReturnValue(undefined);

      const result = await TaskDetailPanel.createOrShow(
        extensionUri,
        mockBeadsTaskSource as BeadsTaskSource,
        'nonexistent-task'
      );

      expect(result).toBeNull();
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Task not found: nonexistent-task'
      );
    });

    it('should return null and show error for missing task', async () => {
      vi.mocked(mockBeadsTaskSource.getTask!).mockReturnValue(undefined);

      const result = await TaskDetailPanel.createOrShow(
        extensionUri,
        mockBeadsTaskSource as BeadsTaskSource,
        'missing-task-123'
      );

      expect(result).toBeNull();
      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('should return undefined for non-existent panel', () => {
      const result = TaskDetailPanel.get('nonexistent-panel-id');
      expect(result).toBeUndefined();
    });

    it('should return undefined for different task ID', () => {
      const result = TaskDetailPanel.get('different-task');
      expect(result).toBeUndefined();
    });
  });
});
