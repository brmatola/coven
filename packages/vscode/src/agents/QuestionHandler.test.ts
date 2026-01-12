import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { QuestionHandler } from './QuestionHandler';
import { DaemonClient } from '../daemon/client';
import type { SSEClient, SSEEvent } from '@coven/client-ts';
import { EventEmitter } from 'events';

// Mock daemon client
vi.mock('../daemon/client', () => ({
  DaemonClient: vi.fn().mockImplementation(() => ({
    answerQuestion: vi.fn(),
  })),
}));

describe('QuestionHandler', () => {
  let mockDaemonClient: { answerQuestion: ReturnType<typeof vi.fn> };
  let mockSSEClient: EventEmitter & { connectionState: string };
  let questionHandler: QuestionHandler;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDaemonClient = {
      answerQuestion: vi.fn().mockResolvedValue(undefined),
    };

    mockSSEClient = Object.assign(new EventEmitter(), {
      connectionState: 'connected',
    });

    questionHandler = new QuestionHandler(
      mockDaemonClient as unknown as DaemonClient,
      mockSSEClient as unknown as SSEClient
    );
  });

  afterEach(() => {
    questionHandler.dispose();
  });

  describe('initialization', () => {
    it('should subscribe to SSE events on initialize', () => {
      questionHandler.initialize();
      expect(mockSSEClient.listenerCount('event')).toBe(1);
    });
  });

  describe('badge callback', () => {
    it('should call badge callback when questions change', () => {
      questionHandler.initialize();
      const badgeCallback = vi.fn();
      questionHandler.setBadgeUpdateCallback(badgeCallback);

      // Emit question asked event
      const event: SSEEvent = {
        type: 'questions.asked',
        data: {
          question_id: 'q-1',
          task_id: 'task-123',
          agent_id: 'agent-1',
          question: 'What should I do?',
        },
        timestamp: Date.now(),
      };
      mockSSEClient.emit('event', event);

      expect(badgeCallback).toHaveBeenCalledWith(1);
    });

    it('should not fail if no badge callback set', () => {
      questionHandler.initialize();

      const event: SSEEvent = {
        type: 'questions.asked',
        data: {
          question_id: 'q-1',
          task_id: 'task-123',
          agent_id: 'agent-1',
          question: 'What should I do?',
        },
        timestamp: Date.now(),
      };

      expect(() => mockSSEClient.emit('event', event)).not.toThrow();
    });
  });

  describe('getPendingQuestions', () => {
    beforeEach(() => {
      questionHandler.initialize();
    });

    it('should return empty array when no questions', () => {
      expect(questionHandler.getPendingQuestions()).toEqual([]);
    });

    it('should return all pending questions', () => {
      // Add two questions
      mockSSEClient.emit('event', {
        type: 'questions.asked',
        data: {
          question_id: 'q-1',
          task_id: 'task-1',
          agent_id: 'agent-1',
          question: 'Question 1?',
        },
        timestamp: Date.now(),
      });

      mockSSEClient.emit('event', {
        type: 'questions.asked',
        data: {
          question_id: 'q-2',
          task_id: 'task-2',
          agent_id: 'agent-2',
          question: 'Question 2?',
        },
        timestamp: Date.now(),
      });

      const questions = questionHandler.getPendingQuestions();
      expect(questions).toHaveLength(2);
      expect(questions.map((q) => q.id)).toContain('q-1');
      expect(questions.map((q) => q.id)).toContain('q-2');
    });
  });

  describe('getPendingCount', () => {
    beforeEach(() => {
      questionHandler.initialize();
    });

    it('should return 0 when no questions', () => {
      expect(questionHandler.getPendingCount()).toBe(0);
    });

    it('should return correct count', () => {
      mockSSEClient.emit('event', {
        type: 'questions.asked',
        data: { question_id: 'q-1', task_id: 't-1', agent_id: 'a-1', question: 'Q1?' },
        timestamp: Date.now(),
      });

      expect(questionHandler.getPendingCount()).toBe(1);
    });
  });

  describe('hasQuestion', () => {
    beforeEach(() => {
      questionHandler.initialize();
    });

    it('should return false when no question for task', () => {
      expect(questionHandler.hasQuestion('task-123')).toBe(false);
    });

    it('should return true when question exists for task', () => {
      mockSSEClient.emit('event', {
        type: 'questions.asked',
        data: {
          question_id: 'q-1',
          task_id: 'task-123',
          agent_id: 'agent-1',
          question: 'Question?',
        },
        timestamp: Date.now(),
      });

      expect(questionHandler.hasQuestion('task-123')).toBe(true);
    });
  });

  describe('getQuestion', () => {
    beforeEach(() => {
      questionHandler.initialize();
    });

    it('should return undefined for unknown question', () => {
      expect(questionHandler.getQuestion('unknown')).toBeUndefined();
    });

    it('should return question by ID', () => {
      mockSSEClient.emit('event', {
        type: 'questions.asked',
        data: {
          question_id: 'q-1',
          task_id: 'task-123',
          agent_id: 'agent-1',
          question: 'What should I do?',
        },
        timestamp: Date.now(),
      });

      const question = questionHandler.getQuestion('q-1');
      expect(question).toBeDefined();
      expect(question?.id).toBe('q-1');
      expect(question?.text).toBe('What should I do?');
    });
  });

  describe('getQuestionByTaskId', () => {
    beforeEach(() => {
      questionHandler.initialize();
    });

    it('should return undefined for unknown task', () => {
      expect(questionHandler.getQuestionByTaskId('unknown')).toBeUndefined();
    });

    it('should return question by task ID', () => {
      mockSSEClient.emit('event', {
        type: 'questions.asked',
        data: {
          question_id: 'q-1',
          task_id: 'task-123',
          agent_id: 'agent-1',
          question: 'What should I do?',
        },
        timestamp: Date.now(),
      });

      const question = questionHandler.getQuestionByTaskId('task-123');
      expect(question).toBeDefined();
      expect(question?.task_id).toBe('task-123');
    });
  });

  describe('SSE event handling', () => {
    beforeEach(() => {
      questionHandler.initialize();
    });

    describe('questions.asked event', () => {
      it('should add question to pending', () => {
        // Mock showInformationMessage to not wait
        vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

        const event: SSEEvent = {
          type: 'questions.asked',
          data: {
            question_id: 'q-1',
            task_id: 'task-123',
            agent_id: 'agent-1',
            question: 'Should I proceed?',
            options: ['Yes', 'No'],
          },
          timestamp: Date.now(),
        };

        mockSSEClient.emit('event', event);

        expect(questionHandler.getPendingCount()).toBe(1);
        const question = questionHandler.getQuestion('q-1');
        expect(question?.text).toBe('Should I proceed?');
        expect(question?.options).toEqual(['Yes', 'No']);
      });

      it('should show notification with question preview', async () => {
        vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

        const event: SSEEvent = {
          type: 'questions.asked',
          data: {
            question_id: 'q-1',
            task_id: 'task-123',
            agent_id: 'agent-1',
            question: 'Short question?',
          },
          timestamp: Date.now(),
        };

        mockSSEClient.emit('event', event);

        // Wait for async notification
        await vi.waitFor(() => {
          expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            'Agent question: Short question?',
            'Answer'
          );
        });
      });

      it('should truncate long question in notification', async () => {
        vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

        const longQuestion = 'A'.repeat(100); // 100 character question

        const event: SSEEvent = {
          type: 'questions.asked',
          data: {
            question_id: 'q-1',
            task_id: 'task-123',
            agent_id: 'agent-1',
            question: longQuestion,
          },
          timestamp: Date.now(),
        };

        mockSSEClient.emit('event', event);

        await vi.waitFor(() => {
          expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            `Agent question: ${'A'.repeat(50)}...`,
            'Answer'
          );
        });
      });

      it('should update badge count', () => {
        vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
        const badgeCallback = vi.fn();
        questionHandler.setBadgeUpdateCallback(badgeCallback);

        mockSSEClient.emit('event', {
          type: 'questions.asked',
          data: { question_id: 'q-1', task_id: 't-1', agent_id: 'a-1', question: 'Q?' },
          timestamp: Date.now(),
        });

        expect(badgeCallback).toHaveBeenCalledWith(1);

        mockSSEClient.emit('event', {
          type: 'questions.asked',
          data: { question_id: 'q-2', task_id: 't-2', agent_id: 'a-2', question: 'Q2?' },
          timestamp: Date.now(),
        });

        expect(badgeCallback).toHaveBeenCalledWith(2);
      });
    });

    describe('questions.answered event', () => {
      it('should remove question from pending', () => {
        vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

        // First add a question
        mockSSEClient.emit('event', {
          type: 'questions.asked',
          data: { question_id: 'q-1', task_id: 't-1', agent_id: 'a-1', question: 'Q?' },
          timestamp: Date.now(),
        });

        expect(questionHandler.getPendingCount()).toBe(1);

        // Then answer it
        mockSSEClient.emit('event', {
          type: 'questions.answered',
          data: { question_id: 'q-1' },
          timestamp: Date.now(),
        });

        expect(questionHandler.getPendingCount()).toBe(0);
      });

      it('should update badge count', () => {
        vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
        const badgeCallback = vi.fn();
        questionHandler.setBadgeUpdateCallback(badgeCallback);

        // Add question
        mockSSEClient.emit('event', {
          type: 'questions.asked',
          data: { question_id: 'q-1', task_id: 't-1', agent_id: 'a-1', question: 'Q?' },
          timestamp: Date.now(),
        });

        vi.clearAllMocks();

        // Answer question
        mockSSEClient.emit('event', {
          type: 'questions.answered',
          data: { question_id: 'q-1' },
          timestamp: Date.now(),
        });

        expect(badgeCallback).toHaveBeenCalledWith(0);
      });
    });

    describe('unhandled events', () => {
      it('should ignore unknown event types', () => {
        const event: SSEEvent = {
          type: 'agent.output',
          data: { task_id: 'task-1', output: 'output' },
          timestamp: Date.now(),
        };

        expect(() => mockSSEClient.emit('event', event)).not.toThrow();
      });
    });
  });

  describe('showAnswerDialog', () => {
    beforeEach(() => {
      questionHandler.initialize();
    });

    it('should show warning for unknown question', async () => {
      const result = await questionHandler.showAnswerDialog('unknown');

      expect(result).toBe(false);
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        'Question not found or already answered'
      );
    });

    it('should return false when user cancels', async () => {
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
      vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);

      // Add question
      mockSSEClient.emit('event', {
        type: 'questions.asked',
        data: { question_id: 'q-1', task_id: 't-1', agent_id: 'a-1', question: 'Q?' },
        timestamp: Date.now(),
      });

      const result = await questionHandler.showAnswerDialog('q-1');

      expect(result).toBe(false);
    });

    it('should submit answer on success', async () => {
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
      vi.mocked(vscode.window.showInputBox).mockResolvedValue('My answer');

      // Add question
      mockSSEClient.emit('event', {
        type: 'questions.asked',
        data: { question_id: 'q-1', task_id: 't-1', agent_id: 'a-1', question: 'Q?' },
        timestamp: Date.now(),
      });

      const result = await questionHandler.showAnswerDialog('q-1');

      expect(result).toBe(true);
      expect(mockDaemonClient.answerQuestion).toHaveBeenCalledWith('q-1', 'My answer');
    });

    it('should show quick pick for questions with options', async () => {
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: 'Yes', description: '' });

      // Add question with options
      mockSSEClient.emit('event', {
        type: 'questions.asked',
        data: {
          question_id: 'q-1',
          task_id: 't-1',
          agent_id: 'a-1',
          question: 'Continue?',
          options: ['Yes', 'No'],
        },
        timestamp: Date.now(),
      });

      const result = await questionHandler.showAnswerDialog('q-1');

      expect(result).toBe(true);
      expect(vscode.window.showQuickPick).toHaveBeenCalled();
      expect(mockDaemonClient.answerQuestion).toHaveBeenCalledWith('q-1', 'Yes');
    });

    it('should show input box when custom response selected', async () => {
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue({
        label: '$(edit) Custom response...',
        description: 'Type a custom response',
      });
      vi.mocked(vscode.window.showInputBox).mockResolvedValue('Custom answer');

      // Add question with options
      mockSSEClient.emit('event', {
        type: 'questions.asked',
        data: {
          question_id: 'q-1',
          task_id: 't-1',
          agent_id: 'a-1',
          question: 'Continue?',
          options: ['Yes', 'No'],
        },
        timestamp: Date.now(),
      });

      const result = await questionHandler.showAnswerDialog('q-1');

      expect(result).toBe(true);
      expect(vscode.window.showInputBox).toHaveBeenCalled();
      expect(mockDaemonClient.answerQuestion).toHaveBeenCalledWith('q-1', 'Custom answer');
    });

    it('should return false when quick pick cancelled', async () => {
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

      // Add question with options
      mockSSEClient.emit('event', {
        type: 'questions.asked',
        data: {
          question_id: 'q-1',
          task_id: 't-1',
          agent_id: 'a-1',
          question: 'Continue?',
          options: ['Yes', 'No'],
        },
        timestamp: Date.now(),
      });

      const result = await questionHandler.showAnswerDialog('q-1');

      expect(result).toBe(false);
    });
  });

  describe('showAnswerDialogByTaskId', () => {
    beforeEach(() => {
      questionHandler.initialize();
    });

    it('should show warning for unknown task', async () => {
      const result = await questionHandler.showAnswerDialogByTaskId('unknown');

      expect(result).toBe(false);
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        'No pending question for this task'
      );
    });

    it('should show answer dialog for task question', async () => {
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
      vi.mocked(vscode.window.showInputBox).mockResolvedValue('My answer');

      // Add question
      mockSSEClient.emit('event', {
        type: 'questions.asked',
        data: { question_id: 'q-1', task_id: 'task-123', agent_id: 'a-1', question: 'Q?' },
        timestamp: Date.now(),
      });

      const result = await questionHandler.showAnswerDialogByTaskId('task-123');

      expect(result).toBe(true);
      expect(mockDaemonClient.answerQuestion).toHaveBeenCalledWith('q-1', 'My answer');
    });
  });

  describe('submitAnswer', () => {
    beforeEach(() => {
      questionHandler.initialize();
    });

    it('should submit answer via daemon client', async () => {
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

      // Add question
      mockSSEClient.emit('event', {
        type: 'questions.asked',
        data: { question_id: 'q-1', task_id: 't-1', agent_id: 'a-1', question: 'Q?' },
        timestamp: Date.now(),
      });

      const result = await questionHandler.submitAnswer('q-1', 'My answer');

      expect(result).toBe(true);
      expect(mockDaemonClient.answerQuestion).toHaveBeenCalledWith('q-1', 'My answer');
    });

    it('should remove question from pending after submit', async () => {
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

      // Add question
      mockSSEClient.emit('event', {
        type: 'questions.asked',
        data: { question_id: 'q-1', task_id: 't-1', agent_id: 'a-1', question: 'Q?' },
        timestamp: Date.now(),
      });

      expect(questionHandler.getPendingCount()).toBe(1);

      await questionHandler.submitAnswer('q-1', 'My answer');

      expect(questionHandler.getPendingCount()).toBe(0);
    });

    it('should update badge after submit', async () => {
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
      const badgeCallback = vi.fn();
      questionHandler.setBadgeUpdateCallback(badgeCallback);

      // Add question
      mockSSEClient.emit('event', {
        type: 'questions.asked',
        data: { question_id: 'q-1', task_id: 't-1', agent_id: 'a-1', question: 'Q?' },
        timestamp: Date.now(),
      });

      vi.clearAllMocks();

      await questionHandler.submitAnswer('q-1', 'My answer');

      expect(badgeCallback).toHaveBeenCalledWith(0);
    });

    it('should show error and return false on submit failure', async () => {
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
      mockDaemonClient.answerQuestion.mockRejectedValue(new Error('Network error'));

      // Add question
      mockSSEClient.emit('event', {
        type: 'questions.asked',
        data: { question_id: 'q-1', task_id: 't-1', agent_id: 'a-1', question: 'Q?' },
        timestamp: Date.now(),
      });

      const result = await questionHandler.submitAnswer('q-1', 'My answer');

      expect(result).toBe(false);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Failed to send answer: Network error'
      );
    });

    it('should handle non-Error rejection', async () => {
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
      mockDaemonClient.answerQuestion.mockRejectedValue('String error');

      // Add question
      mockSSEClient.emit('event', {
        type: 'questions.asked',
        data: { question_id: 'q-1', task_id: 't-1', agent_id: 'a-1', question: 'Q?' },
        timestamp: Date.now(),
      });

      const result = await questionHandler.submitAnswer('q-1', 'My answer');

      expect(result).toBe(false);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Failed to send answer: String error'
      );
    });
  });

  describe('notification click handler', () => {
    beforeEach(() => {
      questionHandler.initialize();
    });

    it('should open answer dialog when Answer clicked', async () => {
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Answer' as unknown as vscode.MessageItem);
      vi.mocked(vscode.window.showInputBox).mockResolvedValue('My response');

      const event: SSEEvent = {
        type: 'questions.asked',
        data: {
          question_id: 'q-1',
          task_id: 'task-123',
          agent_id: 'agent-1',
          question: 'Continue?',
        },
        timestamp: Date.now(),
      };

      mockSSEClient.emit('event', event);

      // Wait for notification to be shown and clicked
      await vi.waitFor(() => {
        expect(mockDaemonClient.answerQuestion).toHaveBeenCalledWith('q-1', 'My response');
      });
    });
  });

  describe('dispose', () => {
    beforeEach(() => {
      questionHandler.initialize();
    });

    it('should unsubscribe from events', () => {
      questionHandler.dispose();
      expect(mockSSEClient.listenerCount('event')).toBe(0);
    });

    it('should clear pending questions', () => {
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

      // Add question
      mockSSEClient.emit('event', {
        type: 'questions.asked',
        data: { question_id: 'q-1', task_id: 't-1', agent_id: 'a-1', question: 'Q?' },
        timestamp: Date.now(),
      });

      expect(questionHandler.getPendingCount()).toBe(1);

      questionHandler.dispose();

      expect(questionHandler.getPendingCount()).toBe(0);
    });

    it('should clear badge callback', () => {
      const badgeCallback = vi.fn();
      questionHandler.setBadgeUpdateCallback(badgeCallback);

      questionHandler.dispose();

      // Re-initialize to verify callback is cleared
      questionHandler.initialize();

      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
      mockSSEClient.emit('event', {
        type: 'questions.asked',
        data: { question_id: 'q-1', task_id: 't-1', agent_id: 'a-1', question: 'Q?' },
        timestamp: Date.now(),
      });

      // Badge callback should not have been called after dispose
      expect(badgeCallback).not.toHaveBeenCalled();
    });

    it('should not throw when disposing twice', () => {
      questionHandler.dispose();
      expect(() => questionHandler.dispose()).not.toThrow();
    });
  });
});
