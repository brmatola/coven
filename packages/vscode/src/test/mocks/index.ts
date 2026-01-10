/**
 * Mock infrastructure for daemon client testing.
 *
 * @example
 * ```typescript
 * import { MockDaemonClient, createMockDaemonClient } from './test/mocks';
 * import { emptyState, runningTask } from './test/fixtures';
 *
 * describe('MyComponent', () => {
 *   it('handles daemon state', async () => {
 *     const mock = createMockDaemonClient();
 *     mock.setStateResponse({ ...emptyState, tasks: [runningTask] });
 *
 *     const component = new MyComponent(mock);
 *     await component.refresh();
 *
 *     expect(component.tasks).toHaveLength(1);
 *     mock.assertCalled('/state');
 *   });
 * });
 * ```
 */

export {
  MockDaemonClient,
  createMockDaemonClient,
  type CallRecord,
  type MockResponseConfig,
  type DaemonClientInterface,
} from './MockDaemonClient';

export {
  MockSSEStream,
  createConnectedMockSSEStream,
  SSESequences,
} from './MockSSEStream';
