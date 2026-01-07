import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { FamiliarManager } from './FamiliarManager';
import { ProcessInfo, SessionConfig, DEFAULT_SESSION_CONFIG } from '../shared/types';

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
      writeFile: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe('FamiliarManager', () => {
  let familiarManager: FamiliarManager;
  const workspaceRoot = '/test/workspace';
  const config: SessionConfig = { ...DEFAULT_SESSION_CONFIG };

  const mockProcessInfo: ProcessInfo = {
    pid: 12345,
    startTime: Date.now(),
    command: 'claude',
    worktreePath: '/test/workspace/.coven/worktrees/task-123',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    familiarManager = new FamiliarManager(workspaceRoot, config);
    await familiarManager.initialize();
  });

  afterEach(() => {
    familiarManager.dispose();
  });

  describe('spawning', () => {
    it('should spawn a familiar', () => {
      const familiar = familiarManager.spawnFamiliar('task-1', mockProcessInfo);

      expect(familiar.taskId).toBe('task-1');
      expect(familiar.status).toBe('working');
      expect(familiar.processInfo).toEqual(mockProcessInfo);
      expect(familiar.outputBuffer).toEqual([]);
    });

    it('should emit familiar:spawned event', () => {
      const handler = vi.fn();
      familiarManager.on('familiar:spawned', handler);

      const familiar = familiarManager.spawnFamiliar('task-1', mockProcessInfo);

      expect(handler).toHaveBeenCalledWith({ familiar });
    });

    it('should respect maxConcurrentAgents', () => {
      // Spawn up to max
      for (let i = 0; i < config.maxConcurrentAgents; i++) {
        familiarManager.spawnFamiliar(`task-${i}`, {
          ...mockProcessInfo,
          pid: 10000 + i,
        });
      }

      expect(familiarManager.canSpawn()).toBe(false);
      expect(() => familiarManager.spawnFamiliar('task-extra', mockProcessInfo)).toThrow(
        'Maximum concurrent agents reached'
      );
    });

    it('should not allow duplicate familiars for same task', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);

      expect(() => familiarManager.spawnFamiliar('task-1', mockProcessInfo)).toThrow(
        'Familiar already exists for task'
      );
    });

    it('should persist familiar to disk', async () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);

      // Flush pending writes
      await familiarManager.flush();

      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        path.join(workspaceRoot, '.coven', 'familiars', 'task-1.json'),
        expect.any(String)
      );
    });
  });

  describe('getFamiliar', () => {
    it('should return familiar by task ID', () => {
      const spawned = familiarManager.spawnFamiliar('task-1', mockProcessInfo);
      const retrieved = familiarManager.getFamiliar('task-1');

      expect(retrieved).toEqual(spawned);
    });

    it('should return undefined for non-existent familiar', () => {
      expect(familiarManager.getFamiliar('non-existent')).toBeUndefined();
    });
  });

  describe('getActiveFamiliars', () => {
    it('should return only working and waiting familiars', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);
      familiarManager.spawnFamiliar('task-2', { ...mockProcessInfo, pid: 10001 });
      familiarManager.updateStatus('task-2', 'complete');

      const active = familiarManager.getActiveFamiliars();
      expect(active).toHaveLength(1);
      expect(active[0].taskId).toBe('task-1');
    });
  });

  describe('updateStatus', () => {
    it('should update familiar status', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);
      const updated = familiarManager.updateStatus('task-1', 'waiting');

      expect(updated.status).toBe('waiting');
    });

    it('should emit familiar:statusChanged event', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);

      const handler = vi.fn();
      familiarManager.on('familiar:statusChanged', handler);

      familiarManager.updateStatus('task-1', 'waiting');

      expect(handler).toHaveBeenCalledWith({
        familiar: expect.objectContaining({ status: 'waiting' }),
        previousStatus: 'working',
      });
    });

    it('should throw for non-existent familiar', () => {
      expect(() => familiarManager.updateStatus('non-existent', 'waiting')).toThrow(
        'Familiar not found'
      );
    });
  });

  describe('output handling', () => {
    it('should add output to buffer', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);
      familiarManager.addOutput('task-1', 'line 1');
      familiarManager.addOutput('task-1', 'line 2');

      const familiar = familiarManager.getFamiliar('task-1');
      expect(familiar?.outputBuffer).toEqual(['line 1', 'line 2']);
    });

    it('should emit familiar:output event', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);

      const handler = vi.fn();
      familiarManager.on('familiar:output', handler);

      familiarManager.addOutput('task-1', 'test line');

      expect(handler).toHaveBeenCalledWith({
        familiarId: 'task-1',
        line: 'test line',
      });
    });

    it('should limit buffer to 100 lines', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);

      for (let i = 0; i < 150; i++) {
        familiarManager.addOutput('task-1', `line ${i}`);
      }

      const familiar = familiarManager.getFamiliar('task-1');
      expect(familiar?.outputBuffer).toHaveLength(100);
      expect(familiar?.outputBuffer[0]).toBe('line 50');
      expect(familiar?.outputBuffer[99]).toBe('line 149');
    });
  });

  describe('termination', () => {
    it('should remove familiar on termination', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);
      familiarManager.terminateFamiliar('task-1', 'completed');

      expect(familiarManager.getFamiliar('task-1')).toBeUndefined();
    });

    it('should emit familiar:terminated event', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);

      const handler = vi.fn();
      familiarManager.on('familiar:terminated', handler);

      familiarManager.terminateFamiliar('task-1', 'completed');

      expect(handler).toHaveBeenCalledWith({
        familiarId: 'task-1',
        reason: 'completed',
      });
    });

    it('should remove persistence file', async () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);
      familiarManager.terminateFamiliar('task-1', 'completed');

      // Wait for async cleanup
      await vi.waitFor(() => {
        expect(fs.promises.unlink).toHaveBeenCalledWith(
          path.join(workspaceRoot, '.coven', 'familiars', 'task-1.json')
        );
      });
    });

    it('should remove pending questions for terminated familiar', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);
      familiarManager.addQuestion({
        familiarId: 'task-1',
        taskId: 'task-1',
        question: 'What should I do?',
      });

      familiarManager.terminateFamiliar('task-1', 'completed');

      expect(familiarManager.getQuestion('task-1')).toBeUndefined();
    });
  });

  describe('question handling', () => {
    it('should add a pending question', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);
      const question = familiarManager.addQuestion({
        familiarId: 'task-1',
        taskId: 'task-1',
        question: 'What should I do?',
        options: ['Option A', 'Option B'],
      });

      expect(question.question).toBe('What should I do?');
      expect(question.options).toEqual(['Option A', 'Option B']);
      expect(question.askedAt).toBeDefined();
    });

    it('should update familiar status to waiting when question is asked', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);
      familiarManager.addQuestion({
        familiarId: 'task-1',
        taskId: 'task-1',
        question: 'What should I do?',
      });

      const familiar = familiarManager.getFamiliar('task-1');
      expect(familiar?.status).toBe('waiting');
    });

    it('should emit familiar:question event', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);

      const handler = vi.fn();
      familiarManager.on('familiar:question', handler);

      const question = familiarManager.addQuestion({
        familiarId: 'task-1',
        taskId: 'task-1',
        question: 'What should I do?',
      });

      expect(handler).toHaveBeenCalledWith({ question });
    });

    it('should answer a pending question', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);
      familiarManager.addQuestion({
        familiarId: 'task-1',
        taskId: 'task-1',
        question: 'What should I do?',
      });

      familiarManager.answerQuestion('task-1');

      expect(familiarManager.getQuestion('task-1')).toBeUndefined();
    });

    it('should update familiar status to working when question is answered', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);
      familiarManager.addQuestion({
        familiarId: 'task-1',
        taskId: 'task-1',
        question: 'What should I do?',
      });

      familiarManager.answerQuestion('task-1');

      const familiar = familiarManager.getFamiliar('task-1');
      expect(familiar?.status).toBe('working');
    });

    it('should return all pending questions', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);
      familiarManager.spawnFamiliar('task-2', { ...mockProcessInfo, pid: 10001 });

      familiarManager.addQuestion({
        familiarId: 'task-1',
        taskId: 'task-1',
        question: 'Question 1?',
      });
      familiarManager.addQuestion({
        familiarId: 'task-2',
        taskId: 'task-2',
        question: 'Question 2?',
      });

      const questions = familiarManager.getPendingQuestions();
      expect(questions).toHaveLength(2);
    });
  });

  describe('canSpawn and getAvailableSlots', () => {
    it('should return true when under limit', () => {
      expect(familiarManager.canSpawn()).toBe(true);
      expect(familiarManager.getAvailableSlots()).toBe(config.maxConcurrentAgents);
    });

    it('should track available slots as familiars spawn', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);
      expect(familiarManager.getAvailableSlots()).toBe(config.maxConcurrentAgents - 1);

      familiarManager.spawnFamiliar('task-2', { ...mockProcessInfo, pid: 10001 });
      expect(familiarManager.getAvailableSlots()).toBe(config.maxConcurrentAgents - 2);
    });

    it('should increase slots when familiar terminates', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);
      familiarManager.spawnFamiliar('task-2', { ...mockProcessInfo, pid: 10001 });

      familiarManager.terminateFamiliar('task-1', 'completed');
      expect(familiarManager.getAvailableSlots()).toBe(config.maxConcurrentAgents - 1);
    });

    it('should not count complete/failed familiars as active', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);
      familiarManager.updateStatus('task-1', 'complete');

      expect(familiarManager.getActiveFamiliars()).toHaveLength(0);
      expect(familiarManager.canSpawn()).toBe(true);
      expect(familiarManager.getAvailableSlots()).toBe(config.maxConcurrentAgents);
    });
  });

  describe('clear', () => {
    it('should remove all familiars', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);
      familiarManager.spawnFamiliar('task-2', { ...mockProcessInfo, pid: 10001 });

      familiarManager.clear();

      expect(familiarManager.getAllFamiliars()).toHaveLength(0);
    });

    it('should clear all pending questions', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);
      familiarManager.addQuestion({
        familiarId: 'task-1',
        taskId: 'task-1',
        question: 'Question?',
      });

      familiarManager.clear();

      expect(familiarManager.getPendingQuestions()).toHaveLength(0);
    });
  });

  describe('recovery methods', () => {
    it('should register a recovered familiar', () => {
      const handler = vi.fn();
      familiarManager.on('familiar:spawned', handler);

      familiarManager.registerRecoveredFamiliar({
        taskId: 'task-1',
        status: 'working',
        processInfo: mockProcessInfo,
        spawnedAt: Date.now(),
        outputBuffer: [],
      });

      expect(familiarManager.getFamiliar('task-1')).toBeDefined();
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('timeout handling', () => {
    it('should return remaining time for active familiar', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);

      const remaining = familiarManager.getRemainingTime('task-1');
      expect(remaining).toBeDefined();
      expect(remaining).toBeLessThanOrEqual(config.agentTimeoutMs);
      expect(remaining).toBeGreaterThan(0);
    });

    it('should return null for non-existent familiar', () => {
      expect(familiarManager.getRemainingTime('non-existent')).toBeNull();
    });

    it('should return null for completed familiar', () => {
      familiarManager.spawnFamiliar('task-1', mockProcessInfo);
      familiarManager.updateStatus('task-1', 'complete');

      expect(familiarManager.getRemainingTime('task-1')).toBeNull();
    });
  });
});
