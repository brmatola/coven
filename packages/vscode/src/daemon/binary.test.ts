import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BinaryManager, Platform } from './binary';

// Mock fs/promises
vi.mock('fs/promises');
const mockFs = vi.mocked(fs);

describe('BinaryManager', () => {
  const extensionPath = '/mock/extension';
  const bundledVersion = '1.2.3';
  const covenDir = '/mock/home/.coven';
  const binDir = path.join(covenDir, 'bin');

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createManager(version = bundledVersion): BinaryManager {
    return new BinaryManager({ extensionPath, bundledVersion: version, covenDir });
  }

  describe('getPlatform', () => {
    const originalPlatform = process.platform;
    const originalArch = process.arch;

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      Object.defineProperty(process, 'arch', { value: originalArch });
    });

    it('should detect darwin-arm64', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      Object.defineProperty(process, 'arch', { value: 'arm64' });
      expect(BinaryManager.getPlatform()).toBe('darwin-arm64');
    });

    it('should detect darwin-amd64 from x64', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      Object.defineProperty(process, 'arch', { value: 'x64' });
      expect(BinaryManager.getPlatform()).toBe('darwin-amd64');
    });

    it('should detect linux-amd64', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      Object.defineProperty(process, 'arch', { value: 'x64' });
      expect(BinaryManager.getPlatform()).toBe('linux-amd64');
    });

    it('should detect linux-arm64', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      Object.defineProperty(process, 'arch', { value: 'arm64' });
      expect(BinaryManager.getPlatform()).toBe('linux-arm64');
    });

    it('should throw for unsupported platform', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      Object.defineProperty(process, 'arch', { value: 'x64' });
      expect(() => BinaryManager.getPlatform()).toThrow('Unsupported platform');
    });
  });

  describe('getExtractedBinaryPath', () => {
    it('should return correct path', () => {
      const manager = createManager();
      expect(manager.getExtractedBinaryPath()).toBe(path.join(binDir, 'covend'));
    });
  });

  describe('getInstalledVersion', () => {
    it('should return version from file', async () => {
      mockFs.readFile.mockResolvedValue('1.0.0\n');
      const manager = createManager();
      const version = await manager.getInstalledVersion();
      expect(version).toBe('1.0.0');
      expect(mockFs.readFile).toHaveBeenCalledWith(
        path.join(binDir, '.version'),
        'utf-8'
      );
    });

    it('should return null if version file does not exist', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
      const manager = createManager();
      const version = await manager.getInstalledVersion();
      expect(version).toBeNull();
    });
  });

  describe('needsUpdate', () => {
    it('should return true if no installed version', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
      const manager = createManager();
      const needs = await manager.needsUpdate();
      expect(needs).toBe(true);
    });

    it('should return true if bundled is newer', async () => {
      // bundledVersion is 1.2.3
      mockFs.readFile.mockResolvedValue('1.1.0');
      const manager = createManager();
      const needs = await manager.needsUpdate();
      expect(needs).toBe(true);
    });

    it('should return false if versions are equal', async () => {
      mockFs.readFile.mockResolvedValue('1.2.3');
      const manager = createManager();
      const needs = await manager.needsUpdate();
      expect(needs).toBe(false);
    });

    it('should return false if installed is newer', async () => {
      mockFs.readFile.mockResolvedValue('2.0.0');
      const manager = createManager();
      const needs = await manager.needsUpdate();
      expect(needs).toBe(false);
    });

    it('should handle v-prefixed versions', async () => {
      const manager = new BinaryManager({
        extensionPath,
        bundledVersion: 'v1.2.3',
        covenDir,
      });
      mockFs.readFile.mockResolvedValue('v1.2.2');
      const needs = await manager.needsUpdate();
      expect(needs).toBe(true);
    });
  });

  describe('ensureBinary', () => {
    beforeEach(() => {
      vi.spyOn(BinaryManager, 'getPlatform').mockReturnValue('darwin-arm64' as Platform);
    });

    it('should extract binary if not exists', async () => {
      // Extracted binary doesn't exist, bundled does
      mockFs.stat.mockImplementation((p) => {
        const pathStr = p.toString();
        if (pathStr.includes('extension/bin/darwin-arm64')) {
          return Promise.resolve({ isFile: () => true } as fs.FileHandle['stat'] extends () => Promise<infer R> ? R : never);
        }
        return Promise.reject(new Error('ENOENT'));
      });
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.copyFile.mockResolvedValue(undefined);
      mockFs.chmod.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const manager = createManager();
      const binaryPath = await manager.ensureBinary();

      expect(binaryPath).toBe(path.join(binDir, 'covend'));
      expect(mockFs.mkdir).toHaveBeenCalledWith(binDir, { recursive: true });
      expect(mockFs.copyFile).toHaveBeenCalledWith(
        path.join(extensionPath, 'bin', 'darwin-arm64', 'covend'),
        path.join(binDir, 'covend')
      );
      expect(mockFs.chmod).toHaveBeenCalledWith(
        path.join(binDir, 'covend'),
        0o755
      );
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        path.join(binDir, '.version'),
        '1.2.3',
        'utf-8'
      );
    });

    it('should skip extraction if binary exists and is current', async () => {
      // Binary exists and is current version
      mockFs.stat.mockResolvedValue({ isFile: () => true } as fs.FileHandle['stat'] extends () => Promise<infer R> ? R : never);
      mockFs.readFile.mockResolvedValue('1.2.3');

      const manager = createManager();
      const binaryPath = await manager.ensureBinary();

      expect(binaryPath).toBe(path.join(binDir, 'covend'));
      expect(mockFs.copyFile).not.toHaveBeenCalled();
    });

    it('should update binary if bundled is newer', async () => {
      // Binary exists but older version
      mockFs.stat.mockResolvedValue({ isFile: () => true } as fs.FileHandle['stat'] extends () => Promise<infer R> ? R : never);
      mockFs.readFile.mockResolvedValue('1.0.0');
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.copyFile.mockResolvedValue(undefined);
      mockFs.chmod.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const manager = createManager();
      await manager.ensureBinary();

      expect(mockFs.copyFile).toHaveBeenCalled();
    });

    it('should throw if bundled binary is missing', async () => {
      // All stat calls fail - both extracted and bundled don't exist
      mockFs.stat.mockRejectedValue(new Error('ENOENT'));
      mockFs.mkdir.mockResolvedValue(undefined);

      const manager = createManager();
      await expect(manager.ensureBinary()).rejects.toThrow('Bundled binary not found');
    });

    it('should use override path when provided and exists', async () => {
      const overridePath = '/custom/path/to/covend';
      mockFs.stat.mockImplementation((p) => {
        if (p.toString() === overridePath) {
          return Promise.resolve({ isFile: () => true } as fs.FileHandle['stat'] extends () => Promise<infer R> ? R : never);
        }
        return Promise.reject(new Error('ENOENT'));
      });

      const manager = new BinaryManager({
        extensionPath,
        bundledVersion,
        covenDir,
        overridePath,
      });
      const binaryPath = await manager.ensureBinary();

      expect(binaryPath).toBe(overridePath);
      expect(mockFs.copyFile).not.toHaveBeenCalled();
    });

    it('should fall back to bundled when override path does not exist', async () => {
      const overridePath = '/nonexistent/covend';
      mockFs.stat.mockImplementation((p) => {
        const pathStr = p.toString();
        if (pathStr === overridePath) {
          return Promise.reject(new Error('ENOENT'));
        }
        if (pathStr.includes('extension/bin/darwin-arm64')) {
          return Promise.resolve({ isFile: () => true } as fs.FileHandle['stat'] extends () => Promise<infer R> ? R : never);
        }
        return Promise.reject(new Error('ENOENT'));
      });
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.copyFile.mockResolvedValue(undefined);
      mockFs.chmod.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const manager = new BinaryManager({
        extensionPath,
        bundledVersion,
        covenDir,
        overridePath,
      });
      const binaryPath = await manager.ensureBinary();

      expect(binaryPath).toBe(path.join(binDir, 'covend'));
      expect(mockFs.copyFile).toHaveBeenCalled();
    });
  });
});
