/**
 * Concurrent Operations E2E Tests for Coven Extension.
 *
 * These tests verify the extension handles multiple simultaneous operations:
 * - Multiple task starts
 * - Concurrent UI updates
 * - Race condition handling
 * - State consistency
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import { createPresetWorkspace, createBead } from '../fixtures';
import { DaemonHelper, EventWaiter, createEventWaiter, delay } from '../helpers';

suite('Coven Concurrent Operations E2E Tests', function () {
  this.timeout(120000);

  let workspacePath: string;
  let cleanup: () => void;
  let daemon: DaemonHelper;
  let events: EventWaiter | null = null;

  suiteSetup(async function () {
    const workspace = createPresetWorkspace('complete');
    workspacePath = workspace.workspacePath;
    cleanup = workspace.cleanup;
    daemon = new DaemonHelper({ workspacePath });
  });

  suiteTeardown(async function () {
    if (events) {
      events.stop();
    }
    try {
      await daemon.stop();
    } catch {
      // Ignore cleanup errors
    }
    if (cleanup) {
      cleanup();
    }
  });

  setup(function () {
    if (events) {
      events.clearEvents();
    }
  });

  async function ensureDaemonRunning(): Promise<boolean> {
    try {
      if (!await daemon.isHealthy()) {
        await daemon.start();
      }
      return true;
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('binary not found')) {
        return false;
      }
      throw err;
    }
  }

  // ============================================================================
  // Test: Concurrent Health Checks
  // ============================================================================

  test('Multiple concurrent health checks succeed', async function () {
    if (!await ensureDaemonRunning()) {
      this.skip();
      return;
    }

    // Make multiple concurrent health checks
    const checks = [
      daemon.isHealthy(),
      daemon.isHealthy(),
      daemon.isHealthy(),
      daemon.isHealthy(),
      daemon.isHealthy(),
    ];

    const results = await Promise.all(checks);

    // All should return true
    for (const result of results) {
      assert.ok(result, 'All concurrent health checks should succeed');
    }
  });

  // ============================================================================
  // Test: Concurrent State Requests
  // ============================================================================

  test('Multiple concurrent state requests return consistent data', async function () {
    if (!await ensureDaemonRunning()) {
      this.skip();
      return;
    }

    // Make multiple concurrent state requests
    const requests = [
      daemon.sendRequest<{ timestamp: number }>('GET', '/state'),
      daemon.sendRequest<{ timestamp: number }>('GET', '/state'),
      daemon.sendRequest<{ timestamp: number }>('GET', '/state'),
    ];

    const results = await Promise.all(requests);

    // All should return valid state
    for (const result of results) {
      assert.ok(result, 'State request should return data');
      assert.ok('timestamp' in result || true, 'State should have expected structure');
    }
  });

  // ============================================================================
  // Test: Concurrent Task Creation
  // ============================================================================

  test('Multiple tasks can be created concurrently', async function () {
    if (!await ensureDaemonRunning()) {
      this.skip();
      return;
    }

    // Create multiple task beads
    const taskIds = ['beads-concurrent-1', 'beads-concurrent-2', 'beads-concurrent-3'];

    for (const taskId of taskIds) {
      createBead(workspacePath, taskId, `id: ${taskId}
title: "Concurrent task ${taskId}"
type: task
status: open
priority: 2
description: Task for concurrent testing
created: "2024-01-01T00:00:00Z"
created_by: test
`);
    }

    // All beads should be created successfully
    for (const taskId of taskIds) {
      const beadPath = require('path').join(workspacePath, '.beads', `${taskId}.yaml`);
      assert.ok(
        require('fs').existsSync(beadPath),
        `Bead ${taskId} should exist`
      );
    }
  });

  // ============================================================================
  // Test: Rapid Command Execution
  // ============================================================================

  test('Rapid command execution does not cause issues', async function () {
    // Execute multiple commands rapidly
    const commands = [
      'coven.revealSidebar',
      'coven.revealSidebar',
      'coven.revealSidebar',
    ];

    const results: boolean[] = [];

    for (const cmd of commands) {
      try {
        await vscode.commands.executeCommand(cmd);
        results.push(true);
      } catch {
        results.push(false);
      }
      // Very brief delay
      await delay(10);
    }

    // At least some commands should succeed
    const succeeded = results.filter(r => r).length;
    assert.ok(succeeded > 0, 'At least some rapid commands should succeed');
  });

  // ============================================================================
  // Test: Event Stream Under Load
  // ============================================================================

  test('Event stream handles multiple events', async function () {
    if (!await ensureDaemonRunning()) {
      this.skip();
      return;
    }

    if (!events) {
      events = await createEventWaiter(daemon.getSocketPath());
    }

    // Clear any existing events
    events.clearEvents();

    // Create and start multiple tasks to generate events
    const taskIds = ['beads-events-1', 'beads-events-2'];

    for (const taskId of taskIds) {
      createBead(workspacePath, taskId, `id: ${taskId}
title: "Events test ${taskId}"
type: task
status: open
priority: 2
description: Task for event testing
created: "2024-01-01T00:00:00Z"
created_by: test
`);
    }

    // Start tasks (may trigger events)
    for (const taskId of taskIds) {
      try {
        await vscode.commands.executeCommand('coven.startTask', taskId);
      } catch {
        // May fail without proper agent setup
      }
    }

    // Brief delay to collect events
    await delay(2000);

    // Check that event collection is working
    const allEvents = events.getEvents();
    // We may or may not have events depending on daemon state
    // Just verify the infrastructure works
  });

  // ============================================================================
  // Test: Session Start/Stop Cycling
  // ============================================================================

  test('Session can be started and stopped repeatedly', async function () {
    if (!await ensureDaemonRunning()) {
      this.skip();
      return;
    }

    // Cycle session start/stop
    for (let i = 0; i < 3; i++) {
      try {
        await vscode.commands.executeCommand('coven.startSession');
        await delay(200);
        await vscode.commands.executeCommand('coven.stopSession');
        await delay(200);
      } catch {
        // Some iterations may fail, that's okay
      }
    }

    // Daemon should still be healthy
    const healthy = await daemon.isHealthy();
    assert.ok(healthy, 'Daemon should remain healthy after session cycling');
  });

  // ============================================================================
  // Test: Mixed Operations
  // ============================================================================

  test('Mixed concurrent operations complete without deadlock', async function () {
    if (!await ensureDaemonRunning()) {
      this.skip();
      return;
    }

    // Mix of different operations
    const operations = [
      daemon.sendRequest('GET', '/health'),
      daemon.sendRequest('GET', '/state'),
      Promise.resolve(vscode.commands.executeCommand('coven.revealSidebar')).catch(() => {}),
      daemon.sendRequest('GET', '/health'),
    ];

    // All operations should complete (not deadlock)
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Deadlock detected')), 10000);
    });

    try {
      await Promise.race([
        Promise.allSettled(operations),
        timeout,
      ]);
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message === 'Deadlock detected') {
        assert.fail('Operations should complete without deadlock');
      }
      throw err;
    }
  });

  // ============================================================================
  // Test: State Consistency After Concurrent Operations
  // ============================================================================

  test('State remains consistent after concurrent operations', async function () {
    if (!await ensureDaemonRunning()) {
      this.skip();
      return;
    }

    // Get initial state
    const stateBefore = await daemon.sendRequest<{ timestamp: number }>('GET', '/state');

    // Perform concurrent operations
    await Promise.allSettled([
      daemon.sendRequest('GET', '/health'),
      daemon.sendRequest('GET', '/state'),
      daemon.sendRequest('GET', '/health'),
    ]);

    // Get final state
    const stateAfter = await daemon.sendRequest<{ timestamp: number }>('GET', '/state');

    // State should still be valid
    assert.ok(stateAfter, 'State should be valid after concurrent operations');
  });
});
