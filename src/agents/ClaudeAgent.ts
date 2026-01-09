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
 * Stream event types from Claude's stream-json format.
 */
interface StreamEvent {
  type: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
    }>;
  };
  delta?: {
    type?: string;
    text?: string;
  };
  content_block?: {
    type?: string;
    text?: string;
  };
  result?: string;
  error?: {
    message?: string;
  };
}

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
  // Claude/Anthropic API configuration
  'ANTHROPIC_API_KEY',
  'CLAUDE_API_KEY',
  'ANTHROPIC_BASE_URL',
  // Common proxy settings
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
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
 * These patterns indicate successful task completion in Claude's output.
 */
const COMPLETION_PATTERNS = [
  /Task complete/i,
  /I['']ve completed/i,
  /I['']ve successfully/i,
  /Implementation complete/i,
  /Successfully completed/i,
  /Done\.?$/m,
  /Finished\.?$/m,
  /All (?:tests?|checks?) pass/i,
  /Changes have been committed/i,
  /Commit.*complete/i,
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
  /** Buffer for incomplete JSON lines from stdout */
  stdoutLineBuffer: string;
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
      stdoutLineBuffer: '',
    };

    this.runningAgents.set(taskId, runningAgent);

    // Set up output handlers
    this.setupOutputHandlers(runningAgent);

    // Set up exit handler
    this.setupExitHandler(runningAgent);

    // Set up idle timeout checker
    this.setupIdleChecker(runningAgent);

    // Close stdin immediately since we're using -p flag for prompt
    // This signals to the process that there's no interactive input
    proc.stdin?.end();

    logger.info('Agent spawned successfully', {
      taskId,
      pid: proc.pid,
      args: this.buildArgs(config).map((a) => (a.length > 100 ? a.substring(0, 100) + '...' : a)),
    });

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

    // Use -p flag to pass prompt for non-interactive mode
    args.push('-p', prompt);

    // Skip permission prompts for automated operation
    args.push('--dangerously-skip-permissions');

    // Use streaming JSON output for real-time updates
    args.push('--output-format', 'stream-json');

    // Add allowed tools if specified (enables those tools without prompting)
    // Pass each tool as a separate argument to avoid space injection
    if (config.allowedTools && config.allowedTools.length > 0) {
      // Validate each tool name - only allow safe characters
      const safeTools = config.allowedTools.filter((tool) => this.isValidToolName(tool));
      if (safeTools.length > 0) {
        args.push('--allowedTools', ...safeTools);
      }
    }

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

    // Handle stdout - streaming JSON, one JSON object per line
    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.handleStreamingJsonOutput(agent, text);
    });

    // Handle stderr - plain text, pass through directly
    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.handleStderrOutput(agent, text);
    });
  }

  /**
   * Handle streaming JSON output from stdout.
   * Claude's stream-json format outputs one JSON object per line.
   */
  private handleStreamingJsonOutput(agent: RunningAgent, text: string): void {
    const taskId = agent.handle.taskId;

    // Update activity time
    agent.lastActivityTime = Date.now();

    // Add incoming text to line buffer
    agent.stdoutLineBuffer += text;

    // Process complete lines
    const lines = agent.stdoutLineBuffer.split('\n');

    // Keep the last incomplete line in the buffer
    agent.stdoutLineBuffer = lines.pop() || '';

    // Process each complete line
    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const event = JSON.parse(line) as StreamEvent;
        this.processStreamEvent(agent, event);
      } catch {
        // If JSON parsing fails, treat as plain text output
        logger.debug('Non-JSON line in stdout', { taskId, line: line.substring(0, 100) });
        this.emitTextOutput(agent, line);
      }
    }
  }

  /**
   * Process a streaming JSON event from Claude.
   */
  private processStreamEvent(agent: RunningAgent, event: StreamEvent): void {
    const taskId = agent.handle.taskId;

    // Extract text content based on event type
    let textContent = '';

    switch (event.type) {
      case 'assistant':
        // Final assistant message with full content
        if (event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              textContent += block.text;
            }
          }
        }
        break;

      case 'content_block_delta':
        // Streaming text delta
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          textContent = event.delta.text;
        }
        break;

      case 'content_block_start':
        // Start of a content block - may have initial text
        if (event.content_block?.type === 'text' && event.content_block.text) {
          textContent = event.content_block.text;
        }
        break;

      case 'result':
        // Final result event
        if (event.result) {
          textContent = `\n${event.result}`;
        }
        break;

      case 'error': {
        // Error event
        const errorMsg = event.error?.message || 'Unknown error';
        logger.error('Stream error from Claude', { taskId, error: errorMsg });
        this.emitTextOutput(agent, `Error: ${errorMsg}`);
        return;
      }

      // Events we can ignore for output purposes
      case 'message_start':
      case 'message_delta':
      case 'message_stop':
      case 'content_block_stop':
      case 'system':
        // These are control events, not content
        logger.debug('Stream control event', { taskId, type: event.type });
        return;

      default:
        // Unknown event type - log it
        logger.debug('Unknown stream event type', { taskId, type: event.type });
        return;
    }

    // Emit text content if any
    if (textContent) {
      this.emitTextOutput(agent, textContent);
    }
  }

  /**
   * Emit text output to the callback and add to buffer.
   */
  private emitTextOutput(agent: RunningAgent, text: string): void {
    const { config } = agent;
    const timestamp = Date.now();
    const taskId = agent.handle.taskId;

    // Limit individual output size
    let processedText = text;
    if (text.length > MAX_OUTPUT_LINE_SIZE) {
      processedText = text.substring(0, MAX_OUTPUT_LINE_SIZE) + '... (truncated)';
      logger.warn('Output truncated', { taskId, originalSize: text.length });
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
    const output: AgentOutput = { type: 'stdout', content: processedText, timestamp };
    config.callbacks.onOutput(output);

    // Check for questions
    if (!agent.pendingQuestion) {
      const question = this.detectQuestion(processedText);
      if (question) {
        logger.info('Agent question detected', { taskId, questionType: question.type });
        agent.pendingQuestion = question;
        config.callbacks.onQuestion(question);
      }
    }
  }

  /**
   * Handle stderr output (plain text).
   */
  private handleStderrOutput(agent: RunningAgent, text: string): void {
    const { config } = agent;
    const timestamp = Date.now();
    const taskId = agent.handle.taskId;

    // Update activity time
    agent.lastActivityTime = timestamp;

    // Log for observability
    logger.debug('Agent stderr', { taskId, length: text.length, preview: text.substring(0, 200) });

    // Limit size
    let processedText = text;
    if (text.length > MAX_OUTPUT_LINE_SIZE) {
      processedText = text.substring(0, MAX_OUTPUT_LINE_SIZE) + '... (truncated)';
    }

    // Add to buffer
    const textSize = Buffer.byteLength(processedText, 'utf8');
    agent.outputBuffer.push(processedText);
    agent.outputBufferSize += textSize;

    // Emit output event
    const output: AgentOutput = { type: 'stderr', content: processedText, timestamp };
    config.callbacks.onOutput(output);
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
      const outputSize = agent.outputBufferSize;
      const outputLineCount = agent.outputBuffer.length;

      logger.info('Claude agent exited', {
        taskId,
        code,
        signal,
        durationMs,
        outputSize,
        outputLineCount,
      });

      // Remove from running agents
      this.runningAgents.delete(taskId);

      // Determine success based on exit code
      // Exit code 0 = success, non-zero = failure
      const success = code === 0;
      const fullOutput = agent.outputBuffer.join('');

      // Check if output indicates completion (for logging/confidence)
      const hasCompletionSignal = COMPLETION_PATTERNS.some((p) => p.test(fullOutput));

      // Try to extract files changed from output
      const filesChanged = this.extractFilesChanged(fullOutput);

      // Log detailed result info for debugging
      logger.info('Agent result analysis', {
        taskId,
        exitCode: code,
        success,
        hasCompletionSignal,
        filesChangedCount: filesChanged.length,
        outputPreview: fullOutput.substring(0, 500).replace(/\n/g, '\\n'),
      });

      // Build result - success is based on exit code alone
      // Completion patterns are just for confidence/logging, not for determining success
      const result: AgentResult = {
        success,
        summary: this.extractSummary(fullOutput) || (success ? 'Task completed' : 'Task failed'),
        filesChanged,
        durationMs,
      };
      if (code !== null && code !== undefined) {
        result.exitCode = code;
      }
      if (!success) {
        result.error = `Process exited with code ${code}`;
        logger.warn('Agent failed', { taskId, error: result.error, fullOutput: fullOutput.substring(0, 1000) });
      } else if (!hasCompletionSignal) {
        // Log a note if exit was 0 but no explicit completion signal found
        logger.info('Agent exited successfully but no explicit completion signal found', { taskId });
      }

      config.callbacks.onComplete(result);
    });

    proc.on('error', (error) => {
      logger.error('Agent process error', { taskId: handle.taskId, error: error.message });
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
