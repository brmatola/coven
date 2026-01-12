# Workflow Examples

Complete grimoire examples for common patterns. Each example includes explanations of non-obvious details.

## Simple Implementation

The minimal workflow—one agent, one merge:

```yaml
name: simple-implement
description: Implement and merge
timeout: 30m

steps:
  - name: implement
    type: agent
    spell: |
      # Task: {{.task.title}}

      {{.task.body}}

      Implement this in the worktree. Return:
      {"success": true, "summary": "What you did"}
    timeout: 20m

  - name: merge
    type: merge
    require_review: false  # Auto-merge without review
```

**Why this matters:**
- This is the baseline. Everything else builds on this.
- `require_review: false` means changes merge automatically. Use this for trusted workflows or non-critical changes.
- The inline spell includes the required JSON output format. If the agent doesn't return this, the step fails.

---

## Implement-Test-Fix Pattern

Implements, runs tests, and iterates on failures:

```yaml
name: implement-with-tests
description: Implement feature with test verification
timeout: 2h

steps:
  - name: implement
    type: agent
    spell: implement
    input:
      task: "{{.task}}"
    timeout: 20m

  - name: test-loop
    type: loop
    max_iterations: 3
    on_max_iterations: block  # Stop if tests keep failing after 3 tries
    steps:
      - name: run-tests
        type: script
        command: "npm test"
        on_fail: continue      # Key: don't block, let the loop continue
        timeout: 5m

      - name: fix-tests
        type: agent
        spell: fix-tests
        when: "{{.previous.failed}}"  # Only runs if tests failed
        input:
          task: "{{.task}}"
          test_output: "{{.run-tests.output}}"
        timeout: 15m

      - name: verify
        type: script
        command: "npm test"
        on_success: exit_loop  # Key: exit loop when tests pass
        timeout: 5m

  - name: merge
    type: merge
    require_review: false
```

**Key patterns explained:**

1. **`on_fail: continue` on `run-tests`**: Without this, the workflow would block on test failure. We want to let the agent fix it instead.

2. **`when: "{{.previous.failed}}"`**: The `previous` variable refers to the immediately preceding step in the workflow (here, `run-tests`). This ensures `fix-tests` only runs when needed.

3. **Separate `run-tests` and `verify`**: Why test twice? The first `run-tests` detects failures. After `fix-tests` runs, `verify` confirms the fix worked. `verify` has `on_success: exit_loop` to exit when tests pass.

4. **`on_max_iterations: block`**: If tests fail 3 times, something is fundamentally wrong. Block for human intervention rather than auto-merging broken code.

**Supporting spell `.coven/spells/fix-tests.md`:**

```markdown
# Fix Test Failures

## Task
{{.task.title}}

## Test Output
```
{{.test_output}}
```

Analyze the test failures and fix them. Return:
{"success": true, "summary": "Fixed N test(s)"}
```

---

## Multi-Stage Review

Implementation with human checkpoints at each stage:

```yaml
name: reviewed-implementation
description: Implementation with staged reviews
timeout: 3h

steps:
  - name: implement
    type: agent
    spell: implement
    timeout: 30m

  - name: implementation-review
    type: merge
    require_review: true  # PAUSE: Human reviews implementation

  # After approval, workflow continues here
  - name: add-tests
    type: agent
    spell: add-tests
    timeout: 20m

  - name: run-tests
    type: script
    command: "npm test"
    timeout: 10m

  - name: final-review
    type: merge
    require_review: true  # PAUSE: Human reviews tests
```

**Why multiple merge steps?**

Each `merge` with `require_review: true` is a checkpoint. The workflow pauses until you approve. This lets you:
- Review the implementation before tests are written
- Catch design issues early
- Review tests separately from implementation

**What happens between merges?**

After you approve `implementation-review`, those changes merge to your target branch. The workflow continues in the same worktree, now building on the merged changes.

---

## Bug Fix Workflow

Specialized workflow for bugs with reproduction test:

```yaml
name: bugfix-workflow
description: Fix bug with reproduction test
timeout: 1h

steps:
  - name: reproduce
    type: agent
    spell: |
      # Bug: {{.task.title}}

      {{.task.body}}

      1. Write a failing test that reproduces this bug
      2. Verify the test fails (it should, since the bug exists)

      Return:
      {"success": true, "summary": "Added reproduction test", "outputs": {"test_file": "path/to/test"}}
    timeout: 15m

  - name: verify-reproduction
    type: script
    command: "npm test -- --grep 'reproduction'"
    on_fail: continue  # Expected to fail! The bug exists.
    timeout: 5m

  - name: fix-bug
    type: agent
    spell: |
      # Fix Bug: {{.task.title}}

      The reproduction test is at: {{.reproduce.outputs.test_file}}

      Fix the bug so the test passes. Return:
      {"success": true, "summary": "Fixed the bug"}
    when: "{{.verify-reproduction.exit_code}}"  # See explanation below
    timeout: 20m

  - name: verify-fix
    type: script
    command: "npm test"
    timeout: 5m

  - name: merge
    type: merge
    require_review: true
```

**Non-obvious patterns:**

1. **`on_fail: continue` on `verify-reproduction`**: We *expect* this to fail. The bug exists, so the reproduction test should fail. Without `on_fail: continue`, the workflow would block.

2. **`when: "{{.verify-reproduction.exit_code}}"`**: This is truthy when non-zero (i.e., when the test failed). In Go templates, non-zero integers are truthy. This ensures `fix-bug` only runs if the reproduction test actually failed.

   - If `exit_code` is `0` (test passed): The bug doesn't reproduce. Skip fixing.
   - If `exit_code` is `1` (test failed): Bug reproduces. Run `fix-bug`.

