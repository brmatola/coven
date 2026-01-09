# Coven Project Instructions

## Testing & Coverage Policy

**Testing Requirements - STRICTLY ENFORCED:**
- ALWAYS run BOTH unit tests AND E2E tests before considering work complete
- Unit tests: `npm test`
- E2E tests: `npm run test:e2e`
- ALL tests must pass - do not commit if any tests fail
- If E2E tests fail, investigate and fix the root cause

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