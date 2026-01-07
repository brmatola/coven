import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../');
  const extensionTestsPath = path.resolve(__dirname, '../dist/test/e2e/index.js');

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: ['--disable-extensions'],
  });
}

main().catch((err) => {
  console.error('Failed to run tests:', err);
  process.exit(1);
});
