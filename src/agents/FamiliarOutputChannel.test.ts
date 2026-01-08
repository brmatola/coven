import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FamiliarOutputChannel } from './FamiliarOutputChannel';
import { FamiliarManager } from './FamiliarManager';
import { DEFAULT_SESSION_CONFIG, Familiar, ProcessInfo } from '../shared/types';

// Mock fs module
vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
    appendFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('FamiliarOutputChannel', () => {
  let familiarManager: FamiliarManager;
  let outputChannel: FamiliarOutputChannel;
  const workspaceRoot = '/test/workspace';

  beforeEach(async () => {
    vi.clearAllMocks();
    familiarManager = new FamiliarManager(workspaceRoot, DEFAULT_SESSION_CONFIG);
    outputChannel = new FamiliarOutputChannel(familiarManager, workspaceRoot);
    await outputChannel.initialize();
  });

  afterEach(() => {
    outputChannel.dispose();
    familiarManager.dispose();
  });

  describe('initialization', () => {
    it('should create output directory on initialize', async () => {
      const newChannel = new FamiliarOutputChannel(familiarManager, workspaceRoot);
      await newChannel.initialize();

      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        path.join(workspaceRoot, '.coven', 'output'),
        { recursive: true }
      );
      newChannel.dispose();
    });
  });

  describe('channel management', () => {
    it('should create output channel with task ID when no title set', () => {
      const channel = outputChannel.getOrCreateChannel('task-123');

      expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('Coven: task-123');
      expect(channel).toBeDefined();
    });

    it('should create output channel with task title when set', () => {
      outputChannel.setTaskTitle('task-123', 'Fix the bug');
      const channel = outputChannel.getOrCreateChannel('task-123');

      expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('Coven: Fix the bug');
      expect(channel).toBeDefined();
    });

    it('should reuse existing channel for same task', () => {
      const channel1 = outputChannel.getOrCreateChannel('task-123');
      const channel2 = outputChannel.getOrCreateChannel('task-123');

      expect(channel1).toBe(channel2);
      expect(vscode.window.createOutputChannel).toHaveBeenCalledTimes(1);
    });

    it('should show channel with preserveFocus', () => {
      const channel = outputChannel.getOrCreateChannel('task-123');
      outputChannel.showChannel('task-123', true);

      expect(channel.show).toHaveBeenCalledWith(true);
    });

    it('should show channel without preserveFocus', () => {
      const channel = outputChannel.getOrCreateChannel('task-123');
      outputChannel.showChannel('task-123', false);

      expect(channel.show).toHaveBeenCalledWith(false);
    });

    it('should not throw when showing non-existent channel', () => {
      expect(() => outputChannel.showChannel('non-existent')).not.toThrow();
    });

    it('should clear channel content', () => {
      const channel = outputChannel.getOrCreateChannel('task-123');
      outputChannel.clearChannel('task-123');

      expect(channel.clear).toHaveBeenCalled();
    });

    it('should dispose channel', () => {
      const channel = outputChannel.getOrCreateChannel('task-123');
      outputChannel.disposeChannel('task-123');

      expect(channel.dispose).toHaveBeenCalled();
      expect(outputChannel.hasChannel('task-123')).toBe(false);
    });

    it('should track active channel IDs', () => {
      outputChannel.getOrCreateChannel('task-1');
      outputChannel.getOrCreateChannel('task-2');

      const ids = outputChannel.getActiveChannelIds();
      expect(ids).toContain('task-1');
      expect(ids).toContain('task-2');
    });

    it('should check if channel exists', () => {
      expect(outputChannel.hasChannel('task-123')).toBe(false);
      outputChannel.getOrCreateChannel('task-123');
      expect(outputChannel.hasChannel('task-123')).toBe(true);
    });
  });

  describe('output handling', () => {
    it('should append line with timestamp', () => {
      const channel = outputChannel.getOrCreateChannel('task-123');
      outputChannel.appendLine('task-123', 'Test output');

      expect(channel.appendLine).toHaveBeenCalledWith(expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] Test output$/));
    });

    it('should persist line to file', async () => {
      outputChannel.appendLine('task-123', 'Test output');

      // Wait for async persistence
      await vi.waitFor(() => {
        expect(fs.promises.appendFile).toHaveBeenCalledWith(
          path.join(workspaceRoot, '.coven', 'output', 'task-123.log'),
          expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] Test output\n$/)
        );
      });
    });

    it('should sanitize task ID for file path', async () => {
      outputChannel.appendLine('../../../etc/passwd', 'malicious');

      await vi.waitFor(() => {
        // ../../../etc/passwd -> _________etc_passwd (9 dots/slashes replaced)
        expect(fs.promises.appendFile).toHaveBeenCalledWith(
          path.join(workspaceRoot, '.coven', 'output', '_________etc_passwd.log'),
          expect.any(String)
        );
      });
    });
  });

  describe('persistence', () => {
    it('should load persisted output into channel', async () => {
      vi.mocked(fs.promises.readFile).mockResolvedValueOnce('Previous output\n');
      const channel = outputChannel.getOrCreateChannel('task-123');

      await outputChannel.loadPersistedOutput('task-123');

      expect(channel.append).toHaveBeenCalledWith('Previous output\n');
    });

    it('should handle missing persisted file gracefully', async () => {
      vi.mocked(fs.promises.readFile).mockRejectedValueOnce(new Error('ENOENT'));

      await expect(outputChannel.loadPersistedOutput('task-123')).resolves.not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should clean up old output files', async () => {
      const oldTime = Date.now() - 10 * 24 * 60 * 60 * 1000; // 10 days ago
      vi.mocked(fs.promises.readdir).mockResolvedValueOnce(['old.log', 'recent.log'] as unknown as fs.Dirent[]);
      vi.mocked(fs.promises.stat)
        .mockResolvedValueOnce({ mtimeMs: oldTime } as fs.Stats)
        .mockResolvedValueOnce({ mtimeMs: Date.now() } as fs.Stats);

      const deletedCount = await outputChannel.cleanupOldOutputFiles(7);

      expect(deletedCount).toBe(1);
      expect(fs.promises.unlink).toHaveBeenCalledTimes(1);
    });

    it('should skip non-log files', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValueOnce(['file.txt', 'other.json'] as unknown as fs.Dirent[]);

      const deletedCount = await outputChannel.cleanupOldOutputFiles(7);

      expect(deletedCount).toBe(0);
      expect(fs.promises.stat).not.toHaveBeenCalled();
    });
  });

  describe('event subscriptions', () => {
    const createProcessInfo = (): ProcessInfo => ({
      pid: 12345,
      startTime: Date.now(),
      command: 'claude',
      worktreePath: '/test/worktree',
    });

    it('should create channel when familiar spawned', async () => {
      await familiarManager.initialize();
      familiarManager.spawnFamiliar('task-123', createProcessInfo());

      expect(outputChannel.hasChannel('task-123')).toBe(true);
    });

    it('should append start message when familiar spawned', async () => {
      await familiarManager.initialize();
      familiarManager.spawnFamiliar('task-123', createProcessInfo());

      const channel = outputChannel.getOrCreateChannel('task-123');
      expect(channel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('--- Agent started ---')
      );
    });

    it('should append output when familiar outputs', async () => {
      await familiarManager.initialize();
      familiarManager.spawnFamiliar('task-123', createProcessInfo());

      const channel = outputChannel.getOrCreateChannel('task-123');
      vi.clearAllMocks();

      familiarManager.addOutput('task-123', 'Some output line');

      expect(channel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Some output line')
      );
    });

    it('should append termination message when familiar terminated', async () => {
      await familiarManager.initialize();
      familiarManager.spawnFamiliar('task-123', createProcessInfo());

      const channel = outputChannel.getOrCreateChannel('task-123');
      vi.clearAllMocks();

      familiarManager.terminateFamiliar('task-123', 'user requested');

      expect(channel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('--- Agent terminated: user requested ---')
      );
    });

    it('should append status change message', async () => {
      await familiarManager.initialize();
      familiarManager.spawnFamiliar('task-123', createProcessInfo());

      const channel = outputChannel.getOrCreateChannel('task-123');
      vi.clearAllMocks();

      familiarManager.updateStatus('task-123', 'waiting');

      expect(channel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('--- Status: working → waiting ---')
      );
    });

    it('should append question message', async () => {
      await familiarManager.initialize();
      familiarManager.spawnFamiliar('task-123', createProcessInfo());

      const channel = outputChannel.getOrCreateChannel('task-123');
      vi.clearAllMocks();

      familiarManager.addQuestion({
        familiarId: 'task-123',
        taskId: 'task-123',
        question: 'Should I continue?',
      });

      expect(channel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('--- Question: Should I continue? ---')
      );
    });
  });

  describe('dispose', () => {
    it('should dispose all channels', () => {
      const channel1 = outputChannel.getOrCreateChannel('task-1');
      const channel2 = outputChannel.getOrCreateChannel('task-2');

      outputChannel.dispose();

      expect(channel1.dispose).toHaveBeenCalled();
      expect(channel2.dispose).toHaveBeenCalled();
    });

    it('should unsubscribe from events', async () => {
      await familiarManager.initialize();
      outputChannel.dispose();

      // Spawning after dispose should not create a channel
      familiarManager.spawnFamiliar('task-123', {
        pid: 12345,
        startTime: Date.now(),
        command: 'claude',
        worktreePath: '/test/worktree',
      });

      expect(outputChannel.hasChannel('task-123')).toBe(false);
    });
  });
});
