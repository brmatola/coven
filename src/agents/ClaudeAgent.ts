import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
  AgentProvider,
  AgentSpawnConfig,
  AgentHandle,
  AgentOutput,
  AgentQuestion,
  AgentQuestionType,
  AgentResult,
} from './types';
import { getLogger } from '../shared/logger';

const logger = getLogger();

/**
 * Grace period for graceful termination before SIGKILL.
 */
const TERMINATION_GRACE_MS = 5000;

/**
 * Question detection patterns.
 */
const QUESTION_PATTERNS = [
  // Claude Code permission prompts
  { pattern: /Do you want to proceed\?/i, type: 'permission' as AgentQuestionType },
  { pattern: /May I\s/i, type: 'permission' as AgentQuestionType },
  { pattern: /Should I\s/i, type: 'decision' as AgentQuestionType },
  { pattern: /Would you like\s/i, type: 'decision' as AgentQuestionType },
  // Clarification
  { pattern: /Can you clarify/i, type: 'clarification' as AgentQuestionType },
  { pattern: /What do you mean/i, type: 'clarification' as AgentQuestionType },
  { pattern: /Could you explain/i, type: 'clarification' as AgentQuestionType },
  // Blocked
  { pattern: /I'm blocked/i, type: 'blocked' as AgentQuestionType },
  { pattern: /I cannot proceed/i, type: 'blocked' as AgentQuestionType },
  { pattern: /I need more information/i, type: 'blocked' as AgentQuestionType },
  // Generic question detection (ends with ?)
  { pattern: /\?[\s]*$/m, type: 'clarification' as AgentQuestionType },
];

/**
 * Completion detection patterns.
 */
const COMPLETION_PATTERNS = [
  /Task complete/i,
  /I've completed/i,
  /Implementation complete/i,
  /Done\.?$/m,
  /Finished\.?$/m,
];

/**
 * Internal state for a running agent.
 */
interface RunningAgent {
  handle: AgentHandle;
  process: ChildProcess;
  config: AgentSpawnConfig;
  startTime: number;
  outputBuffer: string[];
  pendingQuestion: AgentQuestion | null;
}

/**
 * Claude Code CLI agent provider.
 * Spawns Claude Code processes and manages their lifecycle.
 */
export class ClaudeAgent extends EventEmitter implements AgentProvider {
  readonly name = 'claude';

  private runningAgents: Map<string, RunningAgent> = new Map();
  private claudeCommand: string;

  constructor(claudeCommand = 'claude') {
    super();
    this.claudeCommand = claudeCommand;
  }

  /**
   * Check if Claude Code CLI is available.
   */
  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this.claudeCommand, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });

      let resolved = false;
      const finish = (available: boolean): void => {
        if (!resolved) {
          resolved = true;
          resolve(available);
        }
      };

      proc.on('error', () => finish(false));
      proc.on('close', (code) => finish(code === 0));

      // Timeout after 5 seconds
      setTimeout(() => finish(false), 5000);
    });
  }

  /**
   * Spawn a Claude agent for a task.
   */
  spawn(config: AgentSpawnConfig): Promise<AgentHandle> {
    const taskId = config.task.id;

    if (this.runningAgents.has(taskId)) {
      throw new Error(`Agent already running for task: ${taskId}`);
    }

    logger.info('Spawning Claude agent', { taskId, workingDirectory: config.workingDirectory });

    // Build the claude command arguments
    const args = this.buildArgs(config);

    // Spawn the process
    const proc = spawn(this.claudeCommand, args, {
      cwd: config.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: {
        ...process.env,
        // Disable interactive prompts where possible
        CI: 'true',
        CLAUDE_CODE_NO_TELEMETRY: '1',
      },
    });

    // Create handle
    const handle = this.createHandle(taskId, proc);

    // Create running agent record
    const runningAgent: RunningAgent = {
      handle,
      process: proc,
      config,
      startTime: Date.now(),
      outputBuffer: [],
      pendingQuestion: null,
    };

    this.runningAgents.set(taskId, runningAgent);

    // Set up output handlers
    this.setupOutputHandlers(runningAgent);

    // Set up exit handler
    this.setupExitHandler(runningAgent);

    return handle;
  }

  /**
   * Get all currently running agents.
   */
  getRunningAgents(): AgentHandle[] {
    return Array.from(this.runningAgents.values()).map((a) => a.handle);
  }

  /**
   * Terminate all running agents.
   */
  async terminateAll(reason = 'shutdown'): Promise<void> {
    const promises = Array.from(this.runningAgents.values()).map((agent) =>
      agent.handle.terminate(reason)
    );
    await Promise.all(promises);
  }

  /**
   * Build command arguments for claude CLI.
   */
  private buildArgs(config: AgentSpawnConfig): string[] {
    const args: string[] = [];

    // Use the prompt from config or generate from task
    const prompt = config.prompt || this.generatePrompt(config);

    // Pass prompt via argument
    args.push('--print'); // Print output without interactive mode
    args.push('--dangerously-skip-permissions'); // Skip permission prompts for automation
    args.push(prompt);

    return args;
  }

  /**
   * Generate a default prompt from task config.
   */
  private generatePrompt(config: AgentSpawnConfig): string {
    const { task } = config;
    return [
      `Task: ${task.title}`,
      '',
      task.description || 'No description provided.',
      '',
      'Complete this task and summarize what was done when finished.',
    ].join('\n');
  }

  /**
   * Create an AgentHandle for a process.
   */
  private createHandle(taskId: string, proc: ChildProcess): AgentHandle {
    return {
      pid: proc.pid ?? 0,
      taskId,
      respond: (response: string): Promise<void> => {
        const agent = this.runningAgents.get(taskId);
        if (!agent || !agent.process.stdin?.writable) {
          return Promise.reject(new Error('Cannot respond: agent not running or stdin closed'));
        }

        logger.info('Sending response to agent', { taskId, response: response.substring(0, 50) });

        // Clear pending question
        agent.pendingQuestion = null;

        // Write response to stdin
        agent.process.stdin.write(response + '\n');
        return Promise.resolve();
      },
      terminate: async (reason?: string): Promise<void> => {
        await this.terminateAgent(taskId, reason);
      },
      isRunning: (): boolean => {
        const agent = this.runningAgents.get(taskId);
        return agent !== undefined && !agent.process.killed;
      },
    };
  }

  /**
   * Set up stdout/stderr handlers for an agent.
   */
  private setupOutputHandlers(agent: RunningAgent): void {
    const { process: proc } = agent;

    // Handle stdout
    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.handleOutput(agent, 'stdout', text);
    });

    // Handle stderr
    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.handleOutput(agent, 'stderr', text);
    });
  }

  /**
   * Handle output from an agent.
   */
  private handleOutput(agent: RunningAgent, type: 'stdout' | 'stderr', text: string): void {
    const { config } = agent;
    const timestamp = Date.now();

    // Add to buffer
    agent.outputBuffer.push(text);

    // Keep buffer limited
    if (agent.outputBuffer.length > 1000) {
      agent.outputBuffer = agent.outputBuffer.slice(-500);
    }

    // Emit output event
    const output: AgentOutput = { type, content: text, timestamp };
    config.callbacks.onOutput(output);

    // Check for questions (only in stdout)
    if (type === 'stdout' && !agent.pendingQuestion) {
      const question = this.detectQuestion(text);
      if (question) {
        agent.pendingQuestion = question;
        config.callbacks.onQuestion(question);
      }
    }
  }

  /**
   * Detect if output contains a question.
   */
  private detectQuestion(text: string): AgentQuestion | null {
    for (const { pattern, type } of QUESTION_PATTERNS) {
      if (pattern.test(text)) {
        return {
          id: randomUUID(),
          type,
          question: text.trim(),
          timestamp: Date.now(),
        };
      }
    }
    return null;
  }

  /**
   * Set up exit handler for an agent.
   */
  private setupExitHandler(agent: RunningAgent): void {
    const { process: proc, config, handle, startTime } = agent;

    proc.on('close', (code, signal) => {
      const durationMs = Date.now() - startTime;
      const taskId = handle.taskId;

      logger.info('Claude agent exited', { taskId, code, signal, durationMs });

      // Remove from running agents
      this.runningAgents.delete(taskId);

      // Determine success
      const success = code === 0;
      const fullOutput = agent.outputBuffer.join('');

      // Check if output indicates completion
      const hasCompletionSignal = COMPLETION_PATTERNS.some((p) => p.test(fullOutput));

      // Try to extract files changed from output
      const filesChanged = this.extractFilesChanged(fullOutput);

      // Build result
      const result: AgentResult = {
        success: success && hasCompletionSignal,
        summary: this.extractSummary(fullOutput) || (success ? 'Task completed' : 'Task failed'),
        filesChanged,
        exitCode: code ?? undefined,
        durationMs,
        error: !success ? `Process exited with code ${code}` : undefined,
      };

      config.callbacks.onComplete(result);
    });

    proc.on('error', (error) => {
      config.callbacks.onError(error);
    });
  }

  /**
   * Extract changed files from output.
   */
  private extractFilesChanged(output: string): string[] {
    const files: string[] = [];

    // Look for common file change indicators
    const patterns = [
      /(?:Created|Modified|Updated|Wrote|Edited)\s+(?:file\s+)?['"]?([^'":\n]+\.[a-z]+)['"]?/gi,
      /(?:Writing|Creating)\s+(?:to\s+)?['"]?([^'":\n]+\.[a-z]+)['"]?/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        const file = match[1]?.trim();
        if (file && !files.includes(file)) {
          files.push(file);
        }
      }
    }

    return files;
  }

  /**
   * Extract summary from output.
   */
  private extractSummary(output: string): string | null {
    // Look for summary-like sections
    const patterns = [
      /Summary[:\s]+(.+?)(?:\n\n|$)/is,
      /(?:I've|I have)\s+(.+?)(?:\n\n|$)/is,
      /(?:Completed|Done)[:\s]+(.+?)(?:\n\n|$)/is,
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(output);
      if (match?.[1]) {
        return match[1].trim().substring(0, 500);
      }
    }

    return null;
  }

  /**
   * Terminate a running agent.
   */
  private async terminateAgent(taskId: string, reason?: string): Promise<void> {
    const agent = this.runningAgents.get(taskId);
    if (!agent) {
      return;
    }

    logger.info('Terminating agent', { taskId, reason });

    const { process: proc } = agent;

    // Try graceful termination first
    proc.kill('SIGTERM');

    // Wait for grace period, then force kill
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (!proc.killed) {
          logger.warn('Force killing agent', { taskId });
          proc.kill('SIGKILL');
        }
        resolve();
      }, TERMINATION_GRACE_MS);

      proc.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}
