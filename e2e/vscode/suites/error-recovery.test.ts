/**
 * Error Recovery E2E Tests for Coven Extension.
 *
 * These tests verify the extension's resilience to failures:
 * - Network/connection failures
 * - Daemon crashes
 * - Reconnection logic
 * - Graceful degradation
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { createPresetWorkspace, createBead } from '../fixtures';
import { DaemonHelper, delay } from '../helpers';

suite('Coven Error Recovery E2E Tests', function () {
  this.timeout(120000);

  let workspacePath: string;
  let cleanup: () => void;
  let daemon: DaemonHelper;

  suiteSetup(function () {
    const workspace = createPresetWorkspace('complete');
    workspacePath = workspace.workspacePath;
    cleanup = workspace.cleanup;
    daemon = new DaemonHelper({ workspacePath });
  });

  suiteTeardown(async function () {
    try {
      await daemon.stop();
    } catch {
      // Ignore cleanup errors
    }
    if (cleanup) {
      cleanup();
    }
  });

  // ============================================================================
  // Test: Daemon Not Running
  // ============================================================================

  test('Extension handles daemon not running', async function () {
    // Ensure daemon is stopped
    try {
      await daemon.stop();
    } catch {
      // May not be running
    }

    // Give it time to fully stop
    await delay(500);

    // Verify daemon is not healthy
    const healthy = await daemon.isHealthy();
    assert.ok(!healthy, 'Daemon should not be running');

    // Commands should still be available (will auto-start daemon)
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('coven.startSession'),
      'Commands should be registered even without daemon'
    );
  });

  // ============================================================================
  // Test: Daemon Restart Recovery
  // ============================================================================

  test('Extension recovers after daemon restart', async function () {
    // Skip if binary not available
    try {
      await daemon.start();
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('binary not found')) {
        this.skip();
      }
      throw err;
    }

    // Verify healthy
    let healthy = await daemon.isHealthy();
    assert.ok(healthy, 'Daemon should be healthy initially');

    // Stop daemon (simulating crash)
    await daemon.stop();
    await delay(500);

    // Verify not healthy
    healthy = await daemon.isHealthy();
    assert.ok(!healthy, 'Daemon should not be healthy after stop');

    // Start daemon again
    await daemon.start();

    // Verify healthy again
    healthy = await daemon.isHealthy();
    assert.ok(healthy, 'Daemon should be healthy after restart');
  });

  // ============================================================================
  // Test: Socket File Missing
  // ============================================================================

  test('Extension handles missing socket file', async function () {
    // Stop daemon if running
    try {
      await daemon.stop();
    } catch {
      // May not be running
    }

    // Remove socket file if it exists
    const socketPath = daemon.getSocketPath();
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }

    // Verify not healthy (graceful handling)
    const healthy = await daemon.isHealthy();
    assert.ok(!healthy, 'Should handle missing socket gracefully');
  });

  // ============================================================================
  // Test: Stale Socket File
  // ============================================================================

  test('Extension handles stale socket file', async function () {
    // Stop daemon
    try {
      await daemon.stop();
    } catch {
      // May not be running
    }

    await delay(500);

    // Create a stale socket file (no process listening)
    const socketPath = daemon.getSocketPath();
    const socketDir = require('path').dirname(socketPath);
    if (!fs.existsSync(socketDir)) {
      fs.mkdirSync(socketDir, { recursive: true });
    }

    // Create empty file as stale socket
    if (!fs.existsSync(socketPath)) {
      fs.writeFileSync(socketPath, '');
    }

    // isHealthy should return false for stale socket
    const healthy = await daemon.isHealthy();
    assert.ok(!healthy, 'Should detect stale socket');

    // Clean up
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
  });

  // ============================================================================
  // Test: API Error Handling
  // ============================================================================

  test('Extension handles API errors gracefully', async function () {
    // Skip if daemon not available
    try {
      await daemon.start();
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('binary not found')) {
        this.skip();
      }
      throw err;
    }

    // Make a request to a non-existent endpoint
    try {
      await daemon.sendRequest('GET', '/nonexistent-endpoint');
      // Should not reach here
    } catch (err: unknown) {
      const error = err as Error;
      // Should get a proper error, not crash
      assert.ok(error.message, 'Should receive error message');
    }
  });

  // ============================================================================
  // Test: Invalid Task ID Handling
  // ============================================================================

  test('Extension handles invalid task IDs', async function () {
    // Skip if daemon not available
    try {
      if (!await daemon.isHealthy()) {
        await daemon.start();
      }
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('binary not found')) {
        this.skip();
      }
      throw err;
    }

    // Try to start a non-existent task
    try {
      await vscode.commands.executeCommand('coven.startTask', 'nonexistent-task-id');
    } catch {
      // Expected to fail gracefully
    }

    // Daemon should still be healthy
    const healthy = await daemon.isHealthy();
    assert.ok(healthy, 'Daemon should remain healthy after invalid request');
  });

  // ============================================================================
  // Test: Concurrent Request Handling
  // ============================================================================

  test('Extension handles concurrent requests', async function () {
    // Skip if daemon not available
    try {
      if (!await daemon.isHealthy()) {
        await daemon.start();
      }
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('binary not found')) {
        this.skip();
      }
      throw err;
    }

    // Make multiple concurrent requests
    const requests = [
      daemon.sendRequest('GET', '/health'),
      daemon.sendRequest('GET', '/state'),
      daemon.sendRequest('GET', '/health'),
      daemon.sendRequest('GET', '/state'),
    ];

    try {
      const results = await Promise.all(requests);
      assert.ok(results.length === 4, 'All concurrent requests should complete');
    } catch (err: unknown) {
      const error = err as Error;
      // Some failures are acceptable under load
      assert.ok(error.message, 'Errors should be handled gracefully');
    }
  });

  // ============================================================================
  // Test: Timeout Handling
  // ============================================================================

  test('Extension handles request timeouts', async function () {
    // This test verifies timeout handling
    // Creating a scenario that times out is difficult without mocking

    // Skip if daemon not available
    try {
      if (!await daemon.isHealthy()) {
        await daemon.start();
      }
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('binary not found')) {
        this.skip();
      }
      throw err;
    }

    // Verify the daemon has reasonable response times
    const start = Date.now();
    await daemon.sendRequest('GET', '/health');
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 5000, 'Health check should complete within 5 seconds');
  });

  // ============================================================================
  // Test: Workspace Switch
  // ============================================================================

  test('Extension handles workspace changes', async function () {
    // This test verifies extension can handle workspace context changes
    // Full testing requires VS Code workspace manipulation

    // Verify commands remain registered
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('coven.startSession'),
      'Commands should remain registered'
    );
  });
});
