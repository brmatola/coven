# Analyze Review Findings

Given these review findings:

```json
{{.findings | default "{}"}}
```

## Task

Determine if there are actionable issues that need fixing before the changes can be merged.

## Guidelines

An issue is actionable if:
- It points to a real problem in the code
- It has a clear fix that can be implemented
- Fixing it would improve the code quality

An issue is NOT actionable if:
- It's a stylistic preference without clear benefit
- It would require significant refactoring beyond the bead scope
- It's about code that wasn't changed in this bead
- It's unclear what the fix should be

## Output Format

```json
{
  "success": true,
  "summary": "Analysis of review findings",
  "outputs": {
    "needs_fixes": true,
    "reason": "Explanation of why fixes are or aren't needed",
    "actionable_issues": [
      {
        "issue": "Brief description",
        "priority": "high|medium|low"
      }
    ]
  }
}
```

Set `needs_fixes` to `true` only if there are high or medium priority actionable issues.
