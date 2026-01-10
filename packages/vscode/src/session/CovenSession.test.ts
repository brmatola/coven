import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CovenSession } from './CovenSession';
import { DEFAULT_SESSION_CONFIG } from '../shared/types';
import { DaemonClient } from '../daemon/client';
import { SSEClient } from '../daemon/sse';

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

// Mock logger
vi.mock('../shared/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock BeadsTaskSource since it's created internally with daemon
vi.mock('../tasks/BeadsTaskSource', () => ({
  BeadsTaskSource: vi.fn().mockImplementation(() => ({
    isAvailable: vi.fn().mockResolvedValue(true),
    fetchTasks: vi.fn().mockResolvedValue([]),
    sync: vi.fn().mockResolvedValue(undefined),
    watch: vi.fn(),
    stopWatch: vi.fn(),
    dispose: vi.fn(),
    getTasksGroupedByStatus: vi.fn().mockReturnValue({
      ready: [],
      working: [],
      review: [],
      done: [],
      blocked: [],
    }),
    on: vi.fn(),
    emit: vi.fn(),
    removeAllListeners: vi.fn(),
  })),
}));

// Mock FamiliarManager
vi.mock('../agents/FamiliarManager', () => ({
  FamiliarManager: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    getAllFamiliars: vi.fn().mockReturnValue([]),
    getPendingQuestions: vi.fn().mockReturnValue([]),
    clear: vi.fn(),
    dispose: vi.fn(),
    spawnFamiliar: vi.fn(),
    on: vi.fn(),
    emit: vi.fn(),
    removeAllListeners: vi.fn(),
  })),
}));

describe('CovenSession', () => {
  let session: CovenSession;
  const workspaceRoot = '/test/workspace';
  let mockDaemonClient: {
    getHealth: ReturnType<typeof vi.fn>;
    startSession: ReturnType<typeof vi.fn>;
    stopSession: ReturnType<typeof vi.fn>;
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

  beforeEach(async () => {
    vi.clearAllMocks();

    mockDaemonClient = {
      getHealth: vi.fn().mockResolvedValue({ status: 'ok' }),
      startSession: vi.fn().mockResolvedValue(undefined),
      stopSession: vi.fn().mockResolvedValue(undefined),
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

    session = new CovenSession(
      mockDaemonClient as unknown as DaemonClient,
      mockSSEClient as unknown as SSEClient,
      workspaceRoot
    );
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

      const newSession = new CovenSession(
        mockDaemonClient as unknown as DaemonClient,
        mockSSEClient as unknown as SSEClient,
        workspaceRoot
      );
      await newSession.initialize();

      expect(newSession.getStatus()).toBe('active');
      expect(newSession.getFeatureBranch()).toBe('feature/test');

      newSession.dispose();
    });

    it('should set up SSE event handler on construction', () => {
      expect(mockSSEClient.on).toHaveBeenCalledWith('event', expect.any(Function));
    });
  });

  describe('start', () => {
    it('should start a session via daemon', async () => {
      await session.start('feature/test');

      expect(mockDaemonClient.startSession).toHaveBeenCalledWith({ branch: 'feature/test' });
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

    it('should revert status if daemon start fails', async () => {
      mockDaemonClient.startSession.mockRejectedValueOnce(new Error('Daemon error'));

      await expect(session.start('feature/test')).rejects.toThrow('Daemon error');
      expect(session.getStatus()).toBe('inactive');
      expect(session.getFeatureBranch()).toBeNull();
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
    it('should stop an active session via daemon', async () => {
      await session.start('feature/test');
      await session.stop();

      expect(mockDaemonClient.stopSession).toHaveBeenCalled();
      expect(session.getStatus()).toBe('inactive');
      expect(session.getFeatureBranch()).toBeNull();
      expect(session.isActive()).toBe(false);
    });

    it('should stop a paused session', async () => {
      await session.start('feature/test');
      await session.pause();
      await session.stop();

      expect(mockDaemonClient.stopSession).toHaveBeenCalled();
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

      expect(mockDaemonClient.stopSession).not.toHaveBeenCalled();
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

    it('should provide access to DaemonClient', () => {
      const daemonClient = session.getDaemonClient();
      expect(daemonClient).toBe(mockDaemonClient);
    });

    it('should provide access to SSEClient', () => {
      const sseClient = session.getSSEClient();
      expect(sseClient).toBe(mockSSEClient);
    });
  });

  describe('daemon operations', () => {
    it('should use daemon to start task', async () => {
      await session.start('feature/test');
      await session.spawnAgentForTask('task-1');

      expect(mockDaemonClient.startTask).toHaveBeenCalledWith('task-1');
    });

    it('should throw if spawning agent when session not active', async () => {
      await expect(session.spawnAgentForTask('task-1')).rejects.toThrow(
        'Cannot spawn agent: session not active'
      );
    });

    it('should use daemon to kill task', async () => {
      await session.terminateAgent('task-1', 'test reason');

      expect(mockDaemonClient.killTask).toHaveBeenCalledWith('task-1', 'test reason');
    });

    it('should use daemon to answer question', async () => {
      await session.respondToAgentQuestion('question-1', 'yes');

      expect(mockDaemonClient.answerQuestion).toHaveBeenCalledWith('question-1', 'yes');
    });

    it('should check daemon availability', async () => {
      const available = await session.isDaemonAvailable();
      expect(available).toBe(true);
    });
  });

  describe('dispose', () => {
    it('should dispose all resources', () => {
      session.dispose();

      // Verify SSE handler is removed
      expect(mockSSEClient.off).toHaveBeenCalledWith('event', expect.any(Function));
    });
  });
});
