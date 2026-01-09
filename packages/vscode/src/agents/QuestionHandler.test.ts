import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { QuestionHandler } from './QuestionHandler';
import { FamiliarManager } from './FamiliarManager';
import { AgentOrchestrator } from './AgentOrchestrator';
import { DEFAULT_SESSION_CONFIG, PendingQuestion } from '../shared/types';
import { WorktreeManager } from '../git/WorktreeManager';

describe('QuestionHandler', () => {
  let handler: QuestionHandler;
  let familiarManager: FamiliarManager;
  let orchestrator: AgentOrchestrator;
  let worktreeManager: WorktreeManager;

  beforeEach(() => {
    vi.clearAllMocks();

    familiarManager = new FamiliarManager('/test/workspace', DEFAULT_SESSION_CONFIG);
    worktreeManager = new WorktreeManager('/test/workspace', '.coven/worktrees', 'test-session');
    orchestrator = new AgentOrchestrator(familiarManager, worktreeManager, undefined, DEFAULT_SESSION_CONFIG);

    handler = new QuestionHandler(familiarManager, orchestrator);
  });

  describe('handleQuestionByTaskId', () => {
    it('should show warning when no pending question', async () => {
      const result = await handler.handleQuestionByTaskId('task-1');

      expect(result).toBe(false);
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        'No pending question for this task'
      );
    });
  });

  describe('handleQuestion', () => {
    const baseQuestion: PendingQuestion = {
      familiarId: 'task-1',
      taskId: 'task-1',
      question: 'Should I continue?',
      askedAt: Date.now(),
    };

    it('should show input box for question without options', async () => {
      vi.mocked(vscode.window.showInputBox).mockResolvedValue('Yes, continue');
      vi.spyOn(orchestrator, 'respondToQuestion').mockResolvedValue(undefined);

      const result = await handler.handleQuestion(baseQuestion);

      expect(vscode.window.showInputBox).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Should I continue?',
        })
      );
      expect(result).toBe(true);
    });

    it('should return false when user cancels input', async () => {
      vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);

      const result = await handler.handleQuestion(baseQuestion);

      expect(result).toBe(false);
    });

    it('should show quick pick for question with options', async () => {
      const questionWithOptions: PendingQuestion = {
        ...baseQuestion,
        options: ['Yes', 'No', 'Skip'],
      };

      vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: 'Yes', description: '' });
      vi.spyOn(orchestrator, 'respondToQuestion').mockResolvedValue(undefined);

      const result = await handler.handleQuestion(questionWithOptions);

      expect(vscode.window.showQuickPick).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should allow custom response from quick pick', async () => {
      const questionWithOptions: PendingQuestion = {
        ...baseQuestion,
        options: ['Yes', 'No'],
      };

      // First return custom option, then return input
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue({
        label: '$(edit) Custom response...',
        description: 'Type a custom response',
        alwaysShow: true,
      });
      vi.mocked(vscode.window.showInputBox).mockResolvedValue('Custom answer');
      vi.spyOn(orchestrator, 'respondToQuestion').mockResolvedValue(undefined);

      const result = await handler.handleQuestion(questionWithOptions);

      expect(vscode.window.showInputBox).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when user cancels quick pick', async () => {
      const questionWithOptions: PendingQuestion = {
        ...baseQuestion,
        options: ['Yes', 'No'],
      };

      vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

      const result = await handler.handleQuestion(questionWithOptions);

      expect(result).toBe(false);
    });

    it('should show error when response fails', async () => {
      vi.mocked(vscode.window.showInputBox).mockResolvedValue('Yes');
      vi.spyOn(orchestrator, 'respondToQuestion').mockRejectedValue(new Error('Connection failed'));

      const result = await handler.handleQuestion(baseQuestion);

      expect(result).toBe(false);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Failed to send response: Connection failed'
      );
    });

    it('should answer question in familiar manager on success', async () => {
      vi.mocked(vscode.window.showInputBox).mockResolvedValue('Yes');
      vi.spyOn(orchestrator, 'respondToQuestion').mockResolvedValue(undefined);
      const answerSpy = vi.spyOn(familiarManager, 'answerQuestion');

      await handler.handleQuestion(baseQuestion);

      expect(answerSpy).toHaveBeenCalledWith('task-1');
    });
  });
});
