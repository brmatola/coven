# Coven Project Instructions

## Testing & Coverage Policy

**Testing Requirements - STRICTLY ENFORCED:**
- ALWAYS run BOTH unit tests AND E2E tests before considering work complete
- Unit tests: `npm test`
- E2E tests: `npm run test:e2e`
- ALL tests must pass - do not commit if any tests fail
- If E2E tests fail, investigate and fix the root cause

**E2E Test Design - CRITICAL:**
- E2E tests MUST test the actual Coven extension, not external tools
- NEVER call `claude` CLI directly in E2E tests - the extension does this internally
- E2E tests should use VS Code commands (e.g., `vscode.commands.executeCommand('coven.startTask', taskId)`)
- Test the full workflow: create task → start session → start task → verify agent runs → verify changes
- Using `bd` and `git` commands to SET UP test data is acceptable
- Using `bd` and `git` commands to VERIFY results is acceptable
- But the actual functionality being tested must go through the Coven extension

**What E2E Tests Should Verify:**
1. Session lifecycle: start → active → stop
2. Task lifecycle: create → start (spawns agent in worktree) → complete → review → merge
3. Agent execution: worktree created, agent spawned, output captured, task completed
4. Review workflow: changes visible, approve/revert works
5. Error handling: graceful failures with clear messages

**Coverage Exclusion Policy - STRICTLY ENFORCED:**
- NEVER exclude actual code files from coverage in `vitest.config.ts`
- Only these exclusions are permitted:
  - `src/**/*.test.ts` and `src/**/*.test.tsx` (test files themselves)
  - `src/test/**` (test infrastructure and E2E tests)
  - `src/__mocks__/**` (mock implementations)
- Entry points, re-export modules, type-only files, and "hard to test" code must NOT be excluded
- If code seems untestable, refactor it to be testable or write the necessary tests
- Comments like "covered by E2E tests" or "no logic to test" are not valid exclusion reasons
- The 80% coverage threshold applies to ALL source code without exception

<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->