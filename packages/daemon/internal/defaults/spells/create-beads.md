# Create Beads from Spec Analysis

Create beads for each component identified in the spec analysis.

## Spec Path
{{.spec_path | default "No spec path provided"}}

## Analysis
```json
{{.analysis | default "{}"}}
```

## Instructions

For each component in the analysis, create a bead using the `bd create` command:

1. Use the component name as the bead title
2. Build a comprehensive description including:
   - What the component does
   - Acceptance criteria (as a checklist)
   - Testing requirements
   - Any dependencies or constraints
3. Set the appropriate type (task, feature, bug)
4. Set the priority based on the analysis
5. Add the label `grimoire:implement-bead` so the scheduler knows which grimoire to use
6. After creating all beads, add dependencies between them using `bd dep add`

## Command Format

For each component, run:
```bash
bd create --title="<component-name>" --type=<type> --priority=<priority> --labels="grimoire:implement-bead"
```

Then for the description, use `bd update` with the full description.

For dependencies, run:
```bash
bd dep add <child-bead-id> <parent-bead-id>
```

## Guidelines

- Create beads in the order that respects dependencies (create dependencies first)
- Use clear, concise titles that describe what will be implemented
- Include all acceptance criteria from the analysis in the description
- Include all testing requirements in the description
- Add any relevant context from the original spec

## Output Format

Output JSON with the created beads:

```json
{
  "success": true,
  "summary": "Created N beads from spec",
  "outputs": {
    "beads_created": [
      {
        "id": "coven-xxx",
        "title": "Component title",
        "type": "task|feature|bug",
        "priority": 1
      }
    ],
    "dependencies_added": [
      {
        "child": "coven-xxx",
        "parent": "coven-yyy"
      }
    ],
    "total_beads": 5
  }
}
```

If unable to create beads:
```json
{
  "success": false,
  "summary": "Unable to create beads",
  "error": "Explanation of what went wrong"
}
```
