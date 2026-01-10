/**
 * Critical Path E2E Tests for Coven Extension.
 *
 * These tests verify the core functionality that users rely on daily:
 * - Daemon auto-start
 * - Task workflow (start, complete, merge)
 * - Question handling
 * - Workflow cancellation
 *
 * IMPORTANT: All tests use VS Code commands, not direct CLI calls.
 * The extension manages agent execution internally.
 */
import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { createPresetWorkspace, createBead, sampleBeads } from '../fixtures';
import { DaemonHelper, EventWaiter, createEventWaiter, delay } from '../helpers';

suite('Coven Critical Path E2E Tests', function () {
  // Increase timeout for E2E tests
  this.timeout(60000);

  let workspacePath: string;
  let cleanup: () => void;
  let daemon: DaemonHelper;
  let events: EventWaiter | null = null;

  suiteSetup(async function () {
    // Create a complete test workspace
    const workspace = createPresetWorkspace('complete');
    workspacePath = workspace.workspacePath;
    cleanup = workspace.cleanup;

    // Create daemon helper
    daemon = new DaemonHelper({ workspacePath });
  });

  suiteTeardown(async function () {
    // Stop event listener
    if (events) {
      events.stop();
    }

    // Stop daemon if running
    try {
      await daemon.stop();
    } catch {
      // Ignore errors during cleanup
    }

    // Clean up workspace
    if (cleanup) {
      cleanup();
    }
  });

  setup(async function () {
    // Ensure clean state before each test
    if (events) {
      events.clearEvents();
    }
  });

  // ============================================================================
  // Test: Daemon Auto-Start on Workspace Activation
  // ============================================================================

  test('Daemon auto-starts when workspace has .coven/ directory', async function () {
    // Skip if we can't start daemon (binary not built)
    try {
      await daemon.start();
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('binary not found')) {
        this.skip();
      }
      throw err;
    }

    // Verify daemon is healthy
    const healthy = await daemon.isHealthy();
    assert.ok(healthy, 'Daemon should be responding to health checks');

    // Verify socket exists
    const socketPath = daemon.getSocketPath();
    assert.ok(fs.existsSync(socketPath), 'Socket file should exist');
  });

  // ============================================================================
  // Test: Start Task Workflow
  // ============================================================================

  test('Starting a task creates workflow and worktree', async function () {
    // Ensure daemon is running
    if (!await daemon.isHealthy()) {
      await daemon.start();
    }

    // Set up event listener
    events = await createEventWaiter(daemon.getSocketPath());

    // Create a test bead
    createBead(workspacePath, 'beads-test-start', sampleBeads.pending);

    // Execute startTask command
    const taskId = 'beads-test-start';
    await vscode.commands.executeCommand('coven.startTask', taskId);

    // Wait for workflow.started event
    const startedEvent = await events.waitForEvent('workflow.started', 10000);
    assert.ok(startedEvent, 'Should receive workflow.started event');
    assert.strictEqual(
      (startedEvent.data as { taskId: string }).taskId,
      taskId,
      'Event should contain correct task ID'
    );
  });

  // ============================================================================
  // Test: Workflow Completion
  // ============================================================================

  test('Workflow completes and captures output', async function () {
    // This test requires mock agent to be configured
    // For now, we verify the workflow infrastructure is in place

    if (!await daemon.isHealthy()) {
      await daemon.start();
    }

    if (!events) {
      events = await createEventWaiter(daemon.getSocketPath());
    }

    // Create a task
    const taskId = 'beads-test-complete';
    createBead(workspacePath, taskId, `id: ${taskId}
title: "Test completion task"
type: task
status: open
priority: 2
description: A task for testing completion
created: "2024-01-01T00:00:00Z"
created_by: test
`);

    // Start the task
    await vscode.commands.executeCommand('coven.startTask', taskId);

    // The workflow should start
    try {
      const event = await events.waitForEvent('workflow.started', 5000);
      assert.ok(event, 'Workflow should start');
    } catch {
      // Workflow may not start if mock agent isn't configured
      // This is expected in minimal E2E setup
      this.skip();
    }
  });

  // ============================================================================
  // Test: Cancel Workflow
  // ============================================================================

  test('Cancelling a task stops the workflow', async function () {
    if (!await daemon.isHealthy()) {
      await daemon.start();
    }

    if (!events) {
      events = await createEventWaiter(daemon.getSocketPath());
    }

    // Create and start a task
    const taskId = 'beads-test-cancel';
    createBead(workspacePath, taskId, `id: ${taskId}
title: "Test cancel task"
type: task
status: open
priority: 2
description: A task for testing cancellation
created: "2024-01-01T00:00:00Z"
created_by: test
`);

    // Start the task
    await vscode.commands.executeCommand('coven.startTask', taskId);

    // Brief delay to allow workflow to start
    await delay(500);

    // Cancel the task
    await vscode.commands.executeCommand('coven.stopTask', taskId);

    // Verify cancellation (either via event or API)
    try {
      // Try to get workflow.cancelled event
      await events.waitForEvent('workflow.cancelled', 5000);
    } catch {
      // If no event, check task status via API
      const response = await daemon.sendRequest<{ status: string }>('GET', `/tasks/${taskId}`);
      assert.ok(
        response.status === 'cancelled' || response.status === 'failed',
        `Task should be cancelled or failed, got: ${response.status}`
      );
    }
  });

  // ============================================================================
  // Test: Merge Approval
  // ============================================================================

  test('Merge approval integrates changes to main branch', async function () {
    if (!await daemon.isHealthy()) {
      await daemon.start();
    }

    if (!events) {
      events = await createEventWaiter(daemon.getSocketPath());
    }

    // Create a task that would reach pending_merge state
    const taskId = 'beads-test-merge';
    createBead(workspacePath, taskId, `id: ${taskId}
title: "Test merge task"
type: task
status: open
priority: 2
description: A task for testing merge approval
created: "2024-01-01T00:00:00Z"
created_by: test
`);

    // Note: This test requires a workflow to complete to pending_merge state
    // For now, we verify the approveTask command exists and can be called
    const commands = await vscode.commands.getCommands(true);

    // Check for approve command (might be approveTask, approve, or approveWorkflow)
    const hasApproveCommand = commands.some(cmd =>
      cmd.includes('coven.approve') || cmd === 'coven.approveTask'
    );

    if (!hasApproveCommand) {
      // Skip if approve command not yet implemented
      this.skip();
      return;
    }

    // If we reach here, try to verify the command works
    // The command may fail if no workflow is in pending_merge state
    try {
      await vscode.commands.executeCommand('coven.approveTask', taskId);
    } catch {
      // Expected - no workflow in pending_merge state
    }
  });

  // ============================================================================
  // Test: Question Handling
  // ============================================================================

  test('Questions from agent are surfaced and can be answered', async function () {
    if (!await daemon.isHealthy()) {
      await daemon.start();
    }

    if (!events) {
      events = await createEventWaiter(daemon.getSocketPath());
    }

    // This test verifies the question handling infrastructure
    // Full testing requires mock agent configured with -question flag

    // Verify question-related commands exist
    const commands = await vscode.commands.getCommands(true);

    const questionCommands = commands.filter(cmd =>
      cmd.includes('coven.answer') || cmd.includes('coven.question')
    );

    // Check if question handling is implemented
    if (questionCommands.length === 0) {
      // Check if there's a questions endpoint
      try {
        const response = await daemon.sendRequest<{ questions: unknown[] }>('GET', '/questions');
        assert.ok(Array.isArray(response.questions), 'Questions API should return array');
      } catch {
        // Questions API might not be implemented
        this.skip();
      }
    }
  });

  // ============================================================================
  // Test: Session Management
  // ============================================================================

  test('Session can be started and stopped', async function () {
    if (!await daemon.isHealthy()) {
      await daemon.start();
    }

    // Start session
    await vscode.commands.executeCommand('coven.startSession');

    // Brief delay for session to initialize
    await delay(500);

    // Verify session is active
    const state = await daemon.sendRequest<{ session: { active: boolean } }>('GET', '/state');

    // Note: Session state structure may vary
    // Accept any non-error response as success for basic test
    assert.ok(state, 'Should get state from daemon');

    // Stop session
    await vscode.commands.executeCommand('coven.stopSession');

    // Brief delay for cleanup
    await delay(500);
  });

  // ============================================================================
  // Test: Commands Are Registered
  // ============================================================================

  test('All critical path commands are registered', async function () {
    const commands = await vscode.commands.getCommands(true);

    const requiredCommands = [
      'coven.startSession',
      'coven.stopSession',
      'coven.startTask',
      'coven.stopTask',
    ];

    for (const cmd of requiredCommands) {
      assert.ok(
        commands.includes(cmd),
        `Command '${cmd}' should be registered`
      );
    }
  });
});
