import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  startTask,
  killTask,
  answerQuestion,
  startSession,
  stopSession,
  forceStopSession,
  registerWorkflowCommands,
} from './workflow';
import { DaemonClient } from '../daemon/client';
import { DaemonClientError } from '../daemon/types';

// Mock daemon client
vi.mock('../daemon/client', () => ({
  DaemonClient: vi.fn().mockImplementation(() => ({
    startTask: vi.fn(),
    killTask: vi.fn(),
    answerQuestion: vi.fn(),
    startSession: vi.fn(),
    stopSession: vi.fn(),
  })),
}));

describe('workflow commands', () => {
  let mockClient: {
    startTask: ReturnType<typeof vi.fn>;
    killTask: ReturnType<typeof vi.fn>;
    answerQuestion: ReturnType<typeof vi.fn>;
    startSession: ReturnType<typeof vi.fn>;
    stopSession: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      startTask: vi.fn().mockResolvedValue(undefined),
      killTask: vi.fn().mockResolvedValue(undefined),
      answerQuestion: vi.fn().mockResolvedValue(undefined),
      startSession: vi.fn().mockResolvedValue(undefined),
      stopSession: vi.fn().mockResolvedValue(undefined),
    };

    // Mock withProgress to just execute the operation
    vi.mocked(vscode.window.withProgress).mockImplementation(async (_options, task) => {
      return task({} as vscode.Progress<{ message?: string; increment?: number }>, {} as vscode.CancellationToken);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('startTask', () => {
    it('should start a task with string ID', async () => {
      const result = await startTask(mockClient as unknown as DaemonClient, 'task-123');

      expect(result).toBe(true);
      expect(mockClient.startTask).toHaveBeenCalledWith('task-123');
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Task started');
    });

    it('should start a task with tree item', async () => {
      const result = await startTask(mockClient as unknown as DaemonClient, {
        task: { id: 'task-456' },
      });

      expect(result).toBe(true);
      expect(mockClient.startTask).toHaveBeenCalledWith('task-456');
    });

    it('should start a task with object having id property', async () => {
      const result = await startTask(mockClient as unknown as DaemonClient, { id: 'task-789' });

      expect(result).toBe(true);
      expect(mockClient.startTask).toHaveBeenCalledWith('task-789');
    });

    it('should return false for invalid task reference', async () => {
      const result = await startTask(mockClient as unknown as DaemonClient, null);

      expect(result).toBe(false);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Invalid task reference');
      expect(mockClient.startTask).not.toHaveBeenCalled();
    });

    it('should show error on daemon failure', async () => {
      mockClient.startTask.mockRejectedValue(new Error('Connection failed'));

      const result = await startTask(mockClient as unknown as DaemonClient, 'task-123');

      expect(result).toBe(false);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Failed to start task: Connection failed'
      );
    });

    it('should show user-friendly error for connection refused', async () => {
      mockClient.startTask.mockRejectedValue(
        new DaemonClientError('connection_refused', 'Connection refused')
      );

      const result = await startTask(mockClient as unknown as DaemonClient, 'task-123');

      expect(result).toBe(false);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Failed to start task: Daemon is not running. Please start the coven daemon first.'
      );
    });

    it('should show user-friendly error for task not found', async () => {
      mockClient.startTask.mockRejectedValue(
        new DaemonClientError('task_not_found', 'Task not found')
      );

      const result = await startTask(mockClient as unknown as DaemonClient, 'task-123');

      expect(result).toBe(false);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Failed to start task: Task not found. It may have been deleted.'
      );
    });

    it('should skip progress indicator when showProgress is false', async () => {
      await startTask(mockClient as unknown as DaemonClient, 'task-123', {
        showProgress: false,
      });

      expect(vscode.window.withProgress).not.toHaveBeenCalled();
    });
  });

  describe('killTask', () => {
    it('should kill a task after confirmation', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Stop Task' as unknown as vscode.MessageItem);

      const result = await killTask(mockClient as unknown as DaemonClient, 'task-123');

      expect(result).toBe(true);
      expect(mockClient.killTask).toHaveBeenCalledWith('task-123', 'user requested');
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Task stopped');
    });

    it('should return false when user cancels confirmation', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

      const result = await killTask(mockClient as unknown as DaemonClient, 'task-123');

      expect(result).toBe(false);
      expect(mockClient.killTask).not.toHaveBeenCalled();
    });

    it('should skip confirmation when skipConfirmation is true', async () => {
      const result = await killTask(mockClient as unknown as DaemonClient, 'task-123', {
        skipConfirmation: true,
      });

      expect(result).toBe(true);
      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
      expect(mockClient.killTask).toHaveBeenCalledWith('task-123', 'user requested');
    });

    it('should return false for invalid task reference', async () => {
      const result = await killTask(mockClient as unknown as DaemonClient, null);

      expect(result).toBe(false);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Invalid task reference');
    });

    it('should show error on daemon failure', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Stop Task' as unknown as vscode.MessageItem);
      mockClient.killTask.mockRejectedValue(
        new DaemonClientError('agent_not_found', 'No agent found')
      );

      const result = await killTask(mockClient as unknown as DaemonClient, 'task-123');

      expect(result).toBe(false);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Failed to stop task: No agent is running for this task.'
      );
    });
  });

  describe('answerQuestion', () => {
    it('should answer a question', async () => {
      const result = await answerQuestion(
        mockClient as unknown as DaemonClient,
        'q-123',
        'My answer'
      );

      expect(result).toBe(true);
      expect(mockClient.answerQuestion).toHaveBeenCalledWith('q-123', 'My answer');
    });

    it('should return false for invalid question reference', async () => {
      const result = await answerQuestion(mockClient as unknown as DaemonClient, '', 'My answer');

      expect(result).toBe(false);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Invalid question reference');
    });

    it('should return false for empty answer', async () => {
      const result = await answerQuestion(mockClient as unknown as DaemonClient, 'q-123', '   ');

      expect(result).toBe(false);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Answer cannot be empty');
    });

    it('should show error on daemon failure', async () => {
      mockClient.answerQuestion.mockRejectedValue(
        new DaemonClientError('question_not_found', 'Question not found')
      );

      const result = await answerQuestion(
        mockClient as unknown as DaemonClient,
        'q-123',
        'My answer'
      );

      expect(result).toBe(false);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Failed to send answer: Question not found or already answered.'
      );
    });
  });

  describe('startSession', () => {
    it('should start a session without feature branch', async () => {
      const result = await startSession(mockClient as unknown as DaemonClient);

      expect(result).toBe(true);
      expect(mockClient.startSession).toHaveBeenCalledWith(undefined);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Session started');
    });

    it('should start a session with feature branch', async () => {
      const result = await startSession(
        mockClient as unknown as DaemonClient,
        'feature/my-feature'
      );

      expect(result).toBe(true);
      expect(mockClient.startSession).toHaveBeenCalledWith({
        featureBranch: 'feature/my-feature',
      });
    });

    it('should show error on daemon failure', async () => {
      mockClient.startSession.mockRejectedValue(
        new DaemonClientError('socket_not_found', 'Socket not found')
      );

      const result = await startSession(mockClient as unknown as DaemonClient);

      expect(result).toBe(false);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Failed to start session: Daemon socket not found. Please start the coven daemon first.'
      );
    });
  });

  describe('stopSession', () => {
    it('should stop session after confirmation', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Stop Session' as unknown as vscode.MessageItem);

      const result = await stopSession(mockClient as unknown as DaemonClient);

      expect(result).toBe(true);
      expect(mockClient.stopSession).toHaveBeenCalledWith(false);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Session stopped');
    });

    it('should return false when user cancels confirmation', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

      const result = await stopSession(mockClient as unknown as DaemonClient);

      expect(result).toBe(false);
      expect(mockClient.stopSession).not.toHaveBeenCalled();
    });

    it('should skip confirmation when skipConfirmation is true', async () => {
      const result = await stopSession(mockClient as unknown as DaemonClient, {
        skipConfirmation: true,
      });

      expect(result).toBe(true);
      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
      expect(mockClient.stopSession).toHaveBeenCalledWith(false);
    });

    it('should show error on daemon failure', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Stop Session' as unknown as vscode.MessageItem);
      mockClient.stopSession.mockRejectedValue(
        new DaemonClientError('session_not_active', 'No session')
      );

      const result = await stopSession(mockClient as unknown as DaemonClient);

      expect(result).toBe(false);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Failed to stop session: No active session. Please start a session first.'
      );
    });
  });

  describe('forceStopSession', () => {
    it('should force stop session after confirmation', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Force Stop' as unknown as vscode.MessageItem);

      const result = await forceStopSession(mockClient as unknown as DaemonClient);

      expect(result).toBe(true);
      expect(mockClient.stopSession).toHaveBeenCalledWith(true);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Session force stopped');
    });

    it('should return false when user cancels confirmation', async () => {
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

      const result = await forceStopSession(mockClient as unknown as DaemonClient);

      expect(result).toBe(false);
      expect(mockClient.stopSession).not.toHaveBeenCalled();
    });

    it('should skip confirmation when skipConfirmation is true', async () => {
      const result = await forceStopSession(mockClient as unknown as DaemonClient, {
        skipConfirmation: true,
      });

      expect(result).toBe(true);
      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
      expect(mockClient.stopSession).toHaveBeenCalledWith(true);
    });
  });

  describe('registerWorkflowCommands', () => {
    it('should register all workflow commands', () => {
      const mockContext = {
        subscriptions: [],
      } as unknown as vscode.ExtensionContext;

      registerWorkflowCommands(mockContext, mockClient as unknown as DaemonClient);

      expect(mockContext.subscriptions).toHaveLength(6);
      expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(6);
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'coven.daemon.startTask',
        expect.any(Function)
      );
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'coven.daemon.killTask',
        expect.any(Function)
      );
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'coven.daemon.answerQuestion',
        expect.any(Function)
      );
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'coven.daemon.startSession',
        expect.any(Function)
      );
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'coven.daemon.stopSession',
        expect.any(Function)
      );
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'coven.daemon.forceStopSession',
        expect.any(Function)
      );
    });
  });

  describe('error handling for non-Error rejections', () => {
    it('should handle string rejection', async () => {
      mockClient.startTask.mockRejectedValue('String error');

      const result = await startTask(mockClient as unknown as DaemonClient, 'task-123');

      expect(result).toBe(false);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Failed to start task: String error'
      );
    });
  });
});
