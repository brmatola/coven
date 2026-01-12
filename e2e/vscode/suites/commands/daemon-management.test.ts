/**
 * Daemon Management Command E2E Tests
 *
 * Tests commands for managing the daemon lifecycle:
 * - coven.stopDaemon
 * - coven.restartDaemon
 * - coven.viewDaemonLogs
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  TestContext,
  initTestContext,
  cleanupTestContext,
  waitForExtensionConnected,
} from '../setup';

suite('Daemon Management Commands', function () {
  this.timeout(60000);

  let ctx: TestContext;

  suiteSetup(async function () {
    try {
      ctx = await initTestContext();

      // Skip if using VS Code daemon (we can't control it)
      if (ctx.usingVSCodeDaemon) {
        console.log('Using VS Code daemon - skipping daemon management tests');
        this.skip();
        return;
      }
    } catch (err) {
      console.error('Suite setup failed:', err);
      throw err;
    }
  });

  suiteTeardown(async function () {
    // Ensure daemon is restarted for other tests
    try {
      if (ctx && !ctx.usingVSCodeDaemon) {
        await ctx.daemon.start();
        await waitForExtensionConnected();
      }
    } catch {
      // Ignore if already running
    }
    await cleanupTestContext();
  });

  test('coven.stopDaemon - stops the daemon gracefully', async function () {
    const ui = ctx.ui;

    // Verify we're initially connected
    await ui.waitForConnected(10000);
    console.log('Initially connected to daemon');

    // Configure dialog mock to confirm stop (if dialog is shown)
    await ctx.dialogMock.queueResponse('stop', { button: 'Stop' });

    // Execute stop daemon command
    await vscode.commands.executeCommand('coven.stopDaemon');
    console.log('Stop daemon command executed');

    // Verify daemon stopped
    const isRunning = await ctx.daemon.isHealthy();
    assert.strictEqual(isRunning, false, 'Daemon should be stopped');

    // Wait for UI to show disconnected
    await ui.waitForDisconnected(10000);
    console.log('UI shows disconnected');

    // Restart for next test
    await ctx.daemon.start();
    await waitForExtensionConnected();
  });

  test('coven.restartDaemon - restarts daemon and reconnects', async function () {
    const ui = ctx.ui;

    // Ensure daemon is running
    if (!(await ctx.daemon.isHealthy())) {
      await ctx.daemon.start();
      await waitForExtensionConnected();
    }
    await ui.waitForConnected(10000);
    console.log('Initially connected');

    // Execute restart command
    await vscode.commands.executeCommand('coven.restartDaemon');
    console.log('Restart daemon command executed');

    // Wait for reconnection (restart may cause brief disconnect)
    await ui.waitForConnected(30000);
    console.log('Reconnected after restart');

    // Verify daemon is healthy
    const isHealthy = await ctx.daemon.isHealthy();
    assert.strictEqual(isHealthy, true, 'Daemon should be healthy after restart');
  });

  test('coven.viewDaemonLogs - opens daemon log file', async function () {
    // Ensure daemon is running to have logs
    if (!(await ctx.daemon.isHealthy())) {
      await ctx.daemon.start();
      await waitForExtensionConnected();
    }

    // Close all editors first
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    // Execute view logs command
    await vscode.commands.executeCommand('coven.viewDaemonLogs');
    console.log('View daemon logs command executed');

    // Wait for editor to open
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify log file is open in editor
    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, 'Should have an active editor');
    assert.ok(
      activeEditor.document.fileName.includes('covend.log'),
      `Active editor should be daemon log file, got: ${activeEditor.document.fileName}`
    );
    console.log('Daemon log file opened successfully');

    // Clean up
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('coven.stopDaemon - shows info when daemon not running', async function () {
    // Stop daemon first
    if (await ctx.daemon.isHealthy()) {
      await ctx.daemon.stop();
    }

    // Wait for UI to show disconnected
    await ctx.ui.waitForDisconnected(10000);

    // Clear any previous dialog invocations
    await ctx.dialogMock.clearInvocations();

    // Execute stop command when daemon is already stopped
    await vscode.commands.executeCommand('coven.stopDaemon');
    console.log('Stop command executed while daemon not running');

    // Should show info message (not error)
    const invocations = await ctx.dialogMock.getInvocations();
    const infoInvocation = invocations.find(
      inv => inv.method === 'showInformationMessage' && inv.message?.includes('not running')
    );
    assert.ok(
      infoInvocation,
      'Should show info message that daemon is not running'
    );
    console.log('Info message shown correctly');

    // Restart for cleanup
    await ctx.daemon.start();
    await waitForExtensionConnected();
  });
});
