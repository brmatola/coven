import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { NotificationService } from './notifications';
import { DEFAULT_SESSION_CONFIG, SessionConfig } from './types';

describe('NotificationService', () => {
  let service: NotificationService;
  let config: SessionConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    config = { ...DEFAULT_SESSION_CONFIG };
    service = new NotificationService(() => config);
  });

  describe('notifyQuestion', () => {
    it('should show modal notification when config is modal', async () => {
      config.notifications.questions = 'modal';
      const onRespond = vi.fn();

      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

      await service.notifyQuestion('task-1', 'Should I proceed?', onRespond);

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Agent needs response: Should I proceed?',
        { modal: true },
        'Respond',
        'View Output'
      );
    });

    it('should show toast notification when config is toast', async () => {
      config.notifications.questions = 'toast';
      const onRespond = vi.fn();

      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

      await service.notifyQuestion('task-1', 'Should I proceed?', onRespond);

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Agent needs response: Should I proceed?',
        'Respond',
        'View Output'
      );
    });

    it('should not show notification when config is none', async () => {
      config.notifications.questions = 'none';
      const onRespond = vi.fn();

      await service.notifyQuestion('task-1', 'Should I proceed?', onRespond);

      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('should truncate long questions', async () => {
      config.notifications.questions = 'toast';
      const longQuestion = 'a'.repeat(150);
      const onRespond = vi.fn();

      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

      await service.notifyQuestion('task-1', longQuestion, onRespond);

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('...'),
        'Respond',
        'View Output'
      );
    });

    it('should call onRespond when Respond is clicked', async () => {
      config.notifications.questions = 'toast';
      const onRespond = vi.fn();

      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Respond');

      await service.notifyQuestion('task-1', 'Should I proceed?', onRespond);

      expect(onRespond).toHaveBeenCalled();
    });
  });

  describe('notifyCompletion', () => {
    it('should show completion notification', async () => {
      config.notifications.completions = 'toast';
      const onReview = vi.fn();

      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

      await service.notifyCompletion('task-1', 'Fix the bug', onReview);

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Task completed: Fix the bug',
        'Review',
        'View Output'
      );
    });

    it('should call onReview when Review is clicked', async () => {
      config.notifications.completions = 'toast';
      const onReview = vi.fn();

      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Review');

      await service.notifyCompletion('task-1', 'Fix the bug', onReview);

      expect(onReview).toHaveBeenCalled();
    });
  });

  describe('notifyError', () => {
    it('should show error notification', async () => {
      config.notifications.errors = 'toast';

      vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined);

      await service.notifyError('task-1', 'Something went wrong');

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Agent error: Something went wrong',
        'View Output'
      );
    });

    it('should truncate long errors', async () => {
      config.notifications.errors = 'toast';
      const longError = 'x'.repeat(200);

      vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined);

      await service.notifyError('task-1', longError);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('...'),
        'View Output'
      );
    });
  });

  describe('notifyBlocked', () => {
    it('should show warning notification', async () => {
      config.notifications.errors = 'toast';

      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

      await service.notifyBlocked('task-1', 'Need permissions');

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        'Agent blocked: Need permissions',
        'Help'
      );
    });
  });

  describe('notifyConflictResolved', () => {
    it('should show conflict resolution notification', async () => {
      config.notifications.conflicts = 'toast';

      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

      await service.notifyConflictResolved('task-1', ['file1.ts', 'file2.ts']);

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Merge conflict resolved: 2 files',
        'View Changes'
      );
    });

    it('should use singular for single file', async () => {
      config.notifications.conflicts = 'toast';

      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

      await service.notifyConflictResolved('task-1', ['file1.ts']);

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Merge conflict resolved: 1 file',
        'View Changes'
      );
    });
  });

  describe('statusbar level', () => {
    it('should show status bar message for statusbar level', async () => {
      config.notifications.questions = 'statusbar';
      const onRespond = vi.fn();

      await service.notifyQuestion('task-1', 'Question?', onRespond);

      expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith(
        expect.stringContaining('Question?'),
        5000
      );
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });
  });
});
