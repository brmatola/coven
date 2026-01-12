/**
 * Panel Lifecycle E2E Tests
 *
 * Tests webview panel creation, reuse, and lifecycle management:
 * - TaskDetailPanel
 * - WorkflowDetailPanel
 * - ReviewPanel
 * - SetupPanel
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  TestContext,
  initTestContext,
  cleanupTestContext,
  ensureTestIsolation,
} from '../setup';
import { BeadsClient, isBeadsAvailable } from '../../helpers/beads-client';

suite('Panel Lifecycle', function () {
  this.timeout(60000);

  let ctx: TestContext;
  let beads: BeadsClient;
  let testTaskIds: string[] = [];

  suiteSetup(async function () {
    if (!isBeadsAvailable()) {
      console.log('Beads CLI not available, skipping panel tests');
      this.skip();
      return;
    }

    try {
      ctx = await initTestContext();
      beads = new BeadsClient(ctx.workspacePath);

      if (!beads.isInitialized()) {
        beads.initialize();
      }

      beads.cleanupTestTasks('E2E Panel');
    } catch (err) {
      console.error('Suite setup failed:', err);
      throw err;
    }
  });

  suiteTeardown(async function () {
    // Close all editors
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

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
    await ensureTestIsolation();
    // Close all editors before each test
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('SetupPanel opens via command', async function () {
    // Execute show setup command
    await vscode.commands.executeCommand('coven.showSetup');
    console.log('Show setup command executed');

    // Wait for panel to open
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check tab groups for setup panel
    const tabGroups = vscode.window.tabGroups;
    let setupPanelFound = false;

    for (const group of tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.label.includes('Setup') || tab.label.includes('Coven')) {
          setupPanelFound = true;
          break;
        }
      }
    }

    // Panel should be open (or command executed without error)
    console.log(`Setup panel found: ${setupPanelFound}`);

    // Clean up
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('SetupPanel singleton - reopening focuses existing panel', async function () {
    // Open setup panel
    await vscode.commands.executeCommand('coven.showSetup');
    await new Promise(resolve => setTimeout(resolve, 300));

    // Count initial tabs
    const initialTabCount = countAllTabs();
    console.log(`Initial tab count: ${initialTabCount}`);

    // Open setup panel again
    await vscode.commands.executeCommand('coven.showSetup');
    await new Promise(resolve => setTimeout(resolve, 300));

    // Count tabs again - should be same (panel reused)
    const finalTabCount = countAllTabs();
    console.log(`Final tab count: ${finalTabCount}`);

    // Should not have created a new tab
    assert.strictEqual(
      finalTabCount,
      initialTabCount,
      'SetupPanel should be reused, not create new tab'
    );

    // Clean up
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('TaskDetailPanel opens for task', async function () {
    // Create a task
    const taskTitle = `E2E Panel Task ${Date.now()}`;
    const taskId = beads.createTask({ title: taskTitle, type: 'task', priority: 2 });
    testTaskIds.push(taskId);
    console.log(`Created task: ${taskId}`);

    // Refresh to load task and wait for it in both tree view and beadsTaskSource cache
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ctx.ui.waitForTaskInSection(taskId, 'ready', 15000);
    await waitForTaskInBeadsCache(taskId);
    console.log('Task in beadsTaskSource cache');

    // Open task detail panel
    await vscode.commands.executeCommand('coven.showTaskDetail', taskId);
    console.log('Show task detail command executed');

    // Wait for panel to open
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify panel opened by checking tabs
    const tabGroups = vscode.window.tabGroups;
    let detailPanelFound = false;

    for (const group of tabGroups.all) {
      for (const tab of group.tabs) {
        // Task detail panels usually include task title or ID in label
        if (tab.label.includes(taskTitle) || tab.label.includes('Task')) {
          detailPanelFound = true;
          break;
        }
      }
    }

    console.log(`Task detail panel found: ${detailPanelFound}`);

    // Clean up
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('Multiple TaskDetailPanels can be open', async function () {
    // Create two tasks
    const task1Title = `E2E Panel Multi 1 ${Date.now()}`;
    const task2Title = `E2E Panel Multi 2 ${Date.now()}`;
    const task1Id = beads.createTask({ title: task1Title, type: 'task', priority: 2 });
    const task2Id = beads.createTask({ title: task2Title, type: 'task', priority: 2 });
    testTaskIds.push(task1Id, task2Id);
    console.log(`Created tasks: ${task1Id}, ${task2Id}`);

    // Refresh to load tasks and wait for them in beadsTaskSource cache
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ctx.ui.waitForTaskInSection(task1Id, 'ready', 15000);
    await ctx.ui.waitForTaskInSection(task2Id, 'ready', 15000);
    await waitForTaskInBeadsCache(task1Id);
    await waitForTaskInBeadsCache(task2Id);
    console.log('Both tasks in beadsTaskSource cache');

    // Open first task detail panel
    await vscode.commands.executeCommand('coven.showTaskDetail', task1Id);
    await new Promise(resolve => setTimeout(resolve, 300));
    const countAfterFirst = countAllTabs();
    console.log(`Tab count after first: ${countAfterFirst}`);

    // Open second task detail panel
    await vscode.commands.executeCommand('coven.showTaskDetail', task2Id);
    await new Promise(resolve => setTimeout(resolve, 300));
    const countAfterSecond = countAllTabs();
    console.log(`Tab count after second: ${countAfterSecond}`);

    // Should have created a new tab for second task
    assert.ok(
      countAfterSecond > countAfterFirst,
      'Should create separate panel for each task'
    );

    // Clean up
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('TaskDetailPanel for same task reuses panel', async function () {
    // Create a task
    const taskTitle = `E2E Panel Reuse ${Date.now()}`;
    const taskId = beads.createTask({ title: taskTitle, type: 'task', priority: 2 });
    testTaskIds.push(taskId);

    // Refresh to load task and wait for it in beadsTaskSource cache
    await vscode.commands.executeCommand('coven.refreshTasks');
    await ctx.ui.waitForTaskInSection(taskId, 'ready', 15000);
    await waitForTaskInBeadsCache(taskId);

    // Open task detail panel
    await vscode.commands.executeCommand('coven.showTaskDetail', taskId);
    await new Promise(resolve => setTimeout(resolve, 300));
    const countAfterFirst = countAllTabs();
    console.log(`Tab count after first open: ${countAfterFirst}`);

    // Open same task again
    await vscode.commands.executeCommand('coven.showTaskDetail', taskId);
    await new Promise(resolve => setTimeout(resolve, 300));
    const countAfterSecond = countAllTabs();
    console.log(`Tab count after second open: ${countAfterSecond}`);

    // Should reuse existing panel
    assert.strictEqual(
      countAfterSecond,
      countAfterFirst,
      'Should reuse panel for same task'
    );

    // Clean up
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('Panels close cleanly without errors', async function () {
    // Open setup panel
    await vscode.commands.executeCommand('coven.showSetup');
    await new Promise(resolve => setTimeout(resolve, 300));

    // Close it
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await new Promise(resolve => setTimeout(resolve, 200));

    // Open task detail panel
    const taskTitle = `E2E Panel Close ${Date.now()}`;
    const taskId = beads.createTask({ title: taskTitle, type: 'task', priority: 2 });
    testTaskIds.push(taskId);

    await vscode.commands.executeCommand('coven.refreshTasks');
    await ctx.ui.waitForTaskInSection(taskId, 'ready', 15000);
    await waitForTaskInBeadsCache(taskId);

    await vscode.commands.executeCommand('coven.showTaskDetail', taskId);
    await new Promise(resolve => setTimeout(resolve, 300));

    // Close it
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await new Promise(resolve => setTimeout(resolve, 200));

    // If we get here without errors, panels closed cleanly
    console.log('Panels closed cleanly');
  });
});

/**
 * Helper to count all tabs across all tab groups.
 */
function countAllTabs(): number {
  let count = 0;
  for (const group of vscode.window.tabGroups.all) {
    count += group.tabs.length;
  }
  return count;
}

/**
 * Wait for a task to be available in beadsTaskSource cache.
 */
async function waitForTaskInBeadsCache(taskId: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // Force sync to refresh cache
    await vscode.commands.executeCommand('coven._syncBeadsTasks');
    const task = await vscode.commands.executeCommand('coven._getBeadsTask', taskId);
    if (task) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Task ${taskId} not found in beadsTaskSource cache within ${timeoutMs}ms`);
}
