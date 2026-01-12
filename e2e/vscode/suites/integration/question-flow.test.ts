/**
 * Integration E2E Tests - Question Flow
 *
 * Tests the interactive question-answering workflow where
 * agents can ask questions and receive responses.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  TestContext,
  initTestContext,
  cleanupTestContext,
  getEventWaiter,
  ensureTestIsolation,
  clearEvents,
  resetForSuite,
  waitForExtensionConnected,
} from '../setup';
import { BeadsClient, isBeadsAvailable } from '../../helpers/beads-client';

suite('Integration - Question Flow', function () {
  this.timeout(90000); // 90 second timeout

  let ctx: TestContext;
  let beads: BeadsClient;
  let testTaskIds: string[] = [];

  suiteSetup(async function () {
    if (!isBeadsAvailable()) {
      console.log('Beads CLI not available, skipping question flow tests');
      this.skip();
      return;
    }

    try {
      // CRITICAL: Reset for fresh suite - clean up any lingering state from previous suites
      // This answers pending questions, cancels workflows, and restarts daemon
      await resetForSuite({ question: true, delay: '100ms' });

      // Initialize base context first (doesn't restart daemon yet)
      ctx = await initTestContext();
      beads = new BeadsClient(ctx.workspacePath);

      if (!beads.isInitialized()) {
        beads.initialize();
      }

      // Ensure mock agent is built before configuring
      if (!ctx.mockAgent.isBuilt()) {
        await ctx.mockAgent.ensureBuilt();
      }

      // Configure mock agent and restart daemon
      ctx.mockAgent.configure({ question: true, delay: '100ms' });
      await ctx.daemon.restart();
      await waitForExtensionConnected();

      beads.cleanupTestTasks('E2E Question');
    } catch (err) {
      console.error('Suite setup failed:', err);
      throw err;
    }
  });

  suiteTeardown(async function () {
    for (const taskId of testTaskIds) {
      try {
        beads.closeTask(taskId, 'E2E test cleanup');
      } catch {
        // Ignore
      }
    }
    await cleanupTestContext();
  });

  setup(async function () {
    // Ensure no workflows are running from previous tests
    await ensureTestIsolation();
  });

  test('Question appears in UI and can be answered', async function () {
    const ui = ctx.ui;

    // Get event waiter early so we don't miss events
    const events = await getEventWaiter();

    // 1. Create a task (uses default workflow which works with mock agent)
    const taskTitle = `E2E Question Test ${Date.now()}`;
    const taskId = beads.createTask({ title: taskTitle, type: 'task', priority: 2 });
    testTaskIds.push(taskId);
    console.log(`Created task: ${taskId}`);

    // 2. Start task
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(taskId, 'ready', 15000);
    await vscode.commands.executeCommand('coven.startTask', taskId);

    // 3. Wait for task to become active
    await ui.waitForTaskInSection(taskId, 'active', 10000);
    console.log('Task is active');

    // 4. Wait for question to appear in UI
    await ui.waitForQuestion(taskId, 20000);
    console.log('Question appeared in tree view');

    // 5. Verify status bar shows question indicator
    const statusWithQuestion = await ui.waitForStatusBar(
      (state) => state.questionCount >= 1,
      5000,
      'question count in status bar'
    );
    assert.ok(statusWithQuestion.hasWarningBackground, 'Status bar should have warning background');
    console.log('Status bar shows question indicator');

    // 6. Get questions from daemon to verify structure
    const questionsResult = await ctx.directClient.getQuestions();
    assert.ok(questionsResult.questions.length > 0, 'Should have at least one question');

    const question = questionsResult.questions.find(q => q.task_id === taskId);
    assert.ok(question, 'Should find question for our task');
    console.log(`Question text: ${question.text}`);

    // 7. Answer the question via daemon API
    await ctx.directClient.answerQuestion(question.id, 'y');
    console.log('Answered question');

    // 8. Wait for question to be cleared from UI
    await ui.waitForStatusBar(
      (state) => state.questionCount === 0,
      10000,
      'question cleared'
    );
    console.log('Question cleared from status bar');

    // 9. Wait for agent to complete (it should continue after answer)
    // Give longer timeout since agent may have delay after answer
    await events.waitForEvent('agent.completed', 45000);
    console.log('Agent completed after answering question');

    // 10. Verify task is no longer active
    await ui.waitForTreeState(
      (state) => !state.active.includes(taskId),
      10000,
      'task completed'
    );
    console.log('Question flow test completed successfully');
  });

  test('Status bar pulses when question pending', async function () {
    const ui = ctx.ui;

    // 1. Create and start a task with questioning agent
    const taskTitle = `E2E Question Pulse Test ${Date.now()}`;
    const taskId = beads.createTask({ title: taskTitle, type: 'task', priority: 2 });
    testTaskIds.push(taskId);

    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(taskId, 'ready', 15000);
    await vscode.commands.executeCommand('coven.startTask', taskId);
    await ui.waitForTaskInSection(taskId, 'active', 10000);

    // 2. Wait for question to appear
    await ui.waitForQuestion(taskId, 20000);

    // 3. Verify status bar has warning background (pulse indicator)
    const status = await ui.getStatusBarState();
    assert.ok(status, 'Should get status bar state');
    assert.ok(status.hasWarningBackground, 'Status bar should pulse with warning background');
    assert.ok(status.questionCount >= 1, 'Question count should be >= 1');

    console.log('Status bar pulse verified');

    // 4. Clean up - answer the question to let agent complete
    const questionsResult = await ctx.directClient.getQuestions();
    const question = questionsResult.questions.find(q => q.task_id === taskId);
    if (question) {
      await ctx.directClient.answerQuestion(question.id, 'y');
    }

    // Wait for completion
    await ui.waitForTreeState(
      (state) => !state.active.includes(taskId),
      30000,
      'task completed after cleanup'
    );
  });

  test('Multiple questions can be handled sequentially', async function () {
    // This test requires a mock agent that asks multiple questions
    // For now, we test with sequential tasks that each ask one question
    const ui = ctx.ui;

    // Create two tasks
    const task1Title = `E2E Multi-Question 1 ${Date.now()}`;
    const task2Title = `E2E Multi-Question 2 ${Date.now()}`;

    const task1Id = beads.createTask({ title: task1Title, type: 'task', priority: 2 });
    const task2Id = beads.createTask({ title: task2Title, type: 'task', priority: 2 });
    testTaskIds.push(task1Id, task2Id);

    await vscode.commands.executeCommand('coven.refreshTasks');
    await ui.waitForTaskInSection(task1Id, 'ready', 15000);

    // Start first task
    await vscode.commands.executeCommand('coven.startTask', task1Id);
    await ui.waitForTaskInSection(task1Id, 'active', 10000);

    // Wait for question from first task
    await ui.waitForQuestion(task1Id, 20000);
    console.log('First task has question');

    // Answer first question
    let questionsResult = await ctx.directClient.getQuestions();
    let question = questionsResult.questions.find(q => q.task_id === task1Id);
    assert.ok(question, 'Should find question for task 1');
    await ctx.directClient.answerQuestion(question.id, 'y');

    // Wait for first task to complete
    await ui.waitForTreeState(
      (state) => !state.active.includes(task1Id),
      30000,
      'task 1 completed'
    );
    console.log('First task completed');

    // Start second task
    clearEvents();
    await ui.waitForTaskInSection(task2Id, 'ready', 10000);
    await vscode.commands.executeCommand('coven.startTask', task2Id);
    await ui.waitForTaskInSection(task2Id, 'active', 10000);

    // Wait for question from second task
    await ui.waitForQuestion(task2Id, 20000);
    console.log('Second task has question');

    // Answer second question
    questionsResult = await ctx.directClient.getQuestions();
    question = questionsResult.questions.find(q => q.task_id === task2Id);
    assert.ok(question, 'Should find question for task 2');
    await ctx.directClient.answerQuestion(question.id, 'y');

    // Wait for second task to complete
    await ui.waitForTreeState(
      (state) => !state.active.includes(task2Id),
      30000,
      'task 2 completed'
    );
    console.log('Sequential questions test completed');
  });
});
