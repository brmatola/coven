import { EventEmitter } from 'events';
import { Task, ProcessInfo, SessionConfig, PendingQuestion } from '../shared/types';
import { FamiliarManager } from './FamiliarManager';
import { WorktreeManager } from '../git/WorktreeManager';
import { ClaudeAgent } from './ClaudeAgent';
import {
  AgentProvider,
  AgentHandle,
  AgentSpawnConfig,
  AgentOutput,
  AgentQuestion,
  AgentResult,
} from './types';
import { generateTaskPrompt, generateAutoAcceptPrompt } from './prompts';
import { getLogger } from '../shared/logger';

const logger = getLogger();

/**
 * Options for spawning an agent on a task.
 */
export interface SpawnOptions {
  /** Task to work on */
  task: Task;
  /** Feature branch for the session */
  featureBranch: string;
  /** Whether to run in auto-accept mode (no questions) */
  autoAccept?: boolean;
  /** Custom prompt override */
  prompt?: string;
}

/**
 * Events emitted by AgentOrchestrator.
 */
export interface AgentOrchestratorEvents {
  'agent:spawned': { taskId: string; worktreePath: string };
  'agent:output': { taskId: string; output: AgentOutput };
  'agent:question': { taskId: string; question: AgentQuestion };
  'agent:complete': { taskId: string; result: AgentResult };
  'agent:error': { taskId: string; error: Error };
}

/**
 * Orchestrates agent spawning with worktree isolation.
 * Combines FamiliarManager, WorktreeManager, and AgentProvider.
 */
export class AgentOrchestrator extends EventEmitter {
  private familiarManager: FamiliarManager;
  private worktreeManager: WorktreeManager;
  private agentProvider: AgentProvider;
  private agentHandles: Map<string, AgentHandle> = new Map();
  private config: SessionConfig;

  constructor(
    familiarManager: FamiliarManager,
    worktreeManager: WorktreeManager,
    agentProvider?: AgentProvider,
    config?: SessionConfig
  ) {
    super();
    this.familiarManager = familiarManager;
    this.worktreeManager = worktreeManager;
    this.agentProvider = agentProvider ?? new ClaudeAgent();
    this.config = config ?? ({
      maxConcurrentAgents: 3,
      agentTimeoutMs: 600000,
      agentPermissions: {
        allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash(git:*)', 'Bash(npm:*)'],
      },
    } as SessionConfig);
  }

  /**
   * Check if agent provider is available.
   */
  async isAvailable(): Promise<boolean> {
    return this.agentProvider.isAvailable();
  }

  /**
   * Spawn an agent to work on a task.
   * Creates worktree, spawns agent, and sets up event forwarding.
   */
  async spawnForTask(options: SpawnOptions): Promise<AgentHandle> {
    const { task, featureBranch, autoAccept = false, prompt } = options;
    const taskId = task.id;

    // Check if we can spawn
    if (!this.familiarManager.canSpawn()) {
      throw new Error('Maximum concurrent agents reached');
    }

    // Check if agent already running for this task
    if (this.agentHandles.has(taskId)) {
      throw new Error(`Agent already running for task: ${taskId}`);
    }

    logger.info('Spawning agent for task', { taskId, featureBranch });

    // Create worktree for the task
    const worktree = await this.worktreeManager.createForTask(taskId, featureBranch);

    try {
      // Build spawn config
      const spawnConfig: AgentSpawnConfig = {
        task,
        workingDirectory: worktree.path,
        featureBranch,
        prompt:
          prompt ||
          (autoAccept
            ? generateAutoAcceptPrompt(task.title, task.description || '', worktree.path)
            : generateTaskPrompt({
                task,
                featureBranch,
                allowQuestions: !autoAccept,
              })),
        allowedTools: this.config.agentPermissions?.allowedTools,
        callbacks: {
          onOutput: (output) => this.handleOutput(taskId, output),
          onQuestion: (question) => this.handleQuestion(taskId, question),
          onComplete: (result) => this.handleComplete(taskId, result),
          onError: (error) => this.handleError(taskId, error),
        },
      };

      // Spawn the agent
      const handle = await this.agentProvider.spawn(spawnConfig);
      this.agentHandles.set(taskId, handle);

      // Register with FamiliarManager
      const processInfo: ProcessInfo = {
        pid: handle.pid,
        startTime: Date.now(),
        command: 'claude',
        worktreePath: worktree.path,
      };
      this.familiarManager.spawnFamiliar(taskId, processInfo);

      this.emit('agent:spawned', { taskId, worktreePath: worktree.path });

      return handle;
    } catch (error) {
      // Clean up worktree on failure
      logger.error('Failed to spawn agent, cleaning up worktree', { taskId, error });
      await this.worktreeManager.cleanupForTask(taskId, true);
      throw error;
    }
  }

