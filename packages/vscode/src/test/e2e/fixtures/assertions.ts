import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * Custom assertion helpers for E2E tests.
 */

/**
 * Assert that a VS Code command is registered.
 */
export async function assertCommandExists(command: string): Promise<void> {
  const commands = await vscode.commands.getCommands(true);
  assert.ok(
    commands.includes(command),
    `Command '${command}' should be registered`
  );
}

/**
 * Assert that multiple VS Code commands are registered.
 */
export async function assertCommandsExist(commandList: string[]): Promise<void> {
  const commands = await vscode.commands.getCommands(true);
  for (const command of commandList) {
    assert.ok(
      commands.includes(command),
      `Command '${command}' should be registered`
    );
  }
}

/**
 * Assert that the Coven extension is present.
 */
export function assertExtensionPresent(): void {
  const extension = vscode.extensions.getExtension('coven.coven');
  assert.ok(extension, 'Coven extension should be present');
}

/**
 * Assert that the Coven extension is active.
 */
export function assertExtensionActive(): void {
  const extension = vscode.extensions.getExtension('coven.coven');
  assert.ok(extension, 'Coven extension should be present');
  assert.ok(extension.isActive, 'Coven extension should be active');
}

/**
 * Assert that a command executes without throwing.
 * Returns the command result if successful.
 */
export async function assertCommandSucceeds(
  command: string,
  ...args: unknown[]
): Promise<unknown> {
  try {
    return await vscode.commands.executeCommand(command, ...args);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    assert.fail(`Command '${command}' should not throw, but threw: ${msg}`);
  }
}

/**
 * Assert that a command fails with an expected error pattern.
 */
export async function assertCommandFails(
  command: string,
  expectedPattern: string | RegExp,
  ...args: unknown[]
): Promise<void> {
  try {
    await vscode.commands.executeCommand(command, ...args);
    assert.fail(`Command '${command}' should have thrown`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (typeof expectedPattern === 'string') {
      assert.ok(
        msg.includes(expectedPattern),
        `Error should contain '${expectedPattern}', got: ${msg}`
      );
    } else {
      assert.ok(
        expectedPattern.test(msg),
        `Error should match pattern, got: ${msg}`
      );
    }
  }
}

/**
 * Assert condition with timeout and polling.
 * Useful for async state changes.
 */
export async function assertEventually(
  condition: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 5000,
  pollIntervalMs = 100
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const result = await condition();
    if (result) {
      return;
    }
    await sleep(pollIntervalMs);
  }

  assert.fail(`Condition not met within ${timeoutMs}ms: ${message}`);
}

/**
 * Assert that array contains expected items.
 */
export function assertContainsAll<T>(
  actual: T[],
  expected: T[],
  message?: string
): void {
  for (const item of expected) {
    assert.ok(
      actual.includes(item),
      message || `Array should contain ${String(item)}`
    );
  }
}

/**
 * Sleep for the specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
