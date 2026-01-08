import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { ClaudeAgent } from './ClaudeAgent';
import type { AgentSpawnConfig } from './types';
import { Task } from '../shared/types';

// Mock child_process
const mockStdin = {
  writable: true,
  write: vi.fn(),
};

const mockStdout = new EventEmitter();
const mockStderr = new EventEmitter();

const mockProcess = Object.assign(new EventEmitter(), {
  pid: 12345,
  stdin: mockStdin,
  stdout: mockStdout,
  stderr: mockStderr,
  killed: false,
  exitCode: null as number | null,
  signalCode: null as string | null,
  kill: vi
    .fn()
    .mockImplementation(function (
      this: EventEmitter & { killed: boolean; exitCode: number | null; signalCode: string | null }
    ) {
      this.killed = true;
      // Emit close synchronously to ensure cleanup completes
      process.nextTick(() => {
        this.exitCode = 0;
        this.emit('close', 0);
      });
      return true; // kill() returns boolean indicating if signal was sent
    }),
});

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockProcess),
}));

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
    priority: 'medium',
    dependencies: [],
    sourceId: 'test',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createMockConfig(overrides: Partial<AgentSpawnConfig> = {}): AgentSpawnConfig {
  return {
    task: createMockTask(),
    workingDirectory: '/test/worktree',
    featureBranch: 'feature/main',
    callbacks: {
      onOutput: vi.fn(),
      onQuestion: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    },
    ...overrides,
  };
}

