# Change: Add E2E Test Infrastructure

## Why
As Coven grows, we need reliable E2E tests to catch regressions and validate user-facing behavior. The current test setup creates a fresh workspace per test run, lacks shared utilities, and doesn't cover critical flows like session lifecycle and workspace initialization. A proper E2E infrastructure enables confident feature development.

## What Changes
- Create a reusable test workspace manager with fast reset between tests
- Add shared test fixtures and helpers (session management, task creation, assertions)
- Implement comprehensive E2E test suites for core flows (session lifecycle, workspace init, sidebar)
- Add test utilities that future feature changes can extend

## Impact
- Affected specs: `e2e-testing` (new capability)
- Affected code: `src/test/e2e/`, `scripts/run-e2e-tests.ts`
- Dependencies: None (improves existing infrastructure)
