import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentOrchestrator } from './AgentOrchestrator';
import { FamiliarManager } from './FamiliarManager';
import { WorktreeManager } from '../git/WorktreeManager';
import type { AgentProvider, AgentHandle, AgentSpawnConfig } from './types';
import { Task, SessionConfig } from '../shared/types';

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
    description: 'A simple test task',
    status: 'working',
    priority: 2,
    dependencies: [],
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createMockHandle(taskId: string): AgentHandle {
  return {
    pid: 12345,
    taskId,
    respond: vi.fn().mockResolvedValue(undefined),
    terminate: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(true),
  };
}

describe('AgentOrchestrator', () => {
  let orchestrator: AgentOrchestrator;
  let mockFamiliarManager: FamiliarManager;
  let mockWorktreeManager: WorktreeManager;
  let mockAgentProvider: AgentProvider;
  let mockHandle: AgentHandle;
  let capturedCallbacks: AgentSpawnConfig['callbacks'] | null = null;

  const config: SessionConfig = {
    maxConcurrentAgents: 3,
    agentTimeoutMs: 600000,
    autoMerge: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    capturedCallbacks = null;
    mockHandle = createMockHandle('task-1');

    // Mock FamiliarManager
    mockFamiliarManager = {
      canSpawn: vi.fn().mockReturnValue(true),
      spawnFamiliar: vi.fn().mockReturnValue({ taskId: 'task-1' }),
      addOutput: vi.fn(),
      addQuestion: vi.fn(),
      answerQuestion: vi.fn(),
      updateStatus: vi.fn(),
      terminateFamiliar: vi.fn(),
      on: vi.fn().mockReturnThis(),
      off: vi.fn().mockReturnThis(),
    } as unknown as FamiliarManager;

    // Mock WorktreeManager
    mockWorktreeManager = {
      createForTask: vi.fn().mockResolvedValue({
        path: '/test/worktree/task-1',
        branch: 'coven/session/task-1',
        head: 'abc123',
        isMain: false,
        isBare: false,
      }),
      cleanupForTask: vi.fn().mockResolvedValue(undefined),
      getWorktree: vi.fn(),
    } as unknown as WorktreeManager;

    // Mock AgentProvider
    mockAgentProvider = {
      name: 'mock-agent',
      isAvailable: vi.fn().mockResolvedValue(true),
      spawn: vi.fn().mockImplementation((config: AgentSpawnConfig) => {
        capturedCallbacks = config.callbacks;
        return Promise.resolve(mockHandle);
      }),
      getRunningAgents: vi.fn().mockReturnValue([]),
      terminateAll: vi.fn().mockResolvedValue(undefined),
    };

    orchestrator = new AgentOrchestrator(
      mockFamiliarManager,
      mockWorktreeManager,
      mockAgentProvider,
      config
    );
  });

  afterEach(() => {
    orchestrator.dispose();
  });

  describe('isAvailable', () => {
    it('should check agent provider availability', async () => {
      const available = await orchestrator.isAvailable();
      expect(available).toBe(true);
      expect(mockAgentProvider.isAvailable).toHaveBeenCalled();
    });
  });

  describe('spawnForTask', () => {
    it('should create worktree and spawn agent', async () => {
      const task = createMockTask();

      const handle = await orchestrator.spawnForTask({
        task,
        featureBranch: 'feature/main',
      });

      expect(mockWorktreeManager.createForTask).toHaveBeenCalledWith('task-1', 'feature/main');
      expect(mockAgentProvider.spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          task,
          workingDirectory: '/test/worktree/task-1',
          featureBranch: 'feature/main',
        })
      );
      expect(mockFamiliarManager.spawnFamiliar).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          pid: 12345,
          worktreePath: '/test/worktree/task-1',
        })
      );
      expect(handle.pid).toBe(12345);
    });

    it('should throw if max concurrent reached', async () => {
      vi.mocked(mockFamiliarManager.canSpawn).mockReturnValue(false);

      await expect(
        orchestrator.spawnForTask({
          task: createMockTask(),
          featureBranch: 'feature/main',
        })
      ).rejects.toThrow('Maximum concurrent agents reached');
    });

    it('should throw if agent already running for task', async () => {
      const task = createMockTask();
      await orchestrator.spawnForTask({ task, featureBranch: 'feature/main' });

      await expect(
        orchestrator.spawnForTask({ task, featureBranch: 'feature/main' })
      ).rejects.toThrow('Agent already running for task: task-1');
    });

    it('should cleanup worktree on spawn failure', async () => {
      vi.mocked(mockAgentProvider.spawn).mockRejectedValue(new Error('Spawn failed'));

      await expect(
        orchestrator.spawnForTask({
          task: createMockTask(),
          featureBranch: 'feature/main',
        })
      ).rejects.toThrow('Spawn failed');

      expect(mockWorktreeManager.cleanupForTask).toHaveBeenCalledWith('task-1', true);
    });

    it('should emit agent:spawned event', async () => {
      const handler = vi.fn();
      orchestrator.on('agent:spawned', handler);

      await orchestrator.spawnForTask({
        task: createMockTask(),
        featureBranch: 'feature/main',
      });

      expect(handler).toHaveBeenCalledWith({
        taskId: 'task-1',
        worktreePath: '/test/worktree/task-1',
      });
    });

    it('should use auto-accept prompt when specified', async () => {
      await orchestrator.spawnForTask({
        task: createMockTask(),
        featureBranch: 'feature/main',
        autoAccept: true,
      });

      expect(mockAgentProvider.spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('Auto-Accept Mode'),
        })
      );
    });
  });

  describe('event forwarding', () => {
    beforeEach(async () => {
      await orchestrator.spawnForTask({
        task: createMockTask(),
        featureBranch: 'feature/main',
      });
    });

    it('should forward output to FamiliarManager and emit event', () => {
      const handler = vi.fn();
      orchestrator.on('agent:output', handler);

      capturedCallbacks?.onOutput({
        type: 'stdout',
        content: 'Processing...',
        timestamp: Date.now(),
      });

      expect(mockFamiliarManager.addOutput).toHaveBeenCalledWith('task-1', 'Processing...');
      expect(handler).toHaveBeenCalledWith({
        taskId: 'task-1',
        output: expect.objectContaining({ content: 'Processing...' }),
      });
    });

    it('should forward questions to FamiliarManager and emit event', () => {
      const handler = vi.fn();
      orchestrator.on('agent:question', handler);

      capturedCallbacks?.onQuestion({
        id: 'q-1',
        type: 'permission',
        question: 'Should I proceed?',
        timestamp: Date.now(),
      });

      expect(mockFamiliarManager.addQuestion).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'q-1',
          question: 'Should I proceed?',
        })
      );
      expect(handler).toHaveBeenCalled();
    });

    it('should handle completion and update status', () => {
      const handler = vi.fn();
      orchestrator.on('agent:complete', handler);

      capturedCallbacks?.onComplete({
        success: true,
        summary: 'Task done',
        filesChanged: ['file.ts'],
        durationMs: 1000,
      });

      expect(mockFamiliarManager.updateStatus).toHaveBeenCalledWith('task-1', 'complete');
      expect(handler).toHaveBeenCalledWith({
        taskId: 'task-1',
        result: expect.objectContaining({ success: true }),
      });
    });

    it('should cleanup worktree on failure', () => {
      capturedCallbacks?.onComplete({
        success: false,
        summary: 'Task failed',
        filesChanged: [],
        error: 'Something went wrong',
        durationMs: 1000,
      });

      expect(mockFamiliarManager.updateStatus).toHaveBeenCalledWith('task-1', 'failed');
      expect(mockWorktreeManager.cleanupForTask).toHaveBeenCalledWith('task-1', true);
    });
  });

  describe('respondToQuestion', () => {
    it('should send response to agent and update FamiliarManager', async () => {
      await orchestrator.spawnForTask({
        task: createMockTask(),
        featureBranch: 'feature/main',
      });

      await orchestrator.respondToQuestion('task-1', 'yes');

      expect(mockHandle.respond).toHaveBeenCalledWith('yes');
      expect(mockFamiliarManager.answerQuestion).toHaveBeenCalledWith('task-1');
    });

    it('should throw if no agent running', async () => {
      await expect(orchestrator.respondToQuestion('task-1', 'yes')).rejects.toThrow(
        'No agent running for task: task-1'
      );
    });
  });

  describe('terminateAgent', () => {
    it('should terminate running agent', async () => {
      await orchestrator.spawnForTask({
        task: createMockTask(),
        featureBranch: 'feature/main',
      });

      await orchestrator.terminateAgent('task-1', 'user requested');

      expect(mockHandle.terminate).toHaveBeenCalledWith('user requested');
    });

    it('should do nothing if no agent running', async () => {
      await orchestrator.terminateAgent('task-1'); // Should not throw
    });
  });

  describe('isAgentRunning', () => {
    it('should return true when agent is running', async () => {
      await orchestrator.spawnForTask({
        task: createMockTask(),
        featureBranch: 'feature/main',
      });

      expect(orchestrator.isAgentRunning('task-1')).toBe(true);
    });

    it('should return false when no agent', () => {
      expect(orchestrator.isAgentRunning('task-1')).toBe(false);
    });
  });

  describe('terminateAll', () => {
    it('should terminate all agents', async () => {
      await orchestrator.terminateAll('shutdown');

      expect(mockAgentProvider.terminateAll).toHaveBeenCalledWith('shutdown');
    });
  });
});
