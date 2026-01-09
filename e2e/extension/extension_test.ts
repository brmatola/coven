/**
 * VS Code Extension E2E Tests
 *
 * These tests verify the full workflow of the Coven VS Code extension:
 * - Session lifecycle: start -> active -> stop
 * - Task lifecycle: create -> start (spawns agent in worktree) -> complete -> review -> merge
 * - Agent execution: worktree created, agent spawned, output captured, task completed
 * - Review workflow: changes visible, approve/revert works
 * - Error handling: graceful failures with clear messages
 *
 * IMPORTANT: E2E tests MUST test the actual Coven extension, not external tools.
 * - NEVER call `claude` CLI directly in E2E tests - the extension does this internally
 * - E2E tests should use VS Code commands (e.g., vscode.commands.executeCommand('coven.startTask', taskId))
 * - Using `bd` and `git` commands to SET UP test data is acceptable
 * - Using `bd` and `git` commands to VERIFY results is acceptable
 * - But the actual functionality being tested must go through the Coven extension
 */

import * as vscode from "vscode";

// Placeholder for extension E2E tests
// These will be implemented when the extension integration is complete

describe("Extension E2E Tests", () => {
  it.todo("should start and stop a session");
  it.todo("should create and start a task");
  it.todo("should spawn agent in worktree when task starts");
  it.todo("should capture agent output and detect completion");
  it.todo("should allow reviewing changes after task completion");
  it.todo("should merge worktree changes on approval");
  it.todo("should revert worktree changes on rejection");
  it.todo("should handle agent errors gracefully");
});
