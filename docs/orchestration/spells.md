# Spells (Prompt Templates)

Spells are prompt templates that render into agent prompts. They use [Go template](https://pkg.go.dev/text/template) syntax for variables, conditionals, and loops.

## Quick Reference

```yaml
# Inline spell
- name: implement
  type: agent
  spell: |
    Task: {{.task.title}}
    {{.task.body}}
    Return: {"success": true, "summary": "Done"}

# File-based spell (loads .coven/spells/implement.md)
- name: implement
  type: agent
  spell: implement
  input:
    custom_var: "value"
```

## Go Template Primer

If you're new to Go templates, here's what you need:

### Variables

```
{{.variableName}}
```

Example:
```
Task: {{.task.title}}
```

### Conditionals

```
{{if .condition}}
  shown if true
{{else}}
  shown if false
{{end}}
```

Example:
```
{{if .previous.failed}}
Fix these errors: {{.previous.output}}
{{else}}
All checks passed.
{{end}}
```

### Loops

```
{{range .items}}
- {{.}}
{{end}}
```

Example:
```
Files to review:
{{range .analyze.outputs.files}}
- {{.}}
{{end}}
```

### Pipelines

```
{{.value | function}}
```

Example:
```
{{.task.title | upper}}
```

### Whitespace Control

Use `{{-` and `-}}` to trim surrounding whitespace:

```
{{- if .feedback -}}
Feedback: {{.feedback}}
{{- end -}}
```

## File-Based Spells

Create spell files in `.coven/spells/`:

```
.coven/
└── spells/
    ├── implement.md
    ├── fix-tests.md
    └── common-rules.md
```

### Example Spell File

`.coven/spells/implement.md`:

```markdown
# Task: {{.task.title}}

## Description
{{.task.body}}

## Requirements
- Follow existing code patterns
- Add appropriate tests
- Include error handling

{{if .previous}}
## Previous Step
Status: {{if .previous.success}}Success{{else}}Failed{{end}}
Output: {{.previous.output}}
{{end}}

## Output Format
When done, return a JSON block:
```json
{"success": true, "summary": "What you implemented", "outputs": {"files": ["..."]}}
```
```

### Reference in Grimoire

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
    # Task: {{.task.title}}

    {{.task.body}}

    Implement this feature. Return:
    {"success": true, "summary": "Done"}
```

### When to Use Inline vs. File

| Use Inline | Use File |
|------------|----------|
| Short prompts (< 20 lines) | Long prompts |
| Single-use, one grimoire | Reused across grimoires |
| Prototyping | Production workflows |
| Simple logic | Complex conditionals |

## Template Variables

### Task Variables

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `{{.task}}` | Full task object | `{id: "...", title: "...", ...}` |
| `{{.task.id}}` | Task ID | `"task-abc123"` |
| `{{.task.title}}` | Task title | `"Add user auth"` |
| `{{.task.body}}` | Task description | `"Implement login..."` |
| `{{.task.type}}` | Task type | `"feature"`, `"bug"`, `"task"` |
| `{{.task.priority}}` | Priority (0-4) | `2` |
| `{{.task.tags}}` | Tags array | `["grimoire:impl", "urgent", "backend"]` |
| `{{.task.parent_id}}` | Parent task ID (if subtask) | `"task-parent123"` or `null` |
| `{{.task.depth}}` | Depth in hierarchy (0 = root) | `0`, `1`, `2` |

### Step Output Variables

Access outputs from any previous step by name:

| Variable | Description |
|----------|-------------|
| `{{.step_name}}` | Full output object |
| `{{.step_name.output}}` | Raw output string (stdout/stderr) |
| `{{.step_name.status}}` | `"success"` or `"failed"` |
| `{{.step_name.exit_code}}` | Exit code (scripts only) |
| `{{.step_name.outputs}}` | Parsed JSON `outputs` object (agents) |
| `{{.step_name.outputs.key}}` | Specific field from outputs |
| `{{.step_name.summary}}` | Agent's summary string |

**Example:** If `analyze` step returns:

```json
{"success": true, "outputs": {"files": ["a.ts", "b.ts"], "count": 2}}
```

You can access:
- `{{.analyze.outputs.files}}` → `["a.ts", "b.ts"]`
- `{{.analyze.outputs.count}}` → `2`
- `{{.analyze.status}}` → `"success"`

### Previous Step Shortcuts

Convenient access to the immediately preceding step:

| Variable | Description |
|----------|-------------|
| `{{.previous.success}}` | Boolean: previous step succeeded |
| `{{.previous.failed}}` | Boolean: previous step failed |
| `{{.previous.output}}` | Raw output from previous step |

### Loop Variables

Available inside loop steps:

| Variable | Description |
|----------|-------------|
| `{{.loop_name.iteration}}` | Current iteration (1-indexed) |
| `{{.loop_entry}}` | State snapshot before loop started |

**The `{{.loop_entry}}` variable** preserves pre-loop context:

```yaml
- name: initial
  type: agent
  spell: analyze

- name: refine-loop
  type: loop
  steps:
    - name: refine
      type: agent
      spell: |
        Original: {{.loop_entry.initial.outputs.analysis}}
        Iteration: {{.refine-loop.iteration}}
```

### Input Variables

Variables passed via `input:` are merged directly into context:

```yaml
- name: fix-tests
  type: agent
  spell: fix-tests
  input:
    task: "{{.task}}"
    test_output: "{{.run-tests.output}}"
    custom: "some value"
```

In the spell, access them directly:

```markdown
## Test Failures
{{.test_output}}

## Custom Value
{{.custom}}
```

**Note:** Input variables are accessed directly (`{{.test_output}}`), not via an `input` prefix.

## Template Functions

### String Functions

| Function | Example | Result |
|----------|---------|--------|
| `upper` | `{{upper .text}}` | `"HELLO"` |
| `lower` | `{{lower .text}}` | `"hello"` |
| `trim` | `{{trim .text}}` | Remove whitespace |
| `quote` | `{{quote .text}}` | `"\"hello\""` |
| `indent` | `{{indent 4 .text}}` | Add 4 spaces to each line |
| `default` | `{{default "N/A" .value}}` | Use "N/A" if empty |
| `join` | `{{join ", " .items}}` | `"a, b, c"` |

### Comparison Functions

| Function | Example | Description |
|----------|---------|-------------|
| `eq` | `{{if eq .a .b}}` | Equal |
| `ne` | `{{if ne .a .b}}` | Not equal |
| `lt` | `{{if lt .count 5}}` | Less than |
| `le` | `{{if le .count 5}}` | Less than or equal |
| `gt` | `{{if gt .count 0}}` | Greater than |
| `ge` | `{{if ge .count 1}}` | Greater than or equal |

### Logical Functions

| Function | Example | Description |
|----------|---------|-------------|
| `and` | `{{if and .a .b}}` | Both true |
| `or` | `{{if or .a .b}}` | Either true |
| `not` | `{{if not .done}}` | Negate |

### Examples

```markdown
Priority: {{default "medium" .task.priority}}

Labels: {{join ", " .task.labels}}

Title: {{upper .task.title}}

{{if gt .refine-loop.iteration 1}}
This is iteration {{.refine-loop.iteration}}.
{{end}}

{{if or .lint.exit_code .test.exit_code}}
At least one check failed.
{{end}}

Code block:
```
{{indent 4 .previous.output}}
```
```

## Conditionals

Use conditionals for optional content:

```markdown
{{if .previous}}
## Previous Result
Status: {{if .previous.success}}Success{{else}}Failed{{end}}
Output: {{.previous.output}}
{{end}}

{{if eq .task.type "bug"}}
## Bug Fix Guidelines
- Identify root cause first
- Add regression test
- Verify fix doesn't break other tests
{{end}}

{{if and .feedback (gt (len .feedback) 0)}}
## Feedback to Address
{{range .feedback}}
- {{.}}
{{end}}
{{end}}
```

## Spell Includes

Include other spells with the `include` function:

```markdown
{{include "common-rules.md"}}

# Task: {{.task.title}}

{{include "output-format.md"}}
```

### With Variables

Pass variables to included spells:

```markdown
{{include "code-review.md" severity="high" files=.analyze.outputs.files}}
```

In `code-review.md`:
```markdown
Severity: {{.severity}}
Files: {{range .files}}- {{.}}{{end}}
```

**Include location:** Resolved from `.coven/spells/`.

## Error Handling

Template errors cause the step to fail immediately.

### Missing Variable

```
failed to render spell template "implement": variable "nonexistent" not found
```

**Cause:** Referenced `{{.nonexistent}}` but it doesn't exist.

**Fix:**
- Check spelling
- Ensure variable is passed via `input`
- Use `{{if .variable}}` to check existence first

### Parse Error

```
failed to parse spell template "implement": unexpected "}" in template
```

**Cause:** Invalid syntax.

**Common issues:**
- `{{.task.title}` — missing closing `}}`
- `{{rang .items}}` — typo in `range`
- `{{if .x}` — missing `{{end}}`

### Missing Spell File

```
spell file not found: .coven/spells/nonexistent.md
```

**Cause:** Referenced spell doesn't exist.

**Fix:** Create the file or check spelling.

### Type Error

```
failed to render spell template: can't call method "outputs" on nil
```

**Cause:** Accessing property on nil value (step hasn't run or returned nil).

**Fix:** Check for existence first:

```
{{if .step_name}}{{.step_name.outputs.key}}{{end}}
```

### Accessing Non-Existent Output Field

```
failed to render spell template: field "nonexistent" not found in outputs
```

**Cause:** Agent returned outputs but not the specific field you're accessing.

**Fix:** Use `default` or check existence:

```
{{default "unknown" .step.outputs.maybe_missing}}
```

## Best Practices

### 1. Always Include Output Format

Agents need to know the expected JSON structure:

```markdown
## Output Format
When done, return a JSON block:
```json
{"success": true, "summary": "What you did", "outputs": {"key": "value"}}
```
```

### 2. Use Conditionals for Optional Context

Don't assume variables exist:

```markdown
{{if .feedback}}
## Feedback
{{range .feedback}}- {{.}}{{end}}
{{else}}
This is the initial pass. No feedback yet.
{{end}}
```

### 3. Keep Spells Focused

One spell per task type. A spell that handles implementation, testing, AND documentation is hard to maintain.

### 4. Use Includes for Common Patterns

Extract shared content:

`.coven/spells/output-format.md`:
```markdown
## Output Format
Return a JSON block at the end of your response:
```json
{"success": true, "summary": "Brief description"}
```
```

Usage:
```markdown
# Task: {{.task.title}}
...
{{include "output-format.md"}}
```

### 5. Provide Rich Context

More context = better results:

```markdown
# Task: {{.task.title}}

## Description
{{.task.body}}

## Existing Code Context
{{if .analyze.outputs.relevant_files}}
Files that may be relevant:
{{range .analyze.outputs.relevant_files}}
- {{.path}}: {{.purpose}}
{{end}}
{{end}}

## Previous Attempts
{{if .previous.failed}}
The previous attempt failed with:
{{.previous.output}}

Please avoid the same mistakes.
{{end}}
```

### 6. Test Incrementally

Start with hardcoded values, then add variables one at a time:

```markdown
# Version 1: Hardcoded
Implement a login form.

# Version 2: Add task title
Implement: {{.task.title}}

# Version 3: Add body
Implement: {{.task.title}}
{{.task.body}}

# Version 4: Add conditionals
{{if .previous.failed}}...{{end}}
```

### 7. Use Descriptive Variable Names in Input

```yaml
# Good
input:
  failing_test_output: "{{.run-tests.output}}"
  files_to_modify: "{{.analyze.outputs.files}}"

# Bad
input:
  x: "{{.run-tests.output}}"
  y: "{{.analyze.outputs.files}}"
```
