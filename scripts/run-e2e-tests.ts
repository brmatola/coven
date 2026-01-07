import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  // The extension root (where package.json is)
  const extensionDevelopmentPath = path.resolve(__dirname, '../');

  // The compiled test runner
  const extensionTestsPath = path.resolve(__dirname, '../dist/test/e2e/index.js');

  // Use the extension root as workspace (it has .git for activation)
  const testWorkspace = extensionDevelopmentPath;

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      testWorkspace,
      '--disable-extensions',
    ],
  });
}

main().catch((err) => {
  console.error('Failed to run tests:', err);
  process.exit(1);
});
