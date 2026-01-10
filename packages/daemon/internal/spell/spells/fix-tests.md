# Fix Failing Tests

The tests are failing. Here's the output:

```
{{.test_output}}
```

## Instructions

1. Analyze the test output to identify the failing tests
2. Determine the root cause of each failure
3. Fix the failing tests or the code they're testing
4. Verify the fixes by running the tests again
5. Focus only on making tests pass - don't refactor unrelated code

## Guidelines

- Make minimal changes to fix the failures
- Don't change test assertions unless they're incorrect
- If a test is testing the wrong behavior, fix the implementation, not the test
- If the test itself is broken, explain why and fix it

## Output Format

```json
{
  "success": true,
  "summary": "Fixed N failing tests",
  "outputs": {
    "tests_fixed": ["list", "of", "fixed", "tests"],
    "files_changed": ["list", "of", "modified", "files"]
  }
}
```

If unable to fix:
```json
{
  "success": false,
  "summary": "Unable to fix tests",
  "error": "Explanation of why tests couldn't be fixed"
}
```