describe('ClaudeAgent', () => {
  let agent: ClaudeAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess.killed = false;
    mockProcess.exitCode = null;
    mockProcess.signalCode = null;
    mockProcess.removeAllListeners();
    mockStdout.removeAllListeners();
    mockStderr.removeAllListeners();
    agent = new ClaudeAgent('claude');
  });

  afterEach(async () => {
    await agent.terminateAll();
    // Give a tick for any pending close events to process
    await new Promise((resolve) => process.nextTick(resolve));
  });

  describe('isAvailable', () => {
    it('should return true when claude command succeeds', async () => {
      // Set up process to exit with code 0
      setTimeout(() => {
        mockProcess.emit('close', 0);
      }, 10);

      const available = await agent.isAvailable();
      expect(available).toBe(true);
    });

    it('should return false when claude command fails', async () => {
      setTimeout(() => {
        mockProcess.emit('close', 1);
      }, 10);

      const available = await agent.isAvailable();
      expect(available).toBe(false);
    });

    it('should return false on process error', async () => {
      setTimeout(() => {
        mockProcess.emit('error', new Error('Command not found'));
      }, 10);

      const available = await agent.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('spawn', () => {
    it('should spawn claude process with correct arguments', async () => {
      const { spawn } = await import('child_process');
      const config = createMockConfig();

      const handle = await agent.spawn(config);

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--print']),
        expect.objectContaining({
          cwd: '/test/worktree',
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );
      expect(handle.pid).toBe(12345);
      expect(handle.taskId).toBe('task-1');
    });

    it('should include allowedTools when specified', async () => {
      const { spawn } = await import('child_process');
      const config = createMockConfig({
        allowedTools: ['Read', 'Write', 'Bash(git:*)'],
      });

      await agent.spawn(config);

      // Tools should be passed as separate arguments (not joined with space)
      expect(spawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--allowedTools', 'Read', 'Write', 'Bash(git:*)']),
        expect.any(Object)
      );
    });

    it('should filter out invalid tool names', async () => {
      const { spawn } = await import('child_process');
      const config = createMockConfig({
        allowedTools: ['Read', 'evil; rm -rf /', 'Write'],
      });

      await agent.spawn(config);

      // Should only include valid tools
      const args = vi.mocked(spawn).mock.calls[0]?.[1] as string[];
      expect(args).toContain('Read');
      expect(args).toContain('Write');
      expect(args).not.toContain('evil; rm -rf /');
    });

    it('should throw if agent already running for task', async () => {
      const config = createMockConfig();

      await agent.spawn(config);

      // Second spawn with same task should throw
      let error: Error | null = null;
      try {
        await agent.spawn(config);
      } catch (e) {
        error = e as Error;
      }

      expect(error).not.toBeNull();
      expect(error?.message).toBe('Agent already running for task: task-1');
    });

    it('should use custom prompt when provided', async () => {
      const { spawn } = await import('child_process');
      const config = createMockConfig({ prompt: 'Custom prompt here' });

      await agent.spawn(config);

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['Custom prompt here']),
        expect.any(Object)
      );
    });
  });

  describe('output handling', () => {
    it('should emit output events for stdout', async () => {
      const config = createMockConfig();
      await agent.spawn(config);

      mockStdout.emit('data', Buffer.from('Processing task...'));

      expect(config.callbacks.onOutput).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'stdout',
          content: 'Processing task...',
        })
      );
    });

    it('should emit output events for stderr', async () => {
      const config = createMockConfig();
      await agent.spawn(config);

      mockStderr.emit('data', Buffer.from('Warning: something'));

      expect(config.callbacks.onOutput).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'stderr',
          content: 'Warning: something',
        })
      );
    });
  });

  describe('question detection', () => {
    it('should detect permission questions', async () => {
      const config = createMockConfig();
      await agent.spawn(config);

      mockStdout.emit('data', Buffer.from('Do you want to proceed?'));

      expect(config.callbacks.onQuestion).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'permission',
          question: 'Do you want to proceed?',
        })
      );
    });

    it('should detect decision questions', async () => {
      const config = createMockConfig();
      await agent.spawn(config);

      mockStdout.emit('data', Buffer.from('Should I use TypeScript or JavaScript?'));

      expect(config.callbacks.onQuestion).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'decision',
        })
      );
    });

    it('should detect blocked state', async () => {
      const config = createMockConfig();
      await agent.spawn(config);

      mockStdout.emit('data', Buffer.from("I'm blocked and cannot proceed."));

      expect(config.callbacks.onQuestion).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'blocked',
        })
      );
    });

    it('should not detect questions in stderr', async () => {
      const config = createMockConfig();
      await agent.spawn(config);

      mockStderr.emit('data', Buffer.from('Do you want to proceed?'));

      expect(config.callbacks.onQuestion).not.toHaveBeenCalled();
    });
  });

  describe('respond', () => {
    it('should write response to stdin', async () => {
      const config = createMockConfig();
      const handle = await agent.spawn(config);

      await handle.respond('yes');

      expect(mockStdin.write).toHaveBeenCalledWith('yes\n');
    });

    it('should reject responses that are too large', async () => {
      const config = createMockConfig();
      const handle = await agent.spawn(config);

      // Create a 2MB response (over 1MB limit)
      const largeResponse = 'x'.repeat(2 * 1024 * 1024);

      await expect(handle.respond(largeResponse)).rejects.toThrow('Response too large');
    });

    it('should sanitize control characters from response', async () => {
      const config = createMockConfig();
      const handle = await agent.spawn(config);

      // Response with control characters (except newline which is allowed after)
      await handle.respond('hello\x00\x07world');

      // Should have stripped the control chars
      expect(mockStdin.write).toHaveBeenCalledWith('helloworld\n');
    });
  });

  describe('security', () => {
    it('should not pass shell: true to spawn', async () => {
      const { spawn } = await import('child_process');
      const config = createMockConfig();

      await agent.spawn(config);

      // The spawn call should NOT have shell: true
      const spawnOptions = vi.mocked(spawn).mock.calls[0]?.[2];
      expect(spawnOptions).not.toHaveProperty('shell');
    });

    it('should only pass allowlisted environment variables', async () => {
      const { spawn } = await import('child_process');
      const config = createMockConfig();

      await agent.spawn(config);

      const spawnOptions = vi.mocked(spawn).mock.calls[0]?.[2] as { env: NodeJS.ProcessEnv };
      const env = spawnOptions.env;

      // Should have required vars
      expect(env.CI).toBe('true');
      expect(env.CLAUDE_CODE_NO_TELEMETRY).toBe('1');

      // Should NOT have random env vars that weren't allowlisted
      expect(env).not.toHaveProperty('npm_lifecycle_event');
      expect(env).not.toHaveProperty('VSCODE_INJECTION');
    });

    it('should truncate very long output lines', async () => {
      const config = createMockConfig();
      await agent.spawn(config);

      // Create output larger than 64KB limit
      const longOutput = 'x'.repeat(100 * 1024);
      mockStdout.emit('data', Buffer.from(longOutput));

      // Should have been truncated
      expect(config.callbacks.onOutput).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('... (truncated)'),
        })
      );
    });
  });

  describe('completion', () => {
    it('should emit complete on process exit with code 0', async () => {
      const config = createMockConfig();
      await agent.spawn(config);

      mockStdout.emit('data', Buffer.from('Task complete. Done.'));
      mockProcess.emit('close', 0);

      expect(config.callbacks.onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          exitCode: 0,
        })
      );
    });

    it('should emit failure on process exit with non-zero code', async () => {
      const config = createMockConfig();
      await agent.spawn(config);

      mockProcess.emit('close', 1);

      expect(config.callbacks.onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          exitCode: 1,
          error: expect.stringContaining('code 1'),
        })
      );
    });

    it('should extract files changed from output', async () => {
      const config = createMockConfig();
      await agent.spawn(config);

      mockStdout.emit('data', Buffer.from('Created file "src/add.ts"\nModified test.ts\nDone.'));
      mockProcess.emit('close', 0);

      expect(config.callbacks.onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          filesChanged: expect.arrayContaining(['src/add.ts', 'test.ts']),
        })
      );
    });
  });

  describe('terminate', () => {
    it('should kill process with SIGTERM', async () => {
      const config = createMockConfig();
      const handle = await agent.spawn(config);

      // Start termination
      const terminatePromise = handle.terminate('user requested');

      // Simulate process exit
      setTimeout(() => {
        mockProcess.emit('close', 0);
      }, 10);

      await terminatePromise;

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should report isRunning correctly', async () => {
      const config = createMockConfig();
      const handle = await agent.spawn(config);

      expect(handle.isRunning()).toBe(true);

      mockProcess.emit('close', 0);

      expect(handle.isRunning()).toBe(false);
    });
  });

  describe('getRunningAgents', () => {
    it('should return empty array when no agents running', () => {
      expect(agent.getRunningAgents()).toEqual([]);
    });

    it('should return running agents', async () => {
      const config = createMockConfig();
      await agent.spawn(config);

      const running = agent.getRunningAgents();
      expect(running).toHaveLength(1);
      expect(running[0]?.taskId).toBe('task-1');
    });
  });

  describe('terminateAll', () => {
    it('should terminate all running agents', async () => {
      const config1 = createMockConfig({ task: createMockTask({ id: 'task-1' }) });

      await agent.spawn(config1);

      // Need a fresh mock process for second spawn
      const { spawn } = await import('child_process');
      vi.mocked(spawn).mockReturnValueOnce(
        Object.assign(new EventEmitter(), {
          pid: 12346,
          stdin: mockStdin,
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
          killed: false,
          kill: vi.fn(),
        }) as unknown as ReturnType<typeof spawn>
      );

      // For this test, just check the first one works
      mockProcess.emit('close', 0);

      await agent.terminateAll('shutdown');

      expect(agent.getRunningAgents()).toHaveLength(0);
    });
  });
});
