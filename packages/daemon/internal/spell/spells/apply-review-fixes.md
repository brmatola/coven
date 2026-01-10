# Apply Review Fixes

Apply fixes for these review issues:

```json
{{.issues | default "[]"}}
```

## Instructions

1. Review each issue carefully
2. Make the minimal changes needed to address each issue
3. Test that your fixes work correctly
4. Commit the fixes

## Guidelines

- Make minimal changes to address each issue
- Don't refactor unrelated code
- Don't introduce new features
- Don't change code style unless that was the issue
- If an issue is unclear, skip it and note why

## Output Format

```json
{
  "success": true,
  "summary": "Applied fixes for N issues",
  "outputs": {
    "issues_fixed": [
      {
        "issue": "Brief description of what was fixed",
        "file": "path/to/file.go"
      }
    ],
    "issues_skipped": [
      {
        "issue": "Brief description of skipped issue",
        "reason": "Why it was skipped"
      }
    ],
    "files_changed": ["list", "of", "modified", "files"]
  }
}
```

If unable to apply any fixes:
```json
{
  "success": false,
  "summary": "Unable to apply review fixes",
  "error": "Explanation of what went wrong"
}
```
