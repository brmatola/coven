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
  /** Optional tags for categorization (e.g., 'ac:criterion' for acceptance criteria) */
  tags?: string[];
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
// Activity Log Types
// ============================================================================

/**
 * Types of activity entries that can be logged.
 */
export type ActivityType =
  | 'task_started'
  | 'task_completed'
  | 'task_blocked'
  | 'agent_question'
  | 'conflict'
  | 'merge_success'
  | 'session_started'
  | 'session_stopped';

/**
 * An entry in the session activity log.
 */
export interface ActivityEntry {
  /** Unique identifier for this activity */
  id: string;
  /** Type of activity */
  type: ActivityType;
  /** Primary message describing the activity */
  message: string;
  /** Timestamp when the activity occurred */
  timestamp: number;
  /** Related task ID (if applicable) */
  taskId?: string;
  /** Related familiar ID (if applicable) */
  familiarId?: string;
  /** Additional context data */
  details?: Record<string, unknown>;
}

// ============================================================================
// Session Types
// ============================================================================

/**
 * Session lifecycle states.
 */
export type SessionStatus = 'inactive' | 'starting' | 'active' | 'paused' | 'stopping';

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
  /** Agent permission configuration */
  agentPermissions: {
    /** Tools the agent can use without prompting the user */
    allowedTools: string[];
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
  agentPermissions: {
    allowedTools: [
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'Bash(git:*)',
      'Bash(npm:*)',
      'Bash(ls:*)',
      'Bash(cat:*)',
      'Bash(mkdir:*)',
    ],
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
  /** Recent activity log entries (most recent first) */
  activityLog: ActivityEntry[];
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
  'session:paused': undefined;
  'session:resumed': undefined;
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

  // Orphan recovery events
  'orphan:reconnecting': { taskId: string };
  'orphan:reconnected': { taskId: string };
  'orphan:needsReview': { taskId: string };
  'orphan:uncommittedChanges': { taskId: string; worktreePath: string };
  'orphan:cleanedUp': { taskId: string };

  // Worktree events
  'worktree:created': { taskId: string; worktree: { path: string; branch: string } };
  'worktree:deleted': { taskId: string; path: string };
  'worktree:merged': { taskId: string; result: { success: boolean; conflicts: unknown[] } };
  'worktree:conflict': { taskId: string; conflicts: unknown[] };
  'worktree:orphan': { path: string; branch: string };

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

// ============================================================================
// Validation Helpers
// ============================================================================

const TASK_STATUSES: TaskStatus[] = ['ready', 'working', 'review', 'done', 'blocked'];
const TASK_PRIORITIES: TaskPriority[] = ['critical', 'high', 'medium', 'low'];
const FAMILIAR_STATUSES: FamiliarStatus[] = ['working', 'waiting', 'merging', 'complete', 'failed'];

/**
 * Validate that a value is a valid Task object.
 * Returns the task if valid, null if invalid.
 */
export function validateTask(value: unknown): Task | null {
  if (!value || typeof value !== 'object') return null;

  const obj = value as Record<string, unknown>;

  // Required string fields
  if (typeof obj.id !== 'string' || !obj.id) return null;
  if (typeof obj.title !== 'string') return null;
  if (typeof obj.description !== 'string') return null;
  if (typeof obj.sourceId !== 'string') return null;

  // Required status field
  if (!TASK_STATUSES.includes(obj.status as TaskStatus)) return null;

  // Required priority field
  if (!TASK_PRIORITIES.includes(obj.priority as TaskPriority)) return null;

  // Required dependencies array
  if (!Array.isArray(obj.dependencies)) return null;
  if (!obj.dependencies.every((d) => typeof d === 'string')) return null;

  // Required timestamp fields
  if (typeof obj.createdAt !== 'number') return null;
  if (typeof obj.updatedAt !== 'number') return null;

  // Optional fields
  if (obj.acceptanceCriteria !== undefined && typeof obj.acceptanceCriteria !== 'string') return null;
  if (obj.externalId !== undefined && typeof obj.externalId !== 'string') return null;

  return value as Task;
}

/**
 * Validate that a value is a valid Familiar object.
 * Returns the familiar if valid, null if invalid.
 */
export function validateFamiliar(value: unknown): Familiar | null {
  if (!value || typeof value !== 'object') return null;

  const obj = value as Record<string, unknown>;

  // Required fields
  if (typeof obj.taskId !== 'string' || !obj.taskId) return null;
  if (!FAMILIAR_STATUSES.includes(obj.status as FamiliarStatus)) return null;
  if (typeof obj.spawnedAt !== 'number') return null;
  if (!Array.isArray(obj.outputBuffer)) return null;

  // Validate processInfo
  if (!obj.processInfo || typeof obj.processInfo !== 'object') return null;
  const processInfo = obj.processInfo as Record<string, unknown>;
  if (typeof processInfo.pid !== 'number') return null;
  if (typeof processInfo.startTime !== 'number') return null;
  if (typeof processInfo.command !== 'string') return null;
  if (typeof processInfo.worktreePath !== 'string') return null;

  return value as Familiar;
}

/**
 * Validate that a value is a valid SessionConfig object.
 * Returns the merged config with defaults for missing fields.
 */
export function validateSessionConfig(value: unknown): SessionConfig {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_SESSION_CONFIG };
  }

  const obj = value as Record<string, unknown>;

  return {
    maxConcurrentAgents:
      typeof obj.maxConcurrentAgents === 'number'
        ? obj.maxConcurrentAgents
        : DEFAULT_SESSION_CONFIG.maxConcurrentAgents,
    worktreeBasePath:
      typeof obj.worktreeBasePath === 'string'
        ? obj.worktreeBasePath
        : DEFAULT_SESSION_CONFIG.worktreeBasePath,
    beadsSyncIntervalMs:
      typeof obj.beadsSyncIntervalMs === 'number'
        ? obj.beadsSyncIntervalMs
        : DEFAULT_SESSION_CONFIG.beadsSyncIntervalMs,
    agentTimeoutMs:
      typeof obj.agentTimeoutMs === 'number'
        ? obj.agentTimeoutMs
        : DEFAULT_SESSION_CONFIG.agentTimeoutMs,
    mergeConflictMaxRetries:
      typeof obj.mergeConflictMaxRetries === 'number'
        ? obj.mergeConflictMaxRetries
        : DEFAULT_SESSION_CONFIG.mergeConflictMaxRetries,
    preMergeChecks: {
      enabled:
        typeof (obj.preMergeChecks as Record<string, unknown>)?.enabled === 'boolean'
          ? (obj.preMergeChecks as Record<string, unknown>).enabled as boolean
          : DEFAULT_SESSION_CONFIG.preMergeChecks.enabled,
      commands: Array.isArray((obj.preMergeChecks as Record<string, unknown>)?.commands)
        ? ((obj.preMergeChecks as Record<string, unknown>).commands as string[])
        : DEFAULT_SESSION_CONFIG.preMergeChecks.commands,
    },
    logging: {
      level:
        ['debug', 'info', 'warn', 'error'].includes(
          (obj.logging as Record<string, unknown>)?.level as string
        )
          ? ((obj.logging as Record<string, unknown>).level as 'debug' | 'info' | 'warn' | 'error')
          : DEFAULT_SESSION_CONFIG.logging.level,
      retentionDays:
        typeof (obj.logging as Record<string, unknown>)?.retentionDays === 'number'
          ? ((obj.logging as Record<string, unknown>).retentionDays as number)
          : DEFAULT_SESSION_CONFIG.logging.retentionDays,
    },
    outputRetentionDays:
      typeof obj.outputRetentionDays === 'number'
        ? obj.outputRetentionDays
        : DEFAULT_SESSION_CONFIG.outputRetentionDays,
    notifications: {
      questions:
        ['modal', 'toast', 'statusbar', 'none'].includes(
          (obj.notifications as Record<string, unknown>)?.questions as string
        )
          ? ((obj.notifications as Record<string, unknown>).questions as NotificationLevel)
          : DEFAULT_SESSION_CONFIG.notifications.questions,
      completions:
        ['modal', 'toast', 'statusbar', 'none'].includes(
          (obj.notifications as Record<string, unknown>)?.completions as string
        )
          ? ((obj.notifications as Record<string, unknown>).completions as NotificationLevel)
          : DEFAULT_SESSION_CONFIG.notifications.completions,
      conflicts:
        ['modal', 'toast', 'statusbar', 'none'].includes(
          (obj.notifications as Record<string, unknown>)?.conflicts as string
        )
          ? ((obj.notifications as Record<string, unknown>).conflicts as NotificationLevel)
          : DEFAULT_SESSION_CONFIG.notifications.conflicts,
      errors:
        ['modal', 'toast', 'statusbar', 'none'].includes(
          (obj.notifications as Record<string, unknown>)?.errors as string
        )
          ? ((obj.notifications as Record<string, unknown>).errors as NotificationLevel)
          : DEFAULT_SESSION_CONFIG.notifications.errors,
    },
    agentPermissions: {
      allowedTools: Array.isArray((obj.agentPermissions as Record<string, unknown>)?.allowedTools)
        ? ((obj.agentPermissions as Record<string, unknown>).allowedTools as string[])
        : DEFAULT_SESSION_CONFIG.agentPermissions.allowedTools,
    },
  };
}
