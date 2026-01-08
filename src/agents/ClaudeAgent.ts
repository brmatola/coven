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
 * Maximum response size in bytes (1MB).
 */
const MAX_RESPONSE_SIZE = 1024 * 1024;

/**
 * Maximum output line size in bytes (64KB).
 */
const MAX_OUTPUT_LINE_SIZE = 64 * 1024;

/**
 * Idle timeout before considering agent stalled (5 minutes).
 */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Allowlisted environment variables for agent processes.
 * Only these will be passed to spawned processes.
 */
const ALLOWED_ENV_VARS = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'NODE_ENV',
  'npm_config_prefix',
  'npm_config_cache',
];

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
  lastActivityTime: number;
  outputBuffer: string[];
  outputBufferSize: number;
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
      // No shell: true - spawn directly without shell interpretation
      const proc = spawn(this.claudeCommand, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
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

    // Build allowlisted environment
    const safeEnv = this.buildSafeEnvironment();

    // Spawn the process - NO shell: true to prevent shell injection
    const proc = spawn(this.claudeCommand, args, {
      cwd: config.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: safeEnv,
    });

    // Create handle
    const handle = this.createHandle(taskId, proc);

    const now = Date.now();

    // Create running agent record
    const runningAgent: RunningAgent = {
      handle,
      process: proc,
      config,
      startTime: now,
      lastActivityTime: now,
      outputBuffer: [],
      outputBufferSize: 0,
      pendingQuestion: null,
    };

    this.runningAgents.set(taskId, runningAgent);

    // Set up output handlers
    this.setupOutputHandlers(runningAgent);

    // Set up exit handler
    this.setupExitHandler(runningAgent);

    // Set up idle timeout checker
    this.setupIdleChecker(runningAgent);

    return Promise.resolve(handle);
  }

  /**
   * Build a safe environment with only allowlisted variables.
   */
  private buildSafeEnvironment(): NodeJS.ProcessEnv {
    const safeEnv: NodeJS.ProcessEnv = {};

    // Copy only allowlisted variables
    for (const key of ALLOWED_ENV_VARS) {
      if (process.env[key] !== undefined) {
        safeEnv[key] = process.env[key];
      }
    }

    // Add our specific variables
    safeEnv.CI = 'true';
    safeEnv.CLAUDE_CODE_NO_TELEMETRY = '1';

    return safeEnv;
  }

  /**
   * Set up idle timeout checker for an agent.
   */
  private setupIdleChecker(agent: RunningAgent): void {
    const checkInterval = setInterval(() => {
      if (!this.runningAgents.has(agent.handle.taskId)) {
        clearInterval(checkInterval);
        return;
      }

      const idleTime = Date.now() - agent.lastActivityTime;
      if (idleTime > IDLE_TIMEOUT_MS) {
        logger.warn('Agent idle timeout', {
          taskId: agent.handle.taskId,
          idleTimeMs: idleTime,
        });
        clearInterval(checkInterval);
        // Emit a question so user knows agent is stalled
        const question: AgentQuestion = {
          id: randomUUID(),
          type: 'blocked',
          question: `Agent has been idle for ${Math.round(idleTime / 1000)}s. It may be stalled.`,
          timestamp: Date.now(),
        };
        agent.config.callbacks.onQuestion(question);
      }
    }, 30000); // Check every 30 seconds

    // Clean up interval when process exits
    agent.process.once('close', () => clearInterval(checkInterval));
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

    // Print output without interactive mode
    args.push('--print');

    // Add allowed tools if specified (enables those tools without prompting)
    // Pass each tool as a separate argument to avoid space injection
    if (config.allowedTools && config.allowedTools.length > 0) {
      // Validate each tool name - only allow safe characters
      const safeTools = config.allowedTools.filter((tool) => this.isValidToolName(tool));
      if (safeTools.length > 0) {
        args.push('--allowedTools', ...safeTools);
      }
    }

    args.push(prompt);

    return args;
  }

  /**
   * Validate a tool name contains only safe characters.
   * Allows: alphanumeric, underscore, hyphen, colon, parentheses, asterisk
   */
  private isValidToolName(tool: string): boolean {
    // Pattern: tool names like "Read", "Bash(git:*)", "mcp__ide__getDiagnostics"
    return /^[a-zA-Z0-9_\-:().*]+$/.test(tool) && tool.length <= 100;
  }

  /**
   * Sanitize text to remove potentially dangerous content.
   * Removes control characters and limits length.
   */
  private sanitizeText(text: string, maxLength = 10000): string {
    if (!text) return '';

    // Remove control characters except newline and tab
    // eslint-disable-next-line no-control-regex
    let sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // Limit length
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength) + '... (truncated)';
    }

    return sanitized;
  }

  /**
   * Generate a default prompt from task config.
   */
  private generatePrompt(config: AgentSpawnConfig): string {
    const { task } = config;

    // Sanitize task content to prevent injection
    const title = this.sanitizeText(task.title, 500);
    const description = this.sanitizeText(task.description || 'No description provided.', 5000);

    return [
      `Task: ${title}`,
      '',
      description,
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

        // Validate response size
        const responseBytes = Buffer.byteLength(response, 'utf8');
        if (responseBytes > MAX_RESPONSE_SIZE) {
          return Promise.reject(
            new Error(`Response too large: ${responseBytes} bytes (max ${MAX_RESPONSE_SIZE})`)
          );
        }

        // Sanitize response - remove control characters except newline
        // eslint-disable-next-line no-control-regex
        const sanitized = response.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');

        logger.info('Sending response to agent', { taskId, response: sanitized.substring(0, 50) });

        // Clear pending question
        agent.pendingQuestion = null;

        // Update activity time
        agent.lastActivityTime = Date.now();

        // Write response to stdin
        agent.process.stdin.write(sanitized + '\n');
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

    // Update activity time
    agent.lastActivityTime = timestamp;

    // Limit individual output line size
    let processedText = text;
    if (text.length > MAX_OUTPUT_LINE_SIZE) {
      processedText = text.substring(0, MAX_OUTPUT_LINE_SIZE) + '... (truncated)';
      logger.warn('Output line truncated', {
        taskId: agent.handle.taskId,
        originalSize: text.length,
      });
    }

    // Add to buffer with size tracking
    const textSize = Buffer.byteLength(processedText, 'utf8');
    agent.outputBuffer.push(processedText);
    agent.outputBufferSize += textSize;

    // Keep buffer limited by count and total size (max 5MB)
    const MAX_BUFFER_SIZE = 5 * 1024 * 1024;
    while (agent.outputBuffer.length > 1000 || agent.outputBufferSize > MAX_BUFFER_SIZE) {
      const removed = agent.outputBuffer.shift();
      if (removed) {
        agent.outputBufferSize -= Buffer.byteLength(removed, 'utf8');
      }
    }

    // Emit output event
    const output: AgentOutput = { type, content: processedText, timestamp };
    config.callbacks.onOutput(output);

    // Check for questions (only in stdout)
    if (type === 'stdout' && !agent.pendingQuestion) {
      const question = this.detectQuestion(processedText);
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

      // Build result - only include optional properties when defined
      const result: AgentResult = {
        success: success && hasCompletionSignal,
        summary: this.extractSummary(fullOutput) || (success ? 'Task completed' : 'Task failed'),
        filesChanged,
        durationMs,
      };
      if (code !== null && code !== undefined) {
        result.exitCode = code;
      }
      if (!success) {
        result.error = `Process exited with code ${code}`;
      }

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

    // Check if already exited
    if (proc.exitCode !== null || proc.signalCode !== null) {
      logger.info('Agent already exited', { taskId, exitCode: proc.exitCode });
      return;
    }

    // Try graceful termination first
    const terminated = proc.kill('SIGTERM');
    if (!terminated) {
      logger.warn('SIGTERM failed, process may already be dead', { taskId });
      return;
    }

    // Wait for process to exit or timeout
    await new Promise<void>((resolve) => {
      let forceKilled = false;

      const timeout = setTimeout(() => {
        // Double-check the process hasn't exited
        if (proc.exitCode === null && proc.signalCode === null) {
          logger.warn('Force killing agent after grace period', { taskId });
          forceKilled = true;
          proc.kill('SIGKILL');
        }
        // Give SIGKILL a moment to take effect
        setTimeout(resolve, 100);
      }, TERMINATION_GRACE_MS);

      proc.once('close', () => {
        clearTimeout(timeout);
        if (!forceKilled) {
          logger.info('Agent terminated gracefully', { taskId });
        }
        resolve();
      });
    });
  }
}
