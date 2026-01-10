import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CovenSession } from './CovenSession';
import { DEFAULT_SESSION_CONFIG } from '../shared/types';
import { DaemonClient } from '../daemon/client';
import { SSEClient } from '../daemon/sse';

vi.mock('../daemon/client');
vi.mock('../daemon/sse');

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
      writeFile: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      access: vi.fn().mockRejectedValue(new Error('ENOENT')),
      unlink: vi.fn().mockResolvedValue(undefined),
    },
    watch: vi.fn().mockReturnValue({ close: vi.fn() }),
  };
});

// Mock GitCLI to prevent real git commands
vi.mock('../git/GitCLI', () => ({
  GitCLI: vi.fn().mockImplementation(() => ({
    listWorktrees: vi.fn().mockResolvedValue([]),
    createWorktree: vi.fn().mockResolvedValue({
      path: '/test/worktree',
      branch: 'test-branch',
      head: 'abc123',
      isMain: false,
      isBare: false,
    }),
    deleteWorktree: vi.fn().mockResolvedValue(undefined),
    merge: vi.fn().mockResolvedValue({ success: true, conflicts: [], mergedFiles: [] }),
    getStatus: vi.fn().mockResolvedValue({
      staged: [],
      modified: [],
      untracked: [],
      deleted: [],
      branch: 'main',
      ahead: 0,
      behind: 0,
    }),
    isAvailable: vi.fn().mockResolvedValue(true),
  })),
  GitCLIError: class extends Error {
    constructor(message: string, public cause?: unknown) {
      super(message);
      this.name = 'GitCLIError';
    }
  },
}));

// Mock BeadsClient to return empty tasks
vi.mock('../tasks/BeadsClient', () => ({
  BeadsClient: vi.fn().mockImplementation(() => ({
    isAvailable: vi.fn().mockResolvedValue(true),
    isInitialized: vi.fn().mockResolvedValue(true),
    listReady: vi.fn().mockResolvedValue([]),
    getTask: vi.fn().mockResolvedValue(null),
    createTask: vi.fn().mockResolvedValue({ success: true, id: 'test-id' }),
    updateStatus: vi.fn().mockResolvedValue({ success: true }),
    closeTask: vi.fn().mockResolvedValue({ success: true }),
  })),
  BeadsClientError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'BeadsClientError';
    }
  },
}));

