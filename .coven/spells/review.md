# Code Review

Review the changes made for this bead.

## Bead Context
Title: {{.bead.title | default "No title"}}

## Review Criteria

Check for:

### Correctness
- Does the code do what the bead asks?
- Are edge cases handled appropriately?
- Are there any bugs or logic errors?

### Tests
- Are there adequate tests for new functionality?
- Do tests cover edge cases?
- Are test names descriptive?

### Style
- Does the code match project conventions?
- Is the code readable and well-organized?
- Are variable and function names clear?

### Security
- Are there any security vulnerabilities?
- Is user input validated?
- Are secrets handled properly?

## Output Format

Output JSON with your findings:

```json
{
  "success": true,
  "summary": "Review completed",
  "outputs": {
    "issues": [
      {
        "severity": "high|medium|low",
        "category": "correctness|tests|style|security",
        "file": "path/to/file.go",
        "line": 42,
        "message": "Description of the issue",
        "suggestion": "How to fix it"
      }
    ],
    "approved": true,
    "comment": "Overall review comment"
  }
}
```

Set `approved` to:
- `true` if changes are ready to merge (no high severity issues)
- `false` if changes need fixes before merge