3. **Passing `test_file` via outputs**: The `reproduce` agent returns the path to the test file it created. The `fix-bug` agent receives this via `{{.reproduce.outputs.test_file}}`, so it knows which test to make pass.

---

## Lint-Fix Loop

Auto-fix linting errors:

```yaml
name: lint-fix
description: Run linter and auto-fix
timeout: 30m

steps:
  - name: lint-loop
    type: loop
    max_iterations: 5
    on_max_iterations: continue  # Give up gracefully, proceed to merge
    steps:
      - name: run-lint
        type: script
        command: "npm run lint"
        on_fail: continue
        on_success: exit_loop  # Lint passes → done
        timeout: 2m

      - name: auto-fix
        type: script
        command: "npm run lint:fix"
        when: "{{.previous.failed}}"
        timeout: 2m

  - name: merge
    type: merge
    require_review: false
```

**Why `on_max_iterations: continue` here?**

Lint fixes are not critical. If auto-fix can't resolve all issues after 5 tries, continue to the merge step anyway and let a human deal with remaining issues during review. Compare to `implement-with-tests` which uses `block` because broken tests are critical.

---

## Parallel-Style Checks with Conditional Fix

Run multiple checks, then fix any failures:

```yaml
name: comprehensive-check
description: Run all checks before merge
timeout: 30m

steps:
  # Run all checks, even if some fail
  - name: lint
    type: script
    command: "npm run lint"
    on_fail: continue
    timeout: 5m

  - name: typecheck
    type: script
    command: "npm run typecheck"
    on_fail: continue
    timeout: 5m

  - name: test
    type: script
    command: "npm test"
    on_fail: continue
    timeout: 10m

  # If ANY check failed, run the fixer
  - name: fix-issues
    type: agent
    spell: |
      # Fix Issues

      {{if .lint}}Lint: {{.lint.status}} (exit {{.lint.exit_code}}){{end}}
      {{if .typecheck}}Typecheck: {{.typecheck.status}} (exit {{.typecheck.exit_code}}){{end}}
      {{if .test}}Test: {{.test.status}} (exit {{.test.exit_code}}){{end}}

      Fix any failures. Return:
      {"success": true, "summary": "Fixed issues"}
    when: "{{or .lint.exit_code .typecheck.exit_code .test.exit_code}}"
    timeout: 15m

  - name: merge
    type: merge
    require_review: false
```

**Understanding the `when` condition:**

```yaml
when: "{{or .lint.exit_code .typecheck.exit_code .test.exit_code}}"
```

The `or` function returns the first truthy value, or false if all are falsy. Since `exit_code` is `0` (falsy) on success and non-zero (truthy) on failure:
- If all checks pass: `or 0 0 0` → `false` → step skipped
- If any check fails: `or 1 0 0` → `1` (truthy) → step runs

**Why check with `{{if .lint}}`?**

The `{{if .lint}}` guard prevents errors if a step hasn't run yet. In this grimoire all steps run, but it's a good defensive pattern.

---

## Documentation Generator

Generate docs from code:

```yaml
name: generate-docs
description: Generate and update documentation
timeout: 30m

steps:
  - name: analyze
    type: agent
    spell: |
      Analyze the codebase and identify what needs documentation.
      Look for:
      - Public APIs without docs
      - Complex functions lacking explanations
      - Outdated documentation

      Return:
      {"success": true, "summary": "Analysis complete", "outputs": {"files_to_document": ["file1.ts", "file2.ts"]}}
    timeout: 10m

  - name: generate-docs
    type: agent
    spell: |
      # Generate Documentation

      Files to document:
      {{range .analyze.outputs.files_to_document}}
      - {{.}}
      {{end}}

      Generate markdown documentation for these files.
      Return: {"success": true, "summary": "Generated docs for N files"}
    timeout: 15m

  - name: merge
    type: merge
    require_review: true  # Always review generated docs
```

**The `{{range}}` loop:**

```yaml
{{range .analyze.outputs.files_to_document}}
- {{.}}
{{end}}
```

This iterates over the array from the previous step. Inside `{{range}}`, the `.` refers to the current item.

---

## Build and Deploy

Multi-stage build with deployment:

```yaml
name: build-deploy
description: Build, test, and deploy
timeout: 1h

steps:
  - name: install
    type: script
    command: "npm ci"
    timeout: 5m

  - name: build
    type: script
    command: "npm run build"
    timeout: 10m

  - name: test
    type: script
    command: "npm test"
    timeout: 10m

  - name: type-check
    type: script
    command: "npm run typecheck"
    timeout: 5m

  - name: deploy-review
    type: merge
    require_review: true  # PAUSE: Approve before deploy

  # Only runs after human approval
  - name: deploy
    type: script
    command: "npm run deploy"
    timeout: 15m
```

**The deployment checkpoint:**

The `deploy-review` merge step acts as a gate. The workflow pauses until you approve. Only then does deployment run. This prevents accidental deploys—you must consciously approve.

---

## Tips for Writing Grimoires

1. **Start simple** — Begin with minimal steps, add complexity as needed.

2. **Use loops for retry** — Wrap flaky operations in loops with `on_fail: continue`.

3. **Set appropriate timeouts** — Agent steps often need 15-20m, scripts usually 5m or less.

4. **Review before merge** — Use `require_review: true` until you trust the workflow.

5. **Pass context forward** — Use `input` to give agents information from previous steps.

6. **Handle failures gracefully** — Use `when` conditions to skip steps when appropriate.

7. **Name steps clearly** — You'll reference them in templates: `{{.analyze.outputs.files}}` beats `{{.step1.outputs.files}}`.

8. **Test incrementally** — Start with one step, verify it works, then add the next.
