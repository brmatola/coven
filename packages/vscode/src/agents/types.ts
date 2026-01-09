import { Task } from '../shared/types';

/**
 * Configuration for spawning an agent.
 */
export interface AgentSpawnConfig {
  /** Task the agent should work on */
  task: Task;
  /** Working directory (typically a worktree path) */
  workingDirectory: string;
  /** Feature branch to base work on */
  featureBranch: string;
  /** Optional prompt override */
  prompt?: string;
  /** Tools the agent is allowed to use without prompting */
  allowedTools?: string[];
  /** Callbacks for agent events */
  callbacks: AgentCallbacks;
}

/**
 * Callbacks for agent lifecycle events.
 */
export interface AgentCallbacks {
  /** Called when agent produces output */
  onOutput: (output: AgentOutput) => void;
  /** Called when agent asks a question */
  onQuestion: (question: AgentQuestion) => void;
  /** Called when agent completes (success or failure) */
  onComplete: (result: AgentResult) => void;
  /** Called on error */
  onError: (error: Error) => void;
}

/**
 * Output event from an agent.
 */
export interface AgentOutput {
  /** Type of output */
  type: 'stdout' | 'stderr' | 'status';
  /** Output content */
  content: string;
  /** Timestamp */
  timestamp: number;
}

/**
 * Question asked by an agent requiring user response.
 */
export interface AgentQuestion {
  /** Unique question ID */
  id: string;
  /** Type of question */
  type: AgentQuestionType;
  /** The question text */
  question: string;
  /** Suggested responses if available */
  suggestedResponses?: string[];
  /** Context about what the agent is trying to do */
  context?: string;
  /** Timestamp when question was asked */
  timestamp: number;
}

/**
 * Types of questions an agent might ask.
 */
export type AgentQuestionType =
  | 'clarification' // Needs more info about the task
  | 'permission' // Asking to perform an action
  | 'decision' // Multiple options, needs choice
  | 'blocked' // Cannot proceed without help
  | 'confirmation'; // Wants to confirm before proceeding

/**
 * Result of agent execution.
 */
export interface AgentResult {
  /** Whether the task completed successfully */
  success: boolean;
  /** Summary of what was done */
  summary: string;
  /** Files that were changed */
  filesChanged: string[];
  /** Error message if failed */
  error?: string;
  /** Exit code of the process */
  exitCode?: number;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Handle to control a spawned agent.
 */
export interface AgentHandle {
  /** Process ID */
  pid: number;
  /** Task ID this agent is working on */
  taskId: string;
  /** Send a response to a question */
  respond: (response: string) => Promise<void>;
  /** Terminate the agent */
  terminate: (reason?: string) => Promise<void>;
  /** Check if agent is still running */
  isRunning: () => boolean;
}

/**
 * Interface for AI agent providers.
 * Implementations handle spawning and managing specific agent types.
 */
export interface AgentProvider {
  /** Provider name (e.g., 'claude', 'copilot') */
  readonly name: string;

  /**
   * Check if this provider is available (e.g., CLI installed).
   */
  isAvailable(): Promise<boolean>;

  /**
   * Spawn a new agent for a task.
   * @param config Spawn configuration
   * @returns Handle to control the agent
   */
  spawn(config: AgentSpawnConfig): Promise<AgentHandle>;

  /**
   * Get all currently running agents.
   */
  getRunningAgents(): AgentHandle[];

  /**
   * Terminate all running agents.
   */
  terminateAll(reason?: string): Promise<void>;
}

/**
 * Options for agent termination.
 */
export interface TerminationOptions {
  /** Timeout before force kill (ms) */
  gracePeriodMs?: number;
  /** Reason for termination */
  reason?: string;
}
