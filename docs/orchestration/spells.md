# Spells (Prompt Templates)

Spells are Go templates that render into agent prompts.

## File-based Spells

Create spell files in `.coven/spells/`:

```
.coven/
└── spells/
    ├── implement.md
    ├── fix-tests.md
    └── common-rules.md
```

Example `.coven/spells/implement.md`:

```markdown
# Task: {{.bead.title}}

## Description
{{.bead.body}}

## Requirements
- Implement the feature in the worktree
- Follow existing code patterns
- Add appropriate tests

{{if .previous}}
## Previous Step Result
{{.previous.output}}
{{end}}

## Output Format
Return a JSON block:
{"success": true, "summary": "...", "outputs": {...}}
```

Reference by name in grimoire:

```yaml
- name: implement
  type: agent
  spell: implement  # Loads .coven/spells/implement.md
```

## Inline Spells

Define spells directly in the grimoire:

```yaml
- name: implement
  type: agent
  spell: |
    Implement feature: {{.bead.title}}

    Description: {{.bead.body}}

    Return: {"success": true, "summary": "Done"}
```

## Template Variables

### Bead Variables

| Variable | Description |
|----------|-------------|
| `{{.bead}}` | Full bead object |
| `{{.bead.id}}` | Bead ID |
| `{{.bead.title}}` | Bead title |
| `{{.bead.body}}` | Bead description |
| `{{.bead.type}}` | Bead type (feature, bug, task) |
| `{{.bead.priority}}` | Bead priority |
| `{{.bead.labels}}` | Bead labels array |

### Step Output Variables

| Variable | Description |
|----------|-------------|
| `{{.step_name}}` | Full output from named step |
| `{{.step_name.output}}` | Raw output string |
| `{{.step_name.status}}` | "success" or "failed" |
| `{{.step_name.exit_code}}` | Exit code (scripts only) |
| `{{.step_name.outputs}}` | Parsed JSON outputs object |
| `{{.step_name.outputs.key}}` | Specific field from outputs |

### Previous Step Variables

| Variable | Description |
|----------|-------------|
| `{{.previous.success}}` | Boolean: previous step succeeded |
| `{{.previous.failed}}` | Boolean: previous step failed |
| `{{.previous.output}}` | Raw output from previous step |

### Loop Variables

| Variable | Description |
|----------|-------------|
| `{{.loop_entry}}` | State snapshot before loop started |
| `{{.loop_name.iteration}}` | Current iteration number |

### Input Variables

Variables passed via `input` in the grimoire:

```yaml
- name: fix-tests
  type: agent
  spell: fix-tests
  input:
    bead: "{{.bead}}"
    test_output: "{{.run-tests.output}}"
    custom_value: "some string"
```

Accessed in spell:
```markdown
## Test Failures
{{.test_output}}

## Custom
{{.custom_value}}
```

## Template Functions

| Function | Example | Description |
|----------|---------|-------------|
| `default` | `{{default "N/A" .value}}` | Default if value is empty |
| `join` | `{{join ", " .items}}` | Join array elements |
| `upper` | `{{upper .text}}` | Convert to uppercase |
| `lower` | `{{lower .text}}` | Convert to lowercase |
| `trim` | `{{trim .text}}` | Remove leading/trailing whitespace |
| `indent` | `{{indent 4 .text}}` | Add spaces to each line |
| `quote` | `{{quote .text}}` | Wrap in double quotes |

### Examples

```markdown
Priority: {{default "medium" .bead.priority}}

Labels: {{join ", " .bead.labels}}

Title: {{upper .bead.title}}

Code block:
{{indent 4 .previous.output}}
```

## Conditionals

Use Go template conditionals:

```markdown
{{if .previous}}
## Previous Result
Status: {{if .previous.success}}Success{{else}}Failed{{end}}
Output: {{.previous.output}}
{{end}}

{{if eq .bead.type "bug"}}
## Bug Fix Guidelines
- Identify root cause
- Add regression test
{{end}}
```

## Spell Partials (Includes)

Include other spells with the `include` function:

```markdown
{{include "common-rules.md"}}

# Task: {{.bead.title}}

{{include "output-format.md"}}
```

Pass variables to included spells:

```markdown
{{include "common-rules.md" context=.bead priority="high"}}
```

## Error Handling

Template errors cause the step to fail:

- **Missing variable**: Error if variable doesn't exist (strict mode)
- **Parse error**: Invalid template syntax
- **Missing spell file**: Spell not found in `.coven/spells/`

Example error:
```
failed to render spell template "implement": variable "nonexistent" not found
```

## Best Practices

1. **Always include output format** - Agents need to know the expected JSON structure
2. **Use conditionals for optional context** - Check if variables exist before using
3. **Keep spells focused** - One spell per task type
4. **Use partials for common patterns** - Extract shared instructions
5. **Provide clear context** - Include bead details, previous outputs, and requirements
