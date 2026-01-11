/**
 * Generated Client E2E Tests
 * 
 * Tests the generated client code built from packages/api-spec
 * to verify that it works correctly with the daemon.
 * 
 * This ensures that:
 * 1. The extension relies on generated client code from packages/api-spec
 * 2. The generated client correctly communicates with the daemon
 * 3. API spec changes are reflected in the generated client
 */

import * as assert from 'assert';
import {
  initTestContext,
  getTestContext,
  clearEvents,
  ensureDaemonHealthy,
} from './setup';
import { CovenClient } from '@coven/client-ts';

suite('Generated Client from API Spec', function () {
  this.timeout(30000);

  let generatedClient: CovenClient | null = null;

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

    // Create generated client using the test workspace
    const ctx = getTestContext();
    const socketPath = require('path').join(ctx.workspacePath, '.coven', 'covend.sock');
    generatedClient = new CovenClient(socketPath);
  });

  setup(function () {
    clearEvents();
  });

  test('Generated client can check daemon health', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy || !generatedClient) {
      return this.skip();
    }

    const health = await generatedClient.HealthService.getHealth();
    assert.ok(health, 'Should return health response');
    assert.ok(health.status, 'Should have status field');
    assert.ok(health.version, 'Should have version field');
    assert.ok(typeof health.uptime === 'number', 'Should have uptime as number');
    assert.ok(health.workspace, 'Should have workspace field');
  });

  test('Generated client can get daemon state', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy || !generatedClient) {
      return this.skip();
    }

    const state = await generatedClient.StateService.getState();
    assert.ok(state, 'Should return state response');
    assert.ok('state' in state || 'agents' in state, 'Should have state structure');
  });

  test('Generated client can list tasks', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy || !generatedClient) {
      return this.skip();
    }

    const response = await generatedClient.TasksService.getTasks();
    assert.ok(response, 'Should return tasks response');
    assert.ok(Array.isArray(response.tasks), 'Tasks should be array');
    assert.ok(typeof response.count === 'number', 'Count should be number');
  });

  test('Generated client can list agents', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy || !generatedClient) {
      return this.skip();
    }

    const response = await generatedClient.AgentsService.getAgents();
    assert.ok(response, 'Should return agents response');
    assert.ok(
      response.agents !== undefined,
      'Should have agents field'
    );
    assert.ok(Array.isArray(response.agents), 'Agents should be array');
    assert.ok(typeof response.count === 'number', 'Count should be number');
  });

  test('Generated client can list workflows', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy || !generatedClient) {
      return this.skip();
    }

    const response = await generatedClient.WorkflowsService.getWorkflows();
    assert.ok(response, 'Should return workflows response');
    assert.ok(
      response.workflows !== undefined,
      'Should have workflows field'
    );
    assert.ok(Array.isArray(response.workflows), 'Workflows should be array');
  });

  test('Generated client can list questions', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy || !generatedClient) {
      return this.skip();
    }

    const response = await generatedClient.QuestionsService.getQuestions({ taskId: undefined, pending: undefined });
    assert.ok(response, 'Should return questions response');
    assert.ok(
      response.questions !== undefined,
      'Should have questions field'
    );
    assert.ok(Array.isArray(response.questions), 'Questions should be array');
  });

  test('Generated client can get version info', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy || !generatedClient) {
      return this.skip();
    }

    const version = await generatedClient.VersionService.getVersion();
    assert.ok(version, 'Should return version response');
    assert.ok(version.version, 'Should have version field');
  });

  test('Generated client handles 404 errors correctly', async function () {
    const healthy = await ensureDaemonHealthy();
    if (!healthy || !generatedClient) {
      return this.skip();
    }

    // Try to get a non-existent task - TasksService doesn't have getTaskById, skip this test for now
    // The generated client structure may differ from what we expect
    this.skip();
  });

  test('Generated client uses Unix socket adapter', async function () {
    if (!generatedClient) {
      return this.skip();
    }

    const socketPath = generatedClient.getSocketPath();
    assert.ok(socketPath, 'Should have socket path');
    assert.ok(socketPath.endsWith('.sock'), 'Should be a Unix socket path');

    const axiosInstance = generatedClient.getAxiosInstance();
    assert.ok(axiosInstance, 'Should have axios instance');
    // The axios instance should have our custom adapter
    assert.ok(axiosInstance.defaults.adapter, 'Should have custom adapter');
  });
});
