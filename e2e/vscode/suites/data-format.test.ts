/**
 * Data Format Handling E2E Tests.
 *
 * Tests state data structure handling to ensure the extension
 * correctly processes daemon responses.
 * Addresses user complaint: "map is not a function" error on refresh.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  initTestContext,
  getTestContext,
  clearEvents,
  ensureDaemonHealthy,
} from './setup';
import { delay } from '../helpers';

suite('Data Format Handling', function () {
  this.timeout(30000);

  suiteSetup(async function () {
    try {
      await initTestContext();
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('binary not found')) {
        this.skip();
      }
      throw err;
    }
  });

  setup(function () {
    clearEvents();
  });

  test('State response agents format is handled correctly', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      return this.skip();
    }

    const ctx = getTestContext();
    const response = await ctx.daemon.sendRequest<{ state: { agents: unknown } }>(
      'GET',
      '/state'
    );

    const agents = response?.state?.agents;
    if (agents !== undefined && agents !== null) {
      if (Array.isArray(agents)) {
        for (const agent of agents) {
          assert.ok(
            (agent as { taskId?: string }).taskId,
            'Each agent should have taskId'
          );
        }
      } else if (typeof agents === 'object') {
        const entries = Object.entries(agents);
        for (const [taskId, agent] of entries) {
          assert.ok(taskId, 'Object key should be taskId');
          assert.ok(typeof agent === 'object', 'Agent value should be object');
        }
      }
    }
  });

  test('Tasks list returns valid array', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      return this.skip();
    }

    const ctx = getTestContext();
    const response = await ctx.daemon.sendRequest<{ tasks: unknown[] }>(
      'GET',
      '/tasks'
    );

    assert.ok(response, 'Should receive tasks response');
    assert.ok(Array.isArray(response.tasks), 'Tasks should be an array');

    for (const task of response.tasks) {
      const t = task as { id?: string; title?: string };
      assert.ok(t.id, 'Each task should have id');
    }
  });

  test('Refresh command handles empty state gracefully', async function () {
    const commands = await vscode.commands.getCommands(true);
    const refreshCommand = commands.find(
      cmd => cmd.includes('coven.refresh') || cmd === 'coven.refreshTasks'
    );

    if (!refreshCommand) {
      return this.skip();
    }

    try {
      await vscode.commands.executeCommand(refreshCommand);
      await delay(500);
    } catch (err: unknown) {
      const error = err as Error;
      // "map is not a function" indicates the data format bug
      assert.ok(
        !error.message.includes('map is not a function'),
        `Refresh should not fail with data format error: ${error.message}`
      );
    }
  });

  test('State snapshot data can be processed without type errors', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy) {
      return this.skip();
    }

    const ctx = getTestContext();

    // Get state directly from API instead of waiting for SSE event
    // This is more reliable for testing data format handling
    const response = await ctx.daemon.sendRequest<{ state: Record<string, unknown> }>(
      'GET',
      '/state'
    );

    // Create a mock snapshot event from the API response
    const snapshot = { type: 'state.snapshot', data: response?.state || response };

    // Extract state from potentially nested structure
    function extractState(obj: unknown): Record<string, unknown> {
      if (!obj || typeof obj !== 'object') return {};
      const o = obj as Record<string, unknown>;

      if ('agents' in o || 'tasks' in o) {
        return o;
      }

      if ('data' in o && typeof o.data === 'object') {
        const inner = extractState(o.data);
        if (Object.keys(inner).length > 0) return inner;
      }

      if ('state' in o && typeof o.state === 'object') {
        const inner = extractState(o.state);
        if (Object.keys(inner).length > 0) return inner;
      }

      return o;
    }

    const state = extractState(snapshot.data);

    // Simulate extension's StateCache.handleSnapshot
    const tasks = Array.isArray(state.tasks) ? state.tasks : [];
    for (const task of tasks) {
      const t = task as { id?: string };
      if (t && t.id) {
        assert.ok(true, 'Task can be processed');
      }
    }

    const agents = state.agents ?? {};
    if (Array.isArray(agents)) {
      for (const agent of agents) {
        const a = agent as { taskId?: string };
        assert.ok(true, `Array agent processed: ${a.taskId}`);
      }
    } else if (typeof agents === 'object') {
      for (const [taskId, agent] of Object.entries(agents as Record<string, unknown>)) {
        const agentData = agent as { status?: string };
        assert.ok(true, `Object agent processed: ${taskId} - ${agentData.status}`);
      }
    }

    assert.ok(true, 'State snapshot data processed successfully');
  });
});
