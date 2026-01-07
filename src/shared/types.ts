/**
 * Core types for Coven session management.
 * These types form the foundation for task and agent orchestration.
 */

// ============================================================================
// Task Types
// ============================================================================

/**
 * Valid task status values.
 * Follows the state machine: ready → working → review → done
 * With 'blocked' as a side state for dependency-blocked tasks.
 */
export type TaskStatus = 'ready' | 'working' | 'review' | 'done' | 'blocked';

/**
 * Task priority levels for controlling execution order.
 */
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * Represents a unit of work to be completed by an agent.
 */
export interface Task {
  /** Unique identifier for the task */
  id: string;
  /** Human-readable title */
  title: string;
  /** Detailed description of what needs to be done */
  description: string;
  /** Current status in the task lifecycle */
  status: TaskStatus;
  /** Priority for execution ordering */
  priority: TaskPriority;
  /** IDs of tasks that must complete before this one can start */
  dependencies: string[];
  /** Optional criteria for task completion verification */
  acceptanceCriteria?: string;
  /** ID of the source that created this task (e.g., 'manual', 'beads') */
  sourceId: string;
  /** External ID from the source system (if applicable) */
  externalId?: string;
  /** Timestamp when task was created */
  createdAt: number;
  /** Timestamp of last update */
  updatedAt: number;
}

/**
 * Interface for pluggable task providers.
 * Implementations can sync tasks from external systems like Beads.
 */
export interface TaskSource {
  /** Unique identifier for this source */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Fetch tasks from the source */
  fetchTasks(): Promise<Task[]>;
  /** Called when a task's status changes (for syncing back) */
  onTaskStatusChanged?(taskId: string, status: TaskStatus): Promise<void>;
  /** Dispose of any resources */
  dispose(): void;
}

// ============================================================================
// Familiar (Agent) Types
// ============================================================================

/**
 * Valid familiar status values.
 */
export type FamiliarStatus = 'working' | 'waiting' | 'merging' | 'complete' | 'failed';

/**
 * Process information for agent tracking and recovery.
 */
export interface ProcessInfo {
  /** Process ID */
  pid: number;
  /** Process start timestamp (for verification) */
  startTime: number;
  /** Command used to spawn the process */
  command: string;
  /** Path to the worktree where agent is working */
  worktreePath: string;
}

/**
 * Represents an active AI agent working on a task.
 */
export interface Familiar {
  /** ID of the task this familiar is working on */
  taskId: string;
  /** Current status of the familiar */
  status: FamiliarStatus;
  /** Process tracking information */
  processInfo: ProcessInfo;
  /** Timestamp when familiar was spawned */
  spawnedAt: number;
  /** Output buffer from the agent (recent lines) */
  outputBuffer: string[];
}

/**
 * A pending question from an agent requiring user response.
 */
export interface PendingQuestion {
  /** ID of the familiar asking the question */
  familiarId: string;
  /** ID of the task being worked on */
  taskId: string;
  /** The question text */
  question: string;
  /** Available options (if multiple choice) */
  options?: string[];
  /** Timestamp when question was asked */
  askedAt: number;
}

// ============================================================================
// Session Types
// ============================================================================

/**
 * Session lifecycle states.
 */
export type SessionStatus = 'inactive' | 'starting' | 'active' | 'stopping';

/**
 * Notification level for different event types.
 */
export type NotificationLevel = 'modal' | 'toast' | 'statusbar' | 'none';

/**
 * Session configuration persisted to .coven/config.json.
 */
export interface SessionConfig {
  /** Maximum concurrent agents allowed */
  maxConcurrentAgents: number;
  /** Base path for git worktrees */
  worktreeBasePath: string;
  /** Interval for Beads sync in milliseconds */
  beadsSyncIntervalMs: number;
  /** Agent timeout in milliseconds */
  agentTimeoutMs: number;
  /** Max retries for merge conflicts */
  mergeConflictMaxRetries: number;
  /** Pre-merge check configuration */
  preMergeChecks: {
    enabled: boolean;
    commands: string[];
  };
  /** Logging configuration */
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    retentionDays: number;
  };
  /** Days to retain agent output files */
  outputRetentionDays: number;
  /** Notification levels for different events */
  notifications: {
    questions: NotificationLevel;
    completions: NotificationLevel;
    conflicts: NotificationLevel;
    errors: NotificationLevel;
  };
}

/**
 * Default session configuration.
 */
export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  maxConcurrentAgents: 3,
  worktreeBasePath: '.coven/worktrees',
  beadsSyncIntervalMs: 30000,
  agentTimeoutMs: 600000,
  mergeConflictMaxRetries: 2,
  preMergeChecks: {
    enabled: false,
    commands: [],
  },
  logging: {
    level: 'info',
    retentionDays: 7,
  },
  outputRetentionDays: 7,
  notifications: {
    questions: 'modal',
    completions: 'toast',
    conflicts: 'toast',
    errors: 'toast',
  },
};

/**
 * Immutable snapshot of the current session state.
 */
export interface CovenState {
  /** Current session status */
  sessionStatus: SessionStatus;
  /** Feature branch for this session */
  featureBranch: string | null;
  /** Current session configuration */
  config: SessionConfig;
  /** All tasks grouped by status */
  tasks: {
    ready: Task[];
    working: Task[];
    review: Task[];
    done: Task[];
    blocked: Task[];
  };
  /** Active familiars */
  familiars: Familiar[];
  /** Pending questions from agents */
  pendingQuestions: PendingQuestion[];
  /** Timestamp of this snapshot */
  timestamp: number;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Events emitted by the session management system.
 */
export interface SessionEvents {
  // Session lifecycle
  'session:starting': { featureBranch: string };
  'session:started': { featureBranch: string };
  'session:stopping': undefined;
  'session:stopped': undefined;
  'session:error': { error: Error };

  // Task events
  'task:created': { task: Task };
  'task:updated': { task: Task; previousStatus?: TaskStatus };
  'task:deleted': { taskId: string };
  'task:unblocked': { task: Task };

  // Familiar events
  'familiar:spawned': { familiar: Familiar };
  'familiar:statusChanged': { familiar: Familiar; previousStatus: FamiliarStatus };
  'familiar:output': { familiarId: string; line: string };
  'familiar:terminated': { familiarId: string; reason: string };
  'familiar:question': { question: PendingQuestion };

  // Config events
  'config:changed': { config: SessionConfig };

  // State events
  'state:changed': { state: CovenState };
}

/**
 * Valid task status transitions.
 * Maps current status to allowed next statuses.
 */
export const VALID_TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  ready: ['working', 'blocked'],
  working: ['review', 'ready'],
  review: ['done', 'working', 'ready'],
  done: [], // Terminal state
  blocked: ['ready'], // Unblocks when dependencies are met
};

/**
 * Check if a task status transition is valid.
 */
export function isValidTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TASK_TRANSITIONS[from].includes(to);
}
