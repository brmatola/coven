import { describe, it, expect, vi, beforeEach } from 'vitest';
import { window } from 'vscode';
import { getLogger, disposeLogger, LogLevel } from './logger';

describe('Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disposeLogger();
  });

  describe('getLogger()', () => {
    it('returns the same instance on multiple calls', () => {
      const logger1 = getLogger();
      const logger2 = getLogger();

      expect(logger1).toBe(logger2);
    });

    it('creates output channel with name "Coven"', () => {
      getLogger();

      expect(window.createOutputChannel).toHaveBeenCalledWith('Coven');
    });

    it('returns new instance after disposeLogger()', () => {
      const logger1 = getLogger();
      disposeLogger();
      const logger2 = getLogger();

      expect(logger1).not.toBe(logger2);
      expect(window.createOutputChannel).toHaveBeenCalledTimes(2);
    });
  });

  describe('log levels', () => {
    it('logs info messages by default', () => {
      const logger = getLogger();
      const mockChannel = (window.createOutputChannel as ReturnType<typeof vi.fn>).mock
        .results[0]?.value as { appendLine: ReturnType<typeof vi.fn> };

      logger.info('test message');

      expect(mockChannel.appendLine).toHaveBeenCalled();
      const logLine = mockChannel.appendLine.mock.calls[0]?.[0] as string;
      expect(logLine).toContain('[INFO]');
      expect(logLine).toContain('test message');
    });

    it('does not log debug messages at default INFO level', () => {
      const logger = getLogger();
      const mockChannel = (window.createOutputChannel as ReturnType<typeof vi.fn>).mock
        .results[0]?.value as { appendLine: ReturnType<typeof vi.fn> };

      logger.debug('debug message');

      expect(mockChannel.appendLine).not.toHaveBeenCalled();
    });

    it('logs debug messages when level is set to DEBUG', () => {
      const logger = getLogger();
      const mockChannel = (window.createOutputChannel as ReturnType<typeof vi.fn>).mock
        .results[0]?.value as { appendLine: ReturnType<typeof vi.fn> };

      logger.setLevel(LogLevel.DEBUG);
      logger.debug('debug message');

      expect(mockChannel.appendLine).toHaveBeenCalled();
      const logLine = mockChannel.appendLine.mock.calls[0]?.[0] as string;
      expect(logLine).toContain('[DEBUG]');
    });

    it('logs warn messages', () => {
      const logger = getLogger();
      const mockChannel = (window.createOutputChannel as ReturnType<typeof vi.fn>).mock
        .results[0]?.value as { appendLine: ReturnType<typeof vi.fn> };

      logger.warn('warning');

      const logLine = mockChannel.appendLine.mock.calls[0]?.[0] as string;
      expect(logLine).toContain('[WARN]');
    });

    it('logs error messages', () => {
      const logger = getLogger();
      const mockChannel = (window.createOutputChannel as ReturnType<typeof vi.fn>).mock
        .results[0]?.value as { appendLine: ReturnType<typeof vi.fn> };

      logger.error('error occurred');

      const logLine = mockChannel.appendLine.mock.calls[0]?.[0] as string;
      expect(logLine).toContain('[ERROR]');
    });

    it('does not log info when level is ERROR', () => {
      const logger = getLogger();
      const mockChannel = (window.createOutputChannel as ReturnType<typeof vi.fn>).mock
        .results[0]?.value as { appendLine: ReturnType<typeof vi.fn> };

      logger.setLevel(LogLevel.ERROR);
      logger.info('info message');
      logger.warn('warn message');

      expect(mockChannel.appendLine).not.toHaveBeenCalled();
    });
  });

  describe('message formatting', () => {
    it('includes timestamp in log output', () => {
      const logger = getLogger();
      const mockChannel = (window.createOutputChannel as ReturnType<typeof vi.fn>).mock
        .results[0]?.value as { appendLine: ReturnType<typeof vi.fn> };

      logger.info('test');

      const logLine = mockChannel.appendLine.mock.calls[0]?.[0] as string;
      // ISO timestamp format: 2024-01-01T00:00:00.000Z
      expect(logLine).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\]/);
    });

    it('includes additional arguments as JSON', () => {
      const logger = getLogger();
      const mockChannel = (window.createOutputChannel as ReturnType<typeof vi.fn>).mock
        .results[0]?.value as { appendLine: ReturnType<typeof vi.fn> };

      logger.info('user action', { userId: 123, action: 'click' });

      const logLine = mockChannel.appendLine.mock.calls[0]?.[0] as string;
      expect(logLine).toContain('user action');
      expect(logLine).toContain('"userId":123');
      expect(logLine).toContain('"action":"click"');
    });

    it('handles messages with no additional arguments', () => {
      const logger = getLogger();
      const mockChannel = (window.createOutputChannel as ReturnType<typeof vi.fn>).mock
        .results[0]?.value as { appendLine: ReturnType<typeof vi.fn> };

      logger.info('simple message');

      const logLine = mockChannel.appendLine.mock.calls[0]?.[0] as string;
      expect(logLine).toContain('simple message');
      expect(logLine).not.toContain('[]');
    });
  });

  describe('disposeLogger()', () => {
    it('disposes the output channel', () => {
      getLogger();
      const mockChannel = (window.createOutputChannel as ReturnType<typeof vi.fn>).mock
        .results[0]?.value as { dispose: ReturnType<typeof vi.fn> };

      disposeLogger();

      expect(mockChannel.dispose).toHaveBeenCalled();
    });

    it('does not throw when called multiple times', () => {
      getLogger();
      disposeLogger();

      expect(() => disposeLogger()).not.toThrow();
    });
  });
});
