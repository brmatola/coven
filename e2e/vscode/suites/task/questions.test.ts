/**
 * Question Handling E2E Tests
 *
 * Tests the workflow when an agent asks a question and waits for user input.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  TestContext,
  initTestContextWithMockAgent,
  getTestContext,
  cleanupTestContext,
  getEventWaiter,
  clearEvents,
} from '../setup';
import { BeadsClient, isBeadsAvailable } from '../../helpers/beads-client';

suite('Question Handling', function () {
  this.timeout(60000);

  let ctx: TestContext;
  let beads: BeadsClient;
  let testTaskId: string | null = null;

  suiteSetup(async function () {
    if (!isBeadsAvailable()) {
      console.log('Beads CLI not available, skipping question tests');
      this.skip();
      return;
    }

    try {
      // Initialize with mock agent configured to ask a question
      ctx = await initTestContextWithMockAgent({ question: true, delay: '100ms' });
      beads = new BeadsClient(ctx.workspacePath);

      if (!beads.isInitialized()) {
        beads.initialize();
      }

      beads.cleanupTestTasks('E2E Question');
    } catch (err) {
      console.error('Suite setup failed:', err);
      throw err;
    }
  });

  suiteTeardown(async function () {
    if (testTaskId && beads) {
      try {
        beads.closeTask(testTaskId, 'E2E test cleanup');
      } catch {
        // Ignore cleanup errors
      }
    }
    await cleanupTestContext();
  });

  setup(function () {
    clearEvents();
  });

  test('Question appears in tree view and can be answered', async function () {
    const ui = ctx.ui;
    const events = await getEventWaiter();

    // Create and start a task
    const taskTitle = `E2E Question Test ${Date.now()}`;
    testTaskId = beads.createTask({
      title: taskTitle,
      type: 'task',
      priority: 2,
    });
    console.log(`Created test task: ${testTaskId}`);

    // Refresh and start task
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(testTaskId, 'ready', 10000);
    await vscode.commands.executeCommand('coven.startTask', testTaskId);

    // Wait for task to become active
    await ui.waitForTaskInSection(testTaskId, 'active', 5000);
    console.log('Task is active');

    // Wait for question event from daemon
    // The mock agent with -question flag outputs a question
    const questionEvent = await events.waitForEvent('agent.question', 20000);
    console.log('Received question event:', questionEvent);

    // Verify question appears in tree view
    await ui.waitForQuestion(testTaskId, 5000);
    console.log('Question appears in tree view');

    // Verify status bar shows pending question
    await ui.waitForStatusBar(
      (state) => state.questionCount >= 1,
      5000,
      'pending question count'
    );
    console.log('Status bar shows pending question');

    // Get the question ID from cache state to answer it
    const cacheState = await ui.getCacheState();
    const questions = cacheState?.questions as Array<{ id: string; task_id: string }> | undefined;
    const question = questions?.find((q) => q.task_id === testTaskId);

    if (question) {
      // Answer the question via daemon API (command shows dialog which can't be automated)
      await ctx.directClient.answerQuestion(question.id, 'y');
      console.log('Answered question via daemon API');
    } else {
      // If we can't find the question in cache, try answering via stdin
      // The mock agent reads from stdin
      console.log('Question not found in cache, waiting for agent to complete');
    }

    // Wait for agent to complete after receiving answer
    await events.waitForEvent('agent.completed', 30000);
    console.log('Agent completed');

    // Verify question is cleared from tree view
    await ui.waitForTreeState(
      (state) => !state.questions.includes(testTaskId!),
      10000,
      'question cleared from tree view'
    );

    // Verify status bar no longer shows pending question
    await ui.waitForStatusBar(
      (state) => state.questionCount === 0,
      5000,
      'no pending questions'
    );
  });

  test('Status bar pulses when question is pending', async function () {
    const ui = ctx.ui;

    // Create and start a task
    const taskTitle = `E2E Question Pulse Test ${Date.now()}`;
    const taskId = beads.createTask({
      title: taskTitle,
      type: 'task',
      priority: 2,
    });

    try {
      await vscode.commands.executeCommand('coven.refreshTasks');
      await ui.waitForTaskInSection(taskId, 'ready', 10000);
      await vscode.commands.executeCommand('coven.startTask', taskId);

      // Wait for question
      const events = await getEventWaiter();
      await events.waitForEvent('agent.question', 20000);

      // Verify status bar has warning background (pulsing)
      await ui.waitForStatusBar(
        (state) => state.hasWarningBackground,
        5000,
        'status bar warning background'
      );

      // Answer the question to clean up
      const cacheState = await ui.getCacheState();
      const questions = cacheState?.questions as Array<{ id: string; task_id: string }> | undefined;
      const question = questions?.find((q) => q.task_id === taskId);
      if (question) {
        await ctx.directClient.answerQuestion(question.id, 'y');
      }

      // Wait for completion
      await events.waitForEvent('agent.completed', 30000);
    } finally {
      try {
        beads.closeTask(taskId, 'E2E test cleanup');
      } catch {
        // Ignore
      }
    }
  });
});
