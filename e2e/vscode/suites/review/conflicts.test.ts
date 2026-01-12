/**
 * Review E2E Tests - Conflict Handling
 *
 * Tests merge conflict detection and resolution during review.
 *
 * NOTE: These tests require grimoire workflow functionality to be working.
 * The grimoire workflow system (which creates worktrees and manages merges)
 * appears to have issues where tasks with grimoire labels don't start
 * workflows as expected. These tests are skipped until that functionality
 * is verified to work.
 */
import {
  TestContext,
  initTestContext,
  cleanupTestContext,
  ensureTestIsolation,
  resetForSuite,
  waitForExtensionConnected,
} from '../setup';
import { BeadsClient, isBeadsAvailable } from '../../helpers/beads-client';

suite('Review - Conflict Handling', function () {
  this.timeout(120000);

  let ctx: TestContext;
  let beads: BeadsClient;
  let testTaskIds: string[] = [];

  suiteSetup(async function () {
    if (!isBeadsAvailable()) {
      console.log('Beads CLI not available, skipping conflict tests');
      this.skip();
      return;
    }

    try {
      // CRITICAL: Reset for fresh suite - clean up any lingering state from previous suites
      await resetForSuite({ delay: '100ms' });

      // Initialize base context first
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
      ctx.mockAgent.configure({ delay: '100ms' });
      await ctx.daemon.restart();
      await waitForExtensionConnected();

      beads.cleanupTestTasks('E2E Conflict');
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

  // NOTE: Both tests below require grimoire workflow functionality
  // (creating worktrees, running scripts, handling merge steps).
  // These are skipped until grimoire workflows are verified to work.

  test.skip('Merge conflict is detected when main branch diverges', async function () {
    // This test requires grimoire workflow to create worktree and make changes
    // Skip until grimoire workflows are working
  });

  test.skip('Approve merge succeeds when no conflicts', async function () {
    // This test requires grimoire workflow to create worktree and make changes
    // Skip until grimoire workflows are working
  });
});
