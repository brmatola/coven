# Quick Start

Get Coven running and complete your first AI-assisted task in 10 minutes.

## Prerequisites

Before you begin, verify these are installed:

### 1. Git

```bash
git --version
# Expected: git version 2.x.x
```

If missing: [Install Git](https://git-scm.com/downloads)

### 2. Node.js 18+

```bash
node --version
# Expected: v18.x.x or higher
```

If missing: [Install Node.js](https://nodejs.org/)

### 3. Go 1.21+

```bash
go version
# Expected: go version go1.21.x or higher
```

If missing: [Install Go](https://go.dev/dl/)

### 4. Claude CLI with API Access

```bash
claude --version
# Expected: claude version X.X.X
```

If missing: [Install Claude CLI](https://github.com/anthropics/claude-code)

**Important:** The Claude CLI requires an Anthropic API key. Follow the Claude CLI setup instructions to configure authentication before proceeding. Coven will not work without a valid API key.

### 5. VS Code

Download from [code.visualstudio.com](https://code.visualstudio.com/)

## Install Coven

### For Development (Local Build)

```bash
# Clone the repository
git clone https://github.com/anthropics/coven.git
cd coven

# Install dependencies
npm install

# Build the daemon and extension
make build

# Install the extension locally
npm run dogfood
```

### Verify Installation

1. Reload VS Code (Command Palette → `Developer: Reload Window`)
2. Look for the **Coven icon** in the Activity Bar (left sidebar)
3. If you don't see it, check the VS Code Output panel for extension errors

## Your First Session

A **session** is your active work context. It starts the daemon and sets a target branch for merges.

### Step 1: Open a Git Repository

Open any git repository in VS Code. It must have at least one commit.

**Don't have one? Create a test project:**

```bash
mkdir coven-test && cd coven-test
git init
echo "# Coven Test Project" > README.md
echo 'console.log("hello")' > index.js
git add . && git commit -m "Initial commit"
code .
```

### Step 2: Start a Session

1. Look at the **status bar** (bottom of VS Code)
2. Click where it says **"Coven: Inactive"**
3. A dialog appears asking for a **target branch**
4. Select `main` (or your primary branch)

**What happens:**
- The daemon (`covend`) starts in the background
- Coven creates `.coven/` directory with task database and workflow state
- Status bar changes to: `covend: 0 active, 0 pending`
- The Coven sidebar becomes interactive

**If it fails:**
- Check that `claude --version` works in your terminal
- Check VS Code Output panel → select "Coven" for error logs
- See [Troubleshooting](troubleshooting.md) for common issues

### Step 3: Create a Task

1. Click the **Coven icon** in the Activity Bar to open the sidebar
2. Click the **+** button in the sidebar header
3. Enter a task title:
   ```
   Add a greet function to index.js that takes a name and returns "Hello, {name}!"
   ```
4. Press Enter

The task appears in the **Ready** section.

### Step 4: Start the Task

1. Hover over your task in the Ready section
2. Click the **▶ (play)** button
3. The task moves to the **Active** section

**What's happening now:**
- Coven creates an isolated git worktree at `.coven/worktrees/{task-id}/`
- Claude receives your task as a prompt
- The agent works in the worktree, not your main directory

### Step 5: Watch Progress

Click your active task to see real-time agent output.

You'll see Claude:
1. Read your existing files
2. Edit `index.js` to add the function
3. Return a JSON result indicating success

**Typical output:**
```
Reading index.js...
Adding greet function...

{"success": true, "summary": "Added greet(name) function that returns 'Hello, {name}!'"}
```

### Step 6: Handle Questions (If Any)

Sometimes Claude needs clarification:

1. A notification appears: "Agent needs input"
2. Your task moves to the **Questions** section
3. Click the task to see the question
4. Select an option or type a response
5. Claude continues working

### Step 7: Review Changes

When the agent finishes:

1. Task moves to **Completed** section
2. Click **Review** to open the Review Panel

**The Review Panel shows:**
- **Files changed** with +/- line counts
- **Agent summary** of what was done
- **Diff viewer** for each file

Click any file to see the exact changes.

### Step 8: Approve or Reject

**To approve:**
1. Verify the changes look correct
2. Click **Approve**
3. Changes merge to your target branch (`main`)
4. Worktree is cleaned up

**To reject:**
1. Click **Reject**
2. Changes are discarded
3. Worktree is deleted
4. Task returns to Ready (you can start it again with a clearer description)

**Verify the merge:**
```bash
git log -1  # Should show the agent's commit
cat index.js  # Should include the greet function
```

Congratulations! You've completed your first Coven workflow.

---

## Adding a Custom Grimoire

The default workflow is simple: one agent step, one merge. For more control (like running tests), create a grimoire.

### Understand the Problem

The default grimoire trusts Claude to get it right the first time. But what if:
- Claude's code doesn't pass tests?
- You want lint checks before merge?
- You need multiple review stages?

Grimoires let you encode these requirements.

### Create the Directory Structure

```bash
mkdir -p .coven/grimoires
```

### Write Your First Grimoire

Create `.coven/grimoires/implement-with-tests.yaml`:

```yaml
name: implement-with-tests
description: Implement a feature and verify with tests

steps:
  # Step 1: Agent implements the feature
  - name: implement
    type: agent
    spell: |
      # Task: {{.task.title}}

      {{.task.body}}

      Implement this feature in the codebase.

      When done, return a JSON block:
      ```json
      {"success": true, "summary": "Brief description of what you implemented"}
      ```
    timeout: 20m

  # Step 2: Run tests in a loop, fix if needed
  - name: test-loop
    type: loop
    max_iterations: 3
    steps:
      - name: run-tests
        type: script
        command: "npm test"
        on_fail: continue      # Don't block—let the agent try to fix
        on_success: exit_loop  # Tests pass—exit the loop
        timeout: 5m

      - name: fix-tests
        type: agent
        spell: |
          The tests failed. Here's the output:

          ```
          {{.run-tests.output}}
          ```

          Analyze the failures and fix the code. Return:
          ```json
          {"success": true, "summary": "What you fixed"}
          ```
        when: "{{.previous.failed}}"  # Only run if tests failed
        timeout: 15m

  # Step 3: Human review before merge
  - name: merge
    type: merge
    require_review: true
```

### Use the Grimoire

**Via VS Code:**
1. Create a new task via the **+** button
2. Enter title: "Add a multiply function to index.js with tests"
3. Click the task to open its details
4. Click **Add Tag**
5. Type: `grimoire:implement-with-tests`
6. Start the task

**Via CLI:**
```bash
coven task create --title="Add a multiply function" --tags="grimoire:implement-with-tests"
coven task claim <task-id>
```

Now Coven:
1. Runs the agent to implement
2. Runs `npm test`
3. If tests fail, agent fixes and tests again (up to 3 times)
4. Pauses for your review
5. Merges on approval

### Understanding the Template Syntax

The `{{...}}` syntax is [Go templates](https://pkg.go.dev/text/template):

```yaml
# Task fields
{{.task.title}}          # The task title
{{.task.body}}           # The task description

# Previous step output
{{.run-tests.output}}    # stdout/stderr from a step named "run-tests"
{{.run-tests.status}}    # "success" or "failed"
{{.run-tests.exit_code}} # Exit code (0 = success)

# Structured agent output
{{.implement.outputs.files}}  # If agent returned {"outputs": {"files": [...]}}

# Convenient shortcuts
{{.previous.success}}    # Did the immediately preceding step succeed?
{{.previous.failed}}     # Did it fail?
{{.previous.output}}     # Its output
```

### Understanding Agent Output

**Critical:** Agents must return JSON at the end of their output.

```json
{"success": true, "summary": "What was done", "outputs": {"key": "value"}}
```

| Field | Required | Description |
|-------|----------|-------------|
| `success` | **Yes** | `true` if successful, `false` if failed |
| `summary` | No | Human-readable description |
| `outputs` | No | Structured data for subsequent steps |
| `error` | No | Error message when `success: false` |

If the agent doesn't return valid JSON, the step fails.

---

## Using Spell Files

For long prompts, create spell files instead of inline YAML.

### Create a Spell

Create `.coven/spells/implement.md`:

```markdown
# Task: {{.task.title}}

## Description
{{.task.body}}

## Requirements
- Follow existing code patterns in the codebase
- Add appropriate error handling
- Include JSDoc comments for public functions

## Your Task
Implement this feature completely.

## Output Format
When done, return a JSON block:
```json
{"success": true, "summary": "What you implemented", "outputs": {"files_changed": ["file1.js"]}}
```
```

### Reference It in Your Grimoire

```yaml
- name: implement
  type: agent
  spell: implement  # Loads .coven/spells/implement.md
  timeout: 20m
```

---

## Grimoire Matchers (Optional)

Instead of adding tags manually, configure automatic grimoire routing based on task properties.

Create `.coven/grimoire-matchers.yaml`:

```yaml
matchers:
  # High-priority bugs get urgent workflow
  - grimoire: urgent-bugfix
    any_tags: ["bug"]
    priority: [0, 1]

  # Features with test tag get test-driven workflow
  - grimoire: implement-with-tests
    any_tags: ["feature"]

  # Security-related tasks get audit workflow
  - grimoire: security-audit
    any_tags: ["security", "auth*"]  # Glob patterns supported

# Fallback for unmatched tasks
default: implement
```

**Matcher semantics:**
- `any_tags`: Match if task has ANY of these tags
- `all_tags`: Match only if task has ALL of these tags
- `not_tags`: Skip this matcher if task has ANY of these tags
- `priority`: Match specific priority levels `[0, 1]` or ranges `priority_range: [1, 3]`

First matching rule wins. Use `coven task show <id> --grimoire-match` to debug routing.

---

## Directory Structure Summary

After using Coven, your project has:

```
your-project/
├── .coven/
│   ├── grimoires/              # YOUR workflow definitions
│   │   └── implement-with-tests.yaml
│   ├── spells/                 # YOUR prompt templates
│   │   └── implement.md
│   ├── grimoire-matchers.yaml  # YOUR routing config (optional)
│   ├── covend.sock             # AUTO: Daemon socket
│   ├── tasks.db                # AUTO: Task database
│   ├── logs/workflows/         # AUTO: Execution logs
│   ├── state/workflows/        # AUTO: Resume state
│   └── worktrees/              # AUTO: Git worktrees
```

**You create:** `grimoires/`, `spells/`, `grimoire-matchers.yaml`
**Coven creates:** Everything else (on session start)

---

## Common Issues

### "Coven: Inactive" won't start

- Check `claude --version` works in terminal
- Check VS Code Output → "Coven" for errors
- Ensure workspace is a git repo with at least one commit

### "Step failed: invalid JSON output"

The agent didn't return valid JSON. Update your spell to include:
```
Return: {"success": true, "summary": "What you did"}
```

### Task stuck in "Active"

- Click the task to check output
- Look for questions in the Questions section
- The agent may be waiting for your input

### Merge conflicts

1. Click "Open Worktree" in review panel
2. Resolve conflicts in the new VS Code window
3. Commit the resolution
4. Return and click "Retry Merge"

See [Troubleshooting](troubleshooting.md) for more solutions.

---

## Next Steps

- [Workflows](workflows.md) — Deep dive into sessions, tasks, review
- [Grimoires](../orchestration/grimoires.md) — Full grimoire reference
- [Steps](../orchestration/steps.md) — All step types explained
- [Spells](../orchestration/spells.md) — Template variables and functions
- [Examples](../orchestration/examples.md) — Complete grimoire patterns