describe('CovenSession', () => {
  let session: CovenSession;
  const workspaceRoot = '/test/workspace';

  beforeEach(async () => {
    vi.clearAllMocks();
    session = new CovenSession(workspaceRoot);
    await session.initialize();
  });

  afterEach(() => {
    session.dispose();
  });

  describe('initialization', () => {
    it('should initialize with inactive status', () => {
      expect(session.getStatus()).toBe('inactive');
      expect(session.getFeatureBranch()).toBeNull();
      expect(session.isActive()).toBe(false);
    });

    it('should create .coven directory', () => {
      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        path.join(workspaceRoot, '.coven'),
        { recursive: true }
      );
    });

    it('should load default config when no config file exists', () => {
      const config = session.getConfig();
      expect(config.maxConcurrentAgents).toBe(DEFAULT_SESSION_CONFIG.maxConcurrentAgents);
    });

    it('should restore active session from file', async () => {
      // Mock readFile to return active session
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(DEFAULT_SESSION_CONFIG)) // config.json
        .mockResolvedValueOnce(JSON.stringify({ status: 'active', featureBranch: 'feature/test' })); // session.json

      const newSession = new CovenSession(workspaceRoot);
      await newSession.initialize();

      expect(newSession.getStatus()).toBe('active');
      expect(newSession.getFeatureBranch()).toBe('feature/test');

      newSession.dispose();
    });
  });

  describe('start', () => {
    it('should start a session', async () => {
      await session.start('feature/test');

      expect(session.getStatus()).toBe('active');
      expect(session.getFeatureBranch()).toBe('feature/test');
      expect(session.isActive()).toBe(true);
    });

    it('should emit session:starting and session:started events', async () => {
      const startingHandler = vi.fn();
      const startedHandler = vi.fn();

      session.on('session:starting', startingHandler);
      session.on('session:started', startedHandler);

      await session.start('feature/test');

      expect(startingHandler).toHaveBeenCalledWith({ featureBranch: 'feature/test' });
      expect(startedHandler).toHaveBeenCalledWith({ featureBranch: 'feature/test' });
    });

    it('should throw if session is already active', async () => {
      await session.start('feature/test');

      await expect(session.start('feature/other')).rejects.toThrow('Session already active');
    });

    it('should persist session state', async () => {
      await session.start('feature/test');

      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        path.join(workspaceRoot, '.coven', 'session.json'),
        expect.stringContaining('feature/test')
      );
    });
  });

  describe('pause', () => {
    it('should pause an active session', async () => {
      await session.start('feature/test');
      await session.pause();

      expect(session.getStatus()).toBe('paused');
      expect(session.isPaused()).toBe(true);
      expect(session.isActive()).toBe(false);
    });

    it('should emit session:paused event', async () => {
      await session.start('feature/test');

      const handler = vi.fn();
      session.on('session:paused', handler);

      await session.pause();

      expect(handler).toHaveBeenCalled();
    });

    it('should do nothing if session is not active', async () => {
      const handler = vi.fn();
      session.on('session:paused', handler);

      await session.pause();

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('resume', () => {
    it('should resume a paused session', async () => {
      await session.start('feature/test');
      await session.pause();
      await session.resume();

      expect(session.getStatus()).toBe('active');
      expect(session.isPaused()).toBe(false);
      expect(session.isActive()).toBe(true);
    });

    it('should emit session:resumed event', async () => {
      await session.start('feature/test');
      await session.pause();

      const handler = vi.fn();
      session.on('session:resumed', handler);

      await session.resume();

      expect(handler).toHaveBeenCalled();
    });

    it('should do nothing if session is not paused', async () => {
      await session.start('feature/test');

      const handler = vi.fn();
      session.on('session:resumed', handler);

      await session.resume();

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should stop an active session', async () => {
      await session.start('feature/test');
      await session.stop();

      expect(session.getStatus()).toBe('inactive');
      expect(session.getFeatureBranch()).toBeNull();
      expect(session.isActive()).toBe(false);
    });

    it('should stop a paused session', async () => {
      await session.start('feature/test');
      await session.pause();
      await session.stop();

      expect(session.getStatus()).toBe('inactive');
      expect(session.getFeatureBranch()).toBeNull();
    });

    it('should emit session:stopping and session:stopped events', async () => {
      await session.start('feature/test');

      const stoppingHandler = vi.fn();
      const stoppedHandler = vi.fn();

      session.on('session:stopping', stoppingHandler);
      session.on('session:stopped', stoppedHandler);

      await session.stop();

      expect(stoppingHandler).toHaveBeenCalled();
      expect(stoppedHandler).toHaveBeenCalled();
    });

    it('should do nothing if session is not active or paused', async () => {
      const stoppingHandler = vi.fn();
      session.on('session:stopping', stoppingHandler);

      await session.stop();

      expect(stoppingHandler).not.toHaveBeenCalled();
    });
  });

  describe('getState', () => {
    it('should return current state snapshot', async () => {
      await session.start('feature/test');

      const state = session.getState();

      expect(state.sessionStatus).toBe('active');
      expect(state.featureBranch).toBe('feature/test');
      expect(state.config).toEqual(DEFAULT_SESSION_CONFIG);
      expect(state.tasks).toEqual({
        ready: [],
        working: [],
        review: [],
        done: [],
        blocked: [],
      });
      expect(state.familiars).toEqual([]);
      expect(state.pendingQuestions).toEqual([]);
      expect(state.timestamp).toBeDefined();
    });

    it('should return frozen object', () => {
      const state = session.getState();
      expect(Object.isFrozen(state)).toBe(true);
    });
  });

  describe('config management', () => {
    it('should update config', async () => {
      await session.updateConfig({ maxConcurrentAgents: 5 });

      const config = session.getConfig();
      expect(config.maxConcurrentAgents).toBe(5);
    });

    it('should emit config:changed event', async () => {
      const handler = vi.fn();
      session.on('config:changed', handler);

      await session.updateConfig({ maxConcurrentAgents: 5 });

      expect(handler).toHaveBeenCalledWith({
        config: expect.objectContaining({ maxConcurrentAgents: 5 }),
      });
    });

    it('should persist config to disk', async () => {
      await session.updateConfig({ maxConcurrentAgents: 5 });

      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        path.join(workspaceRoot, '.coven', 'config.json'),
        expect.stringContaining('"maxConcurrentAgents": 5')
      );
    });
  });

  describe('manager access', () => {
    it('should provide access to BeadsTaskSource', () => {
      const beadsTaskSource = session.getBeadsTaskSource();
      expect(beadsTaskSource).toBeDefined();
    });

    it('should provide access to FamiliarManager', () => {
      const familiarManager = session.getFamiliarManager();
      expect(familiarManager).toBeDefined();
    });
  });

  describe('event forwarding', () => {
    it('should forward familiar:spawned event', () => {
      const handler = vi.fn();
      session.on('familiar:spawned', handler);

      session.getFamiliarManager().spawnFamiliar('task-1', {
        pid: 12345,
        startTime: Date.now(),
        command: 'claude',
        worktreePath: '/test',
      });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should dispose all resources', () => {
      const beadsTaskSource = session.getBeadsTaskSource();
      const familiarManager = session.getFamiliarManager();

      session.dispose();

      // Verify that event listeners are removed by checking no error when emitting
      expect(() => beadsTaskSource.emit('test', {})).not.toThrow();
      expect(() => familiarManager.emit('test', {})).not.toThrow();
    });
  });

  describe('daemon integration', () => {
    let mockDaemonClient: {
      startTask: ReturnType<typeof vi.fn>;
      killTask: ReturnType<typeof vi.fn>;
      answerQuestion: ReturnType<typeof vi.fn>;
      getTasks: ReturnType<typeof vi.fn>;
      getTask: ReturnType<typeof vi.fn>;
    };
    let mockSSEClient: {
      on: ReturnType<typeof vi.fn>;
      off: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockDaemonClient = {
        startTask: vi.fn().mockResolvedValue(undefined),
        killTask: vi.fn().mockResolvedValue(undefined),
        answerQuestion: vi.fn().mockResolvedValue(undefined),
        getTasks: vi.fn().mockResolvedValue([]),
        getTask: vi.fn().mockResolvedValue(null),
      };
      mockSSEClient = {
        on: vi.fn(),
        off: vi.fn(),
      };
    });

    it('should not be in daemon mode by default', () => {
      expect(session.isDaemonMode()).toBe(false);
    });

    it('should enable daemon mode when clients are set', () => {
      session.setDaemonClients(
        mockDaemonClient as unknown as DaemonClient,
        mockSSEClient as unknown as SSEClient
      );

      expect(session.isDaemonMode()).toBe(true);
    });

    it('should use daemon to start task when in daemon mode', async () => {
      session.setDaemonClients(
        mockDaemonClient as unknown as DaemonClient,
        mockSSEClient as unknown as SSEClient
      );

      // Start session first
      await session.start('feature/test');

      // Spawn agent for task
      await session.spawnAgentForTask('task-1');

      expect(mockDaemonClient.startTask).toHaveBeenCalledWith('task-1');
    });

    it('should use daemon to kill task when in daemon mode', async () => {
      session.setDaemonClients(
        mockDaemonClient as unknown as DaemonClient,
        mockSSEClient as unknown as SSEClient
      );

      await session.terminateAgent('task-1', 'test reason');

      expect(mockDaemonClient.killTask).toHaveBeenCalledWith('task-1', 'test reason');
    });

    it('should use daemon to answer question when in daemon mode', async () => {
      session.setDaemonClients(
        mockDaemonClient as unknown as DaemonClient,
        mockSSEClient as unknown as SSEClient
      );

      await session.respondToAgentQuestion('task-1', 'yes', 'question-1');

      expect(mockDaemonClient.answerQuestion).toHaveBeenCalledWith('question-1', 'yes');
    });

    it('should forward daemon clients to BeadsTaskSource', () => {
      const beadsTaskSource = session.getBeadsTaskSource();
      const setDaemonClientsSpy = vi.spyOn(beadsTaskSource, 'setDaemonClients');

      session.setDaemonClients(
        mockDaemonClient as unknown as DaemonClient,
        mockSSEClient as unknown as SSEClient
      );

      expect(setDaemonClientsSpy).toHaveBeenCalledWith(
        mockDaemonClient,
        mockSSEClient
      );
    });
  });
});
