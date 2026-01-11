export { DaemonClient } from './client';
export { StateCache, WorkflowState, DaemonState } from './cache';
export { ConnectionManager } from './connection';
export { BinaryManager } from './binary';
export { DaemonLifecycle, DaemonStartError } from './lifecycle';
export {
  DaemonNotificationService,
  showLoading,
  showSuccess,
  showWarning,
  withLoading,
  withProgress,
} from './notifications';

// Re-export SSE types from @coven/client-ts
export { SSEClient, SSEError } from '@coven/client-ts';
export type {
  SSEEvent,
  SSEEventType,
  SSEConnectionState,
  SSEClientEventMap,
} from '@coven/client-ts';

export type { StateCacheEvents, SessionState } from './cache';
export type { ConnectionOptions, ConnectionManagerEvents, ConnectionState } from './connection';
export type { BinaryManagerOptions, Platform } from './binary';
export type { DaemonLifecycleOptions } from './lifecycle';
export * from './types';
