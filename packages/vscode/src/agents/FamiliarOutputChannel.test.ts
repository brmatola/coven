import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { FamiliarOutputChannel } from './FamiliarOutputChannel';
import { DaemonClient } from '../daemon/client';
import { SSEClient, SSEEvent } from '../daemon/sse';
import { EventEmitter } from 'events';

// Mock daemon client
vi.mock('../daemon/client', () => ({
  DaemonClient: vi.fn().mockImplementation(() => ({
    getAgentOutput: vi.fn(),
  })),
}));

describe('FamiliarOutputChannel', () => {
  let mockDaemonClient: { getAgentOutput: ReturnType<typeof vi.fn> };
  let mockSSEClient: EventEmitter & { connectionState: string };
  let outputChannel: FamiliarOutputChannel;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDaemonClient = {
      getAgentOutput: vi.fn(),
    };

    mockSSEClient = Object.assign(new EventEmitter(), {
      connectionState: 'connected',
    });

    outputChannel = new FamiliarOutputChannel(
      mockDaemonClient as unknown as DaemonClient,
      mockSSEClient as unknown as SSEClient
    );
  });

  afterEach(() => {
    outputChannel.dispose();
  });

  describe('initialization', () => {
    it('should subscribe to SSE events on initialize', () => {
      outputChannel.initialize();
      expect(mockSSEClient.listenerCount('event')).toBe(1);
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

    it('should return null for active task ID when no agent is active', () => {
      expect(outputChannel.getActiveTaskId()).toBe(null);
    });

    it('should return null for active agent ID when no agent is active', () => {
      expect(outputChannel.getActiveAgentId()).toBe(null);
    });
  });

  describe('output handling', () => {
    it('should append content without timestamp', () => {
      const channel = outputChannel.getOrCreateChannel('task-123');
      outputChannel.append('task-123', 'Raw content');

      expect(channel.append).toHaveBeenCalledWith('Raw content');
    });

    it('should append line with timestamp', () => {
      const channel = outputChannel.getOrCreateChannel('task-123');
      outputChannel.appendLine('task-123', 'Test output');

      expect(channel.appendLine).toHaveBeenCalledWith(
        expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] Test output$/)
      );
    });
  });

  describe('fetch history', () => {
    it('should fetch and display historical output', async () => {
      mockDaemonClient.getAgentOutput.mockResolvedValue({
        taskId: 'task-123',
        output: ['Line 1', 'Line 2', 'Line 3'],
        totalLines: 3,
      });

      const channel = outputChannel.getOrCreateChannel('task-123');
      await outputChannel.fetchHistory('task-123');

      expect(mockDaemonClient.getAgentOutput).toHaveBeenCalledWith('task-123');
      expect(channel.clear).toHaveBeenCalled();
      expect(channel.appendLine).toHaveBeenCalledWith('Line 1');
      expect(channel.appendLine).toHaveBeenCalledWith('Line 2');
      expect(channel.appendLine).toHaveBeenCalledWith('Line 3');
    });

    it('should handle fetch history errors gracefully', async () => {
      mockDaemonClient.getAgentOutput.mockRejectedValue(new Error('Agent not found'));

      await expect(outputChannel.fetchHistory('task-123')).resolves.not.toThrow();
    });
  });

  describe('SSE event handling', () => {
    beforeEach(() => {
      outputChannel.initialize();
    });

    describe('agent.spawned event', () => {
      it('should create channel and show it when agent spawned', () => {
        const event: SSEEvent = {
          type: 'agent.spawned',
          data: { agentId: 'agent-1', taskId: 'task-123' },
          timestamp: Date.now(),
        };

        mockSSEClient.emit('event', event);

        expect(outputChannel.hasChannel('task-123')).toBe(true);
        expect(outputChannel.getActiveAgentId()).toBe('agent-1');
        expect(outputChannel.getActiveTaskId()).toBe('task-123');
      });

      it('should clear and show channel on agent spawn', () => {
        const channel = outputChannel.getOrCreateChannel('task-123');
        vi.clearAllMocks();

        const event: SSEEvent = {
          type: 'agent.spawned',
          data: { agentId: 'agent-1', taskId: 'task-123' },
          timestamp: Date.now(),
        };

        mockSSEClient.emit('event', event);

        expect(channel.clear).toHaveBeenCalled();
        expect(channel.show).toHaveBeenCalled();
      });

      it('should append start message when agent spawned', () => {
        const event: SSEEvent = {
          type: 'agent.spawned',
          data: { agentId: 'agent-1', taskId: 'task-123' },
          timestamp: Date.now(),
        };

        mockSSEClient.emit('event', event);

        const channel = outputChannel.getOrCreateChannel('task-123');
        expect(channel.appendLine).toHaveBeenCalledWith(
          expect.stringContaining('--- Agent started ---')
        );
      });
    });

    describe('agent.output event', () => {
      it('should append output to channel when task has channel', () => {
        outputChannel.getOrCreateChannel('task-123');

        const event: SSEEvent = {
          type: 'agent.output',
          data: { agentId: 'agent-1', taskId: 'task-123', chunk: 'Hello world' },
          timestamp: Date.now(),
        };

        mockSSEClient.emit('event', event);

        const channel = outputChannel.getOrCreateChannel('task-123');
        expect(channel.append).toHaveBeenCalledWith('Hello world');
      });

      it('should append output using active agent if no direct task channel', () => {
        // First spawn an agent to set active agent
        const spawnEvent: SSEEvent = {
          type: 'agent.spawned',
          data: { agentId: 'agent-1', taskId: 'task-123' },
          timestamp: Date.now(),
        };
        mockSSEClient.emit('event', spawnEvent);

        const channel = outputChannel.getOrCreateChannel('task-123');
        vi.clearAllMocks();

        // Now emit output without taskId (will use activeTaskId)
        const outputEvent: SSEEvent = {
          type: 'agent.output',
          data: { agentId: 'agent-1', taskId: '', chunk: 'Output' },
          timestamp: Date.now(),
        };

        mockSSEClient.emit('event', outputEvent);

        // Should use activeTaskId lookup
        expect(channel.append).toHaveBeenCalledWith('Output');
      });

      it('should ignore output for unknown agent/task', () => {
        const event: SSEEvent = {
          type: 'agent.output',
          data: { agentId: 'unknown', taskId: '', chunk: 'Hello' },
          timestamp: Date.now(),
        };

        mockSSEClient.emit('event', event);

        // No channel should be created
        expect(vscode.window.createOutputChannel).not.toHaveBeenCalled();
      });
    });

    describe('agent.completed event', () => {
      it('should append completion message to channel', () => {
        outputChannel.getOrCreateChannel('task-123');

        const event: SSEEvent = {
          type: 'agent.completed',
          data: { agentId: 'agent-1', taskId: 'task-123', exitCode: 0 },
          timestamp: Date.now(),
        };

        mockSSEClient.emit('event', event);

        const channel = outputChannel.getOrCreateChannel('task-123');
        expect(channel.appendLine).toHaveBeenCalledWith(
          expect.stringContaining('--- Agent completed (exit code: 0) ---')
        );
      });

      it('should clear active agent on completion', () => {
        // Spawn first
        const spawnEvent: SSEEvent = {
          type: 'agent.spawned',
          data: { agentId: 'agent-1', taskId: 'task-123' },
          timestamp: Date.now(),
        };
        mockSSEClient.emit('event', spawnEvent);

        expect(outputChannel.getActiveAgentId()).toBe('agent-1');

        // Complete
        const completeEvent: SSEEvent = {
          type: 'agent.completed',
          data: { agentId: 'agent-1', taskId: 'task-123', exitCode: 0 },
          timestamp: Date.now(),
        };
        mockSSEClient.emit('event', completeEvent);

        expect(outputChannel.getActiveAgentId()).toBe(null);
        expect(outputChannel.getActiveTaskId()).toBe(null);
      });

      it('should use activeTaskId when taskId not in event', () => {
        // Spawn first
        const spawnEvent: SSEEvent = {
          type: 'agent.spawned',
          data: { agentId: 'agent-1', taskId: 'task-123' },
          timestamp: Date.now(),
        };
        mockSSEClient.emit('event', spawnEvent);

        const channel = outputChannel.getOrCreateChannel('task-123');
        vi.clearAllMocks();

        // Complete without taskId
        const completeEvent: SSEEvent = {
          type: 'agent.completed',
          data: { agentId: 'agent-1', taskId: '', exitCode: 0 },
          timestamp: Date.now(),
        };
        mockSSEClient.emit('event', completeEvent);

        expect(channel.appendLine).toHaveBeenCalledWith(
          expect.stringContaining('--- Agent completed (exit code: 0) ---')
        );
      });
    });

    describe('agent.failed event', () => {
      it('should append failure message to channel', () => {
        outputChannel.getOrCreateChannel('task-123');

        const event: SSEEvent = {
          type: 'agent.failed',
          data: { agentId: 'agent-1', taskId: 'task-123', error: 'Process crashed' },
          timestamp: Date.now(),
        };

        mockSSEClient.emit('event', event);

        const channel = outputChannel.getOrCreateChannel('task-123');
        expect(channel.appendLine).toHaveBeenCalledWith(
          expect.stringContaining('--- Agent failed: Process crashed ---')
        );
      });

      it('should clear active agent on failure', () => {
        // Spawn first
        const spawnEvent: SSEEvent = {
          type: 'agent.spawned',
          data: { agentId: 'agent-1', taskId: 'task-123' },
          timestamp: Date.now(),
        };
        mockSSEClient.emit('event', spawnEvent);

        expect(outputChannel.getActiveAgentId()).toBe('agent-1');

        // Fail
        const failEvent: SSEEvent = {
          type: 'agent.failed',
          data: { agentId: 'agent-1', taskId: 'task-123', error: 'Error' },
          timestamp: Date.now(),
        };
        mockSSEClient.emit('event', failEvent);

        expect(outputChannel.getActiveAgentId()).toBe(null);
        expect(outputChannel.getActiveTaskId()).toBe(null);
      });

      it('should use activeTaskId when taskId not in event', () => {
        // Spawn first
        const spawnEvent: SSEEvent = {
          type: 'agent.spawned',
          data: { agentId: 'agent-1', taskId: 'task-123' },
          timestamp: Date.now(),
        };
        mockSSEClient.emit('event', spawnEvent);

        const channel = outputChannel.getOrCreateChannel('task-123');
        vi.clearAllMocks();

        // Fail without taskId
        const failEvent: SSEEvent = {
          type: 'agent.failed',
          data: { agentId: 'agent-1', taskId: '', error: 'Timeout' },
          timestamp: Date.now(),
        };
        mockSSEClient.emit('event', failEvent);

        expect(channel.appendLine).toHaveBeenCalledWith(
          expect.stringContaining('--- Agent failed: Timeout ---')
        );
      });
    });

    describe('unhandled events', () => {
      it('should ignore unknown event types', () => {
        const event: SSEEvent = {
          type: 'workflow.started',
          data: { id: 'workflow-1' },
          timestamp: Date.now(),
        };

        expect(() => mockSSEClient.emit('event', event)).not.toThrow();
      });
    });
  });

  describe('dispose channel with active agent', () => {
    beforeEach(() => {
      outputChannel.initialize();
    });

    it('should clear active agent when disposing its channel', () => {
      const spawnEvent: SSEEvent = {
        type: 'agent.spawned',
        data: { agentId: 'agent-1', taskId: 'task-123' },
        timestamp: Date.now(),
      };
      mockSSEClient.emit('event', spawnEvent);

      expect(outputChannel.getActiveAgentId()).toBe('agent-1');
      expect(outputChannel.getActiveTaskId()).toBe('task-123');

      outputChannel.disposeChannel('task-123');

      expect(outputChannel.getActiveAgentId()).toBe(null);
      expect(outputChannel.getActiveTaskId()).toBe(null);
    });
  });

  describe('dispose', () => {
    beforeEach(() => {
      outputChannel.initialize();
    });

    it('should dispose all channels', () => {
      const channel1 = outputChannel.getOrCreateChannel('task-1');
      const channel2 = outputChannel.getOrCreateChannel('task-2');

      outputChannel.dispose();

      expect(channel1.dispose).toHaveBeenCalled();
      expect(channel2.dispose).toHaveBeenCalled();
    });

    it('should unsubscribe from events', () => {
      outputChannel.dispose();

      expect(mockSSEClient.listenerCount('event')).toBe(0);
    });

    it('should clear active agent state', () => {
      const spawnEvent: SSEEvent = {
        type: 'agent.spawned',
        data: { agentId: 'agent-1', taskId: 'task-123' },
        timestamp: Date.now(),
      };
      mockSSEClient.emit('event', spawnEvent);

      outputChannel.dispose();

      expect(outputChannel.getActiveAgentId()).toBe(null);
      expect(outputChannel.getActiveTaskId()).toBe(null);
    });

    it('should not throw when disposing twice', () => {
      outputChannel.dispose();
      expect(() => outputChannel.dispose()).not.toThrow();
    });

    it('should not receive events after dispose', () => {
      outputChannel.dispose();

      const event: SSEEvent = {
        type: 'agent.spawned',
        data: { agentId: 'agent-1', taskId: 'task-123' },
        timestamp: Date.now(),
      };

      mockSSEClient.emit('event', event);

      expect(outputChannel.hasChannel('task-123')).toBe(false);
    });
  });
});
