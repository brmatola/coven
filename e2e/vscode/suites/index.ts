import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: parseInt(process.env.COVEN_E2E_TIMEOUT || '60000', 10),
  });

  const testsRoot = path.resolve(__dirname);
  const files = await glob('**/*.test.js', { cwd: testsRoot });

  // Test execution order (by directory/filename priority):
  // 1. foundation/* - Basic extension activation and connection
  // 2. session/* - Session lifecycle tests
  // 3. task/* - Core task workflow tests (CRITICAL)
  // 4. workflow/* - Multi-step workflow tests
  // 5. errors/* - Error handling tests
  // 6. review/* - Review and merge tests
  const testOrder = [
    // Foundation tests first
    'foundation/activation',
    'foundation/connection',
    // Session tests
    'session/lifecycle',
    // Core task tests
    'task/lifecycle',
    'task/questions',
    // Workflow tests
    'workflow/multi-step',
    'workflow/panel-content',
    // Error handling
    'errors/agent-failure',
    'errors/disconnect',
    'errors/timeout',
    // Review workflow
    'review/merge',
    'review/panel-content',
  ];

  const sortedFiles = files.sort((a, b) => {
    // Extract relative path without .test.js extension
    const aPath = a.replace('.test.js', '').replace(/\\/g, '/');
    const bPath = b.replace('.test.js', '').replace(/\\/g, '/');

    // Find position in test order
    const aIndex = testOrder.findIndex(t => aPath.includes(t));
    const bIndex = testOrder.findIndex(t => bPath.includes(t));

    // Unknown tests go to the end
    const aOrder = aIndex >= 0 ? aIndex : testOrder.length;
    const bOrder = bIndex >= 0 ? bIndex : testOrder.length;

    return aOrder - bOrder;
  });

  sortedFiles.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

  console.log('Running E2E tests in order:');
  sortedFiles.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));

  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`));
      } else {
        resolve();
      }
    });
  });
}
