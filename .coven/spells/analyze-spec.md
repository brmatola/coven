# Analyze OpenSpec Proposal

Analyze the following OpenSpec proposal and break it down into implementable components.

## Spec Path
{{.spec_path | default "No spec path provided"}}

## Instructions

1. Read and analyze the OpenSpec proposal at the given path
2. Identify all distinct components that need to be implemented
3. For each component, determine:
   - What functionality it provides
   - What dependencies it has on other components
   - What testing requirements it has
   - Estimated complexity (simple, medium, complex)
4. Identify the optimal implementation order based on dependencies

## Analysis Guidelines

When analyzing the spec:
- Break down large features into smaller, independently testable pieces
- Identify shared infrastructure that multiple components depend on
- Look for acceptance criteria that define what "done" means
- Note any technical constraints or requirements mentioned
- Consider error handling and edge cases

## Output Format

Output JSON with your analysis:

```json
{
  "success": true,
  "summary": "Brief summary of the spec",
  "outputs": {
    "title": "Spec title",
    "description": "Brief description of what the spec implements",
    "components": [
      {
        "name": "component-name",
        "description": "What this component does",
        "type": "task|feature|bug",
        "priority": 1,
        "depends_on": ["other-component-name"],
        "acceptance_criteria": [
          "Criterion 1",
          "Criterion 2"
        ],
        "testing_requirements": [
          "Unit tests for X",
          "Integration test for Y"
        ],
        "complexity": "simple|medium|complex"
      }
    ],
    "implementation_order": ["component-1", "component-2"],
    "shared_infrastructure": [
      "Infrastructure item that multiple components need"
    ]
  }
}
```

If unable to analyze:
```json
{
  "success": false,
  "summary": "Unable to analyze spec",
  "error": "Explanation of what went wrong"
}
```
