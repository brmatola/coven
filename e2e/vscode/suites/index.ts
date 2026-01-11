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

  // Sort files to ensure proper test order:
  // 1. smoke tests first
  // 2. connection tests
  // 3. data-format tests
  // 4. commands tests
  // 5. api tests
  // 6. session tests
  // 7. tasks tests
  // 8. ui tests
  // 9. initialization tests
  // 10. resilience tests last (may affect daemon state)
  const testOrder = [
    'smoke',
    'connection',
    'data-format',
    'commands',
    'api',
    'session',
    'tasks',
    'ui',
    'initialization',
    'resilience',
  ];

  const sortedFiles = files.sort((a, b) => {
    const aName = path.basename(a, '.test.js');
    const bName = path.basename(b, '.test.js');
    const aIndex = testOrder.findIndex(t => aName.includes(t));
    const bIndex = testOrder.findIndex(t => bName.includes(t));
    // Unknown tests go to the end (but before resilience)
    const aOrder = aIndex >= 0 ? aIndex : testOrder.length - 2;
    const bOrder = bIndex >= 0 ? bIndex : testOrder.length - 2;
    return aOrder - bOrder;
  });

  sortedFiles.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

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
