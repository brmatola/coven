# Workflow Examples

Complete grimoire examples for common patterns.

## Simple Implementation

A minimal workflow that implements and merges:

```yaml
name: simple-implement
description: Implement and merge
timeout: 30m

steps:
  - name: implement
    type: agent
    spell: |
      # Task: {{.bead.title}}

      {{.bead.body}}

      Implement this in the worktree. Return:
      {"success": true, "summary": "What you did"}
    timeout: 20m

  - name: merge
    type: merge
    require_review: false
```

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
      bead: "{{.bead}}"
    timeout: 20m

  - name: test-loop
    type: loop
    max_iterations: 3
    on_max_iterations: block
    steps:
      - name: run-tests
        type: script
        command: "npm test"
        on_fail: continue
        timeout: 5m

      - name: fix-tests
        type: agent
        spell: fix-tests
        when: "{{.previous.failed}}"
        input:
          bead: "{{.bead}}"
          test_output: "{{.run-tests.output}}"
        timeout: 15m

      - name: verify
        type: script
        command: "npm test"
        on_success: exit_loop
        timeout: 5m

  - name: merge
    type: merge
    require_review: false
```

Supporting spell `.coven/spells/fix-tests.md`:

```markdown
# Fix Test Failures

## Task
{{.bead.title}}

## Test Output
```
{{.test_output}}
```

Fix the failing tests. Return:
{"success": true, "summary": "Fixed N test(s)"}
```

## Multi-Stage Review

Implementation with human checkpoints:

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
    require_review: true

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
    require_review: true
```

## Bug Fix Workflow

Specialized workflow for bugs with reproduction:

```yaml
name: bugfix-workflow
description: Fix bug with reproduction test
timeout: 1h

steps:
  - name: reproduce
    type: agent
    spell: |
      # Bug: {{.bead.title}}

      {{.bead.body}}

      1. Write a failing test that reproduces this bug
      2. Verify the test fails

      Return: {"success": true, "summary": "Added reproduction test", "outputs": {"test_file": "path/to/test"}}
    timeout: 15m

  - name: verify-reproduction
    type: script
    command: "npm test -- --grep 'reproduction'"
    on_fail: continue  # Expected to fail
    timeout: 5m

  - name: fix-bug
    type: agent
    spell: |
      # Fix Bug: {{.bead.title}}

      The reproduction test is at: {{.reproduce.outputs.test_file}}

      Fix the bug so the test passes. Return:
      {"success": true, "summary": "Fixed the bug"}
    when: "{{.verify-reproduction.exit_code}}"
    timeout: 20m

  - name: verify-fix
    type: script
    command: "npm test"
    timeout: 5m

  - name: merge
    type: merge
    require_review: true
```

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
    on_max_iterations: exit
    steps:
      - name: run-lint
        type: script
        command: "npm run lint"
        on_fail: continue
        on_success: exit_loop
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
    require_review: true

  - name: deploy
    type: script
    command: "npm run deploy"
    timeout: 15m
```

## Parallel-Style with Conditional Steps

Run multiple checks, continue on any failure:

```yaml
name: comprehensive-check
description: Run all checks before merge
timeout: 30m

steps:
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

  - name: fix-issues
    type: agent
    spell: |
      # Fix Issues

      Lint result: {{if .lint}}{{.lint.status}}{{end}}
      Typecheck result: {{if .typecheck}}{{.typecheck.status}}{{end}}
      Test result: {{if .test}}{{.test.status}}{{end}}

      Fix any failures. Return:
      {"success": true, "summary": "Fixed issues"}
    when: "{{or .lint.exit_code .typecheck.exit_code .test.exit_code}}"
    timeout: 15m

  - name: merge
    type: merge
    require_review: false
```

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

      Return:
      {"success": true, "summary": "Analysis complete", "outputs": {"files_to_document": ["file1.ts", "file2.ts"]}}
    timeout: 10m

  - name: generate-docs
    type: agent
    spell: |
      # Generate Documentation

      Files to document: {{.analyze.outputs.files_to_document}}

      Generate markdown documentation for these files.
      Return: {"success": true, "summary": "Generated docs for N files"}
    timeout: 15m

  - name: merge
    type: merge
    require_review: true
```

## Tips for Writing Grimoires

1. **Start simple** - Begin with minimal steps, add complexity as needed
2. **Use loops for retry** - Wrap flaky operations in loops with `on_fail: continue`
3. **Set appropriate timeouts** - Agent steps often need 15-20m, scripts usually 5m or less
4. **Review before merge** - Use `require_review: true` until you trust the workflow
5. **Pass context forward** - Use `input` to give agents information from previous steps
6. **Handle failures gracefully** - Use `when` conditions to skip steps when appropriate
