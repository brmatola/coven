import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import { DaemonLifecycle, DaemonStartError } from './lifecycle';
import { BinaryManager } from './binary';
import { DaemonClient } from './client';
import { DaemonClientError } from './types';

// Mock modules
vi.mock('fs');
vi.mock('child_process');
vi.mock('./client');

const mockFs = vi.mocked(fs);
const mockSpawn = vi.mocked(child_process.spawn);
const MockDaemonClient = vi.mocked(DaemonClient);

describe('DaemonLifecycle', () => {
  const workspaceRoot = '/test/workspace';
  const socketPath = path.join(workspaceRoot, '.coven', 'covend.sock');
  const logPath = path.join(workspaceRoot, '.coven', 'covend.log');
  const binaryPath = '/mock/bin/covend';

  let mockBinaryManager: BinaryManager;
  let mockClientInstance: { getHealth: Mock };
  let mockChildProcess: { unref: Mock };

  beforeEach(() => {
    vi.resetAllMocks();

    // Mock BinaryManager
    mockBinaryManager = {
      ensureBinary: vi.fn().mockResolvedValue(binaryPath),
    } as unknown as BinaryManager;

    // Mock DaemonClient instance
    mockClientInstance = {
      getHealth: vi.fn(),
    };
    MockDaemonClient.mockImplementation(() => mockClientInstance as unknown as DaemonClient);

    // Mock child process
    mockChildProcess = { unref: vi.fn() };
    mockSpawn.mockReturnValue(mockChildProcess as unknown as child_process.ChildProcess);

    // Mock fs
    mockFs.existsSync.mockReturnValue(false);
    mockFs.mkdirSync.mockImplementation(() => undefined);
    mockFs.openSync.mockReturnValue(123);
    mockFs.closeSync.mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createLifecycle(options?: Partial<DaemonLifecycle>): DaemonLifecycle {
    return new DaemonLifecycle({
      binaryManager: mockBinaryManager,
      workspaceRoot,
      startTimeoutMs: 500, // Short timeout for tests
      pollIntervalMs: 50,
      ...options,
    });
  }

  describe('isRunning', () => {
    it('should return false if socket file does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const lifecycle = createLifecycle();

      const result = await lifecycle.isRunning();

      expect(result).toBe(false);
      expect(mockClientInstance.getHealth).not.toHaveBeenCalled();
    });

    it('should return true if health check succeeds', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockClientInstance.getHealth.mockResolvedValue({ status: 'ok', version: '1.0.0' });
      const lifecycle = createLifecycle();

      const result = await lifecycle.isRunning();

      expect(result).toBe(true);
      expect(mockClientInstance.getHealth).toHaveBeenCalled();
    });

    it('should return false if connection is refused', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockClientInstance.getHealth.mockRejectedValue(
        new DaemonClientError('connection_refused', 'Connection refused')
      );
      const lifecycle = createLifecycle();

      const result = await lifecycle.isRunning();

      expect(result).toBe(false);
    });

    it('should return false if socket not found', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockClientInstance.getHealth.mockRejectedValue(
        new DaemonClientError('socket_not_found', 'Socket not found')
      );
      const lifecycle = createLifecycle();

      const result = await lifecycle.isRunning();

      expect(result).toBe(false);
    });

    it('should return false if connection times out', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockClientInstance.getHealth.mockRejectedValue(
        new DaemonClientError('connection_timeout', 'Connection timed out')
      );
      const lifecycle = createLifecycle();

      const result = await lifecycle.isRunning();

      expect(result).toBe(false);
    });

    it('should return false on other errors', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockClientInstance.getHealth.mockRejectedValue(new Error('Unknown error'));
      const lifecycle = createLifecycle();

      const result = await lifecycle.isRunning();

      expect(result).toBe(false);
    });
  });

  describe('ensureRunning', () => {
    it('should return immediately if daemon is already running', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockClientInstance.getHealth.mockResolvedValue({ status: 'ok', version: '1.0.0' });
      const lifecycle = createLifecycle();

      await lifecycle.ensureRunning();

      expect(mockBinaryManager.ensureBinary).not.toHaveBeenCalled();
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should start daemon if not running', async () => {
      // First call: not running. After spawn: running
      let callCount = 0;
      mockFs.existsSync.mockImplementation((p) => {
        if (p.toString().includes('.sock')) {
          // After first check, socket exists
          return callCount++ > 0;
        }
        return false;
      });

      // After spawn, health check succeeds
      mockClientInstance.getHealth
        .mockRejectedValueOnce(new DaemonClientError('connection_refused', 'Connection refused'))
        .mockResolvedValue({ status: 'ok', version: '1.0.0' });

      const lifecycle = createLifecycle();

      await lifecycle.ensureRunning();

      expect(mockBinaryManager.ensureBinary).toHaveBeenCalled();
      expect(mockSpawn).toHaveBeenCalledWith(
        binaryPath,
        ['--workspace', workspaceRoot],
        expect.objectContaining({
          detached: true,
          cwd: workspaceRoot,
        })
      );
      expect(mockChildProcess.unref).toHaveBeenCalled();
    });

    it('should create .coven directory if it does not exist', async () => {
      mockFs.existsSync.mockImplementation((p) => {
        // .coven directory doesn't exist
        if (p.toString().includes('.coven') && !p.toString().includes('.sock')) {
          return false;
        }
        return false;
      });

      // After spawn, health check succeeds
      mockClientInstance.getHealth
        .mockRejectedValueOnce(new DaemonClientError('connection_refused', 'Connection refused'))
        .mockResolvedValue({ status: 'ok', version: '1.0.0' });

      const lifecycle = createLifecycle();

      // This will timeout because mock doesn't actually make socket available
      // Just verify directory creation is attempted
      try {
        await lifecycle.ensureRunning();
      } catch {
        // Expected to fail
      }

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        path.join(workspaceRoot, '.coven'),
        { recursive: true }
      );
    });

    it('should throw DaemonStartError if daemon fails to start within timeout', async () => {
      // Socket never becomes available
      mockFs.existsSync.mockReturnValue(false);

      const lifecycle = createLifecycle();

      await expect(lifecycle.ensureRunning()).rejects.toThrow(DaemonStartError);
      await expect(lifecycle.ensureRunning()).rejects.toMatchObject({
        logPath: logPath,
      });
    });
  });

  describe('getLogPath', () => {
    it('should return correct log path', () => {
      const lifecycle = createLifecycle();
      expect(lifecycle.getLogPath()).toBe(logPath);
    });
  });

  describe('getSocketPath', () => {
    it('should return absolute socket path', () => {
      const lifecycle = createLifecycle();
      expect(lifecycle.getSocketPath()).toBe(socketPath);
    });
  });

  describe('spawn options', () => {
    it('should spawn with correct stdio for logging', async () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.openSync.mockReturnValue(42);

      const lifecycle = createLifecycle();

      try {
        await lifecycle.ensureRunning();
      } catch {
        // Expected to fail
      }

      expect(mockFs.openSync).toHaveBeenCalledWith(logPath, 'a');
      expect(mockSpawn).toHaveBeenCalledWith(
        binaryPath,
        ['--workspace', workspaceRoot],
        expect.objectContaining({
          stdio: ['ignore', 42, 42],
        })
      );
      expect(mockFs.closeSync).toHaveBeenCalledWith(42);
    });

    it('should pass COVEN_WORKSPACE env variable', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const lifecycle = createLifecycle();

      try {
        await lifecycle.ensureRunning();
      } catch {
        // Expected to fail
      }

      expect(mockSpawn).toHaveBeenCalledWith(
        binaryPath,
        ['--workspace', workspaceRoot],
        expect.objectContaining({
          env: expect.objectContaining({
            COVEN_WORKSPACE: workspaceRoot,
          }),
        })
      );
    });
  });
});
