/**
 * Initialization Flow E2E Tests.
 *
 * Verifies workspace detection and initialization flow.
 */
import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import {
  initTestContext,
  getTestContext,
  clearEvents,
} from './setup';

suite('Initialization Flow', function () {
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

  test('Complete workspace has all required components', async function () {
    const ctx = getTestContext();

    assert.ok(
      fs.existsSync(path.join(ctx.workspacePath, '.git')),
      '.git/ should exist'
    );
    assert.ok(
      fs.existsSync(path.join(ctx.workspacePath, '.coven')),
      '.coven/ should exist'
    );
    assert.ok(
      fs.existsSync(path.join(ctx.workspacePath, '.beads')),
      '.beads/ should exist'
    );
  });

  test('Daemon config file exists', async function () {
    const ctx = getTestContext();
    const configPath = path.join(ctx.workspacePath, '.coven', 'config.json');

    assert.ok(
      fs.existsSync(configPath),
      'config.json should exist'
    );

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.ok(config, 'Config should be valid JSON');
  });

  test('Daemon socket exists when running', async function () {
    const ctx = getTestContext();

    const healthy = await ctx.daemon.isHealthy();
    if (!healthy) {
      return this.skip();
    }

    const socketPath = ctx.daemon.getSocketPath();
    assert.ok(
      fs.existsSync(socketPath),
      'Daemon socket should exist when daemon is running'
    );
  });
});
