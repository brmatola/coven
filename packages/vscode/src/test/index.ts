/**
 * Test infrastructure for the Coven VS Code extension.
 *
 * This module provides mocks and fixtures for unit testing daemon client
 * components without actual socket communication.
 *
 * ## Mocks
 *
 * - `MockDaemonClient`: Simulates daemon API responses
 * - `MockSSEStream`: Simulates SSE event streams
 *
 * ## Fixtures
 *
 * - State fixtures: Pre-built DaemonState objects
 * - Event fixtures: Pre-built SSE events and sequences
 *
 * ## Usage Example
 *
 * ```typescript
 * import {
 *   MockDaemonClient,
 *   MockSSEStream,
 *   emptyState,
 *   runningTask,
 *   successfulTaskSequence,
 * } from '../test';
 *
 * describe('WorkflowManager', () => {
 *   let mockClient: MockDaemonClient;
 *   let mockSSE: MockSSEStream;
 *
 *   beforeEach(() => {
 *     mockClient = new MockDaemonClient();
 *     mockSSE = new MockSSEStream();
 *     mockSSE.setConnected();
 *   });
 *
 *   it('updates state on SSE events', () => {
 *     mockClient.setStateResponse(emptyState);
 *
 *     const manager = new WorkflowManager(mockClient, mockSSE);
 *
 *     // Emit task sequence
 *     successfulTaskSequence('task-1').forEach(e => mockSSE.emitEvent(e));
 *
 *     expect(manager.completedTasks).toContain('task-1');
 *   });
 *
 *   it('handles connection errors', () => {
 *     mockClient.setConnectionRefused();
 *
 *     expect(() => new WorkflowManager(mockClient, mockSSE))
 *       .toThrow('connection_refused');
 *   });
 * });
 * ```
 */

// Re-export all mocks
export * from './mocks';

// Re-export all fixtures
export * from './fixtures';