  /**
   * Respond to a question from an agent.
   */
  async respondToQuestion(taskId: string, response: string): Promise<void> {
    const handle = this.agentHandles.get(taskId);
    if (!handle) {
      throw new Error(`No agent running for task: ${taskId}`);
    }

    await handle.respond(response);
    this.familiarManager.answerQuestion(taskId);
  }

  /**
   * Terminate an agent for a task.
   */
  async terminateAgent(taskId: string, reason = 'user requested'): Promise<void> {
    const handle = this.agentHandles.get(taskId);
    if (!handle) {
      return;
    }

    await handle.terminate(reason);
    // Cleanup will happen in handleComplete
  }

  /**
   * Get the agent handle for a task.
   */
  getAgentHandle(taskId: string): AgentHandle | undefined {
    return this.agentHandles.get(taskId);
  }

  /**
   * Check if an agent is running for a task.
   */
  isAgentRunning(taskId: string): boolean {
    const handle = this.agentHandles.get(taskId);
    return handle?.isRunning() ?? false;
  }

  /**
   * Terminate all running agents.
   */
  async terminateAll(reason = 'shutdown'): Promise<void> {
    await this.agentProvider.terminateAll(reason);
    this.agentHandles.clear();
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.removeAllListeners();
    this.agentHandles.clear();
  }

  // ============================================================================
  // Private Handlers
  // ============================================================================

  private handleOutput(taskId: string, output: AgentOutput): void {
    // Forward to FamiliarManager
    this.familiarManager.addOutput(taskId, output.content);
    // Emit event
    this.emit('agent:output', { taskId, output });
  }

  private handleQuestion(taskId: string, question: AgentQuestion): void {
    // Add to FamiliarManager - only include options if defined
    const pendingQuestion: Omit<PendingQuestion, 'askedAt'> = {
      familiarId: taskId,
      taskId,
      question: question.question,
    };
    if (question.suggestedResponses) {
      pendingQuestion.options = question.suggestedResponses;
    }
    this.familiarManager.addQuestion(pendingQuestion);
    // Emit event
    this.emit('agent:question', { taskId, question });
  }

  private handleComplete(taskId: string, result: AgentResult): void {
    logger.info('Agent completed', { taskId, success: result.success });

    // Update familiar status
    const status = result.success ? 'complete' : 'failed';
    try {
      this.familiarManager.updateStatus(taskId, status);
    } catch {
      // Familiar might already be removed
    }

    // Remove handle
    this.agentHandles.delete(taskId);

    // Emit event
    this.emit('agent:complete', { taskId, result });

    // Auto-cleanup worktree on failure (success cleanup is manual after review)
    if (!result.success) {
      this.worktreeManager.cleanupForTask(taskId, true).catch((err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error('Failed to cleanup worktree after failure', { taskId, error: errorMsg });
      });
    }
  }

  private handleError(taskId: string, error: Error): void {
    logger.error('Agent error', { taskId, error: error.message });
    this.emit('agent:error', { taskId, error });
  }
}
