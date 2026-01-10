# Implement Bead

Implement the following bead:

## Title
{{.bead.title}}

## Description
{{.bead.body}}

## Instructions

1. Read and understand the requirements in the description
2. Implement the changes needed to fulfill the bead requirements
3. Write tests for any new functionality
4. Ensure all existing tests still pass
5. Commit your changes with a clear commit message

Follow the acceptance criteria exactly. Focus on delivering exactly what is requested, no more, no less.

If you encounter any blockers or need clarification, describe them clearly in your output.

## Output Format

When done, output JSON:
```json
{
  "success": true,
  "summary": "Brief description of what was implemented",
  "outputs": {
    "files_changed": ["list", "of", "modified", "files"]
  }
}
```

If you cannot complete the task:
```json
{
  "success": false,
  "summary": "Why the task could not be completed",
  "error": "Detailed error description"
}
```
