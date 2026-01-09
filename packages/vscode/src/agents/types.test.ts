import { describe, it, expect } from 'vitest';
import type {
  AgentProvider,
  AgentSpawnConfig,
  AgentHandle,
  AgentOutput,
  AgentQuestion,
  AgentQuestionType,
  AgentResult,
  TerminationOptions,
} from './types';

describe('Agent types', () => {
  describe('AgentSpawnConfig', () => {
    it('should define spawn configuration structure', () => {
      const config: AgentSpawnConfig = {
        task: {
          id: 'task-1',
          title: 'Test Task',
          description: 'A test task',
          status: 'working',
          priority: 'medium',
          dependencies: [],
          sourceId: 'test',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        workingDirectory: '/path/to/worktree',
        featureBranch: 'feature/main',
        callbacks: {
          onOutput: () => {},
          onQuestion: () => {},
          onComplete: () => {},
          onError: () => {},
        },
      };

      expect(config.task.id).toBe('task-1');
      expect(config.workingDirectory).toBe('/path/to/worktree');
    });
  });

  describe('AgentOutput', () => {
    it('should define output event structure', () => {
      const output: AgentOutput = {
        type: 'stdout',
        content: 'Processing...',
        timestamp: Date.now(),
      };

      expect(output.type).toBe('stdout');
      expect(output.content).toBe('Processing...');
    });

    it('should support all output types', () => {
      const types: AgentOutput['type'][] = ['stdout', 'stderr', 'status'];
      expect(types).toHaveLength(3);
    });
  });

  describe('AgentQuestion', () => {
    it('should define question structure', () => {
      const question: AgentQuestion = {
        id: 'q-1',
        type: 'clarification',
        question: 'Should I use TypeScript or JavaScript?',
        suggestedResponses: ['TypeScript', 'JavaScript'],
        timestamp: Date.now(),
      };

      expect(question.type).toBe('clarification');
      expect(question.suggestedResponses).toHaveLength(2);
    });

    it('should support all question types', () => {
      const types: AgentQuestionType[] = [
        'clarification',
        'permission',
        'decision',
        'blocked',
        'confirmation',
      ];
      expect(types).toHaveLength(5);
    });
  });

  describe('AgentResult', () => {
    it('should define successful result', () => {
      const result: AgentResult = {
        success: true,
        summary: 'Task completed successfully',
        filesChanged: ['src/file.ts', 'src/file.test.ts'],
        exitCode: 0,
        durationMs: 5000,
      };

      expect(result.success).toBe(true);
      expect(result.filesChanged).toHaveLength(2);
    });

    it('should define failed result', () => {
      const result: AgentResult = {
        success: false,
        summary: 'Task failed',
        filesChanged: [],
        error: 'Could not complete due to missing dependencies',
        exitCode: 1,
        durationMs: 2000,
      };

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('AgentHandle', () => {
    it('should define handle interface', () => {
      const handle: AgentHandle = {
        pid: 12345,
        taskId: 'task-1',
        respond: async () => {},
        terminate: async () => {},
        isRunning: () => true,
      };

      expect(handle.pid).toBe(12345);
      expect(handle.isRunning()).toBe(true);
    });
  });

  describe('AgentProvider', () => {
    it('should define provider interface', () => {
      const provider: AgentProvider = {
        name: 'test-provider',
        isAvailable: () => Promise.resolve(true),
        spawn: () =>
          Promise.resolve({
            pid: 1,
            taskId: 'task-1',
            respond: () => Promise.resolve(),
            terminate: () => Promise.resolve(),
            isRunning: () => true,
          }),
        getRunningAgents: () => [],
        terminateAll: () => Promise.resolve(),
      };

      expect(provider.name).toBe('test-provider');
    });
  });

  describe('TerminationOptions', () => {
    it('should define termination options', () => {
      const options: TerminationOptions = {
        gracePeriodMs: 5000,
        reason: 'User requested',
      };

      expect(options.gracePeriodMs).toBe(5000);
    });
  });
});
