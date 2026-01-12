# Goldfish Plugin Structure

## Directory Layout

```
goldfish/
├── .claude-plugin/
│   └── plugin.json              # Plugin metadata
│
├── commands/
│   ├── start.md                 # /goldfish:start
│   ├── next.md                  # /goldfish:next
│   ├── resume.md                # /goldfish:resume
│   ├── status.md                # /goldfish:status
│   └── abort.md                 # /goldfish:abort
│
├── hooks/
│   ├── hooks.json               # Hook configuration
│   └── session-check.sh         # SessionStart handler
│
├── mcp/
│   ├── package.json             # MCP server package
│   ├── src/
│   │   ├── index.ts             # MCP server entry
│   │   ├── tools.ts             # Tool implementations
│   │   ├── state.ts             # SQLite state management
│   │   ├── workflows.ts         # Workflow loader/parser
│   │   └── templates.ts         # Context template engine
│   └── tsconfig.json
│
├── workflows/
│   ├── default.yaml             # Simple single-phase
│   ├── adversarial-review.yaml  # Implement-review-fix-verify
│   ├── tdd-loop.yaml            # Test-driven development
│   └── research-implement.yaml  # Research before coding
│
├── .mcp.json                    # MCP server configuration
├── README.md                    # Plugin documentation
└── package.json                 # NPM package for distribution
```

## Plugin Metadata

### .claude-plugin/plugin.json

```json
{
  "name": "goldfish",
  "version": "1.0.0",
  "description": "Workflow orchestration with intentional context resets",
  "author": "goldfish-ai",
  "repository": "https://github.com/goldfish-ai/goldfish",

  "commands": [
    "commands/start.md",
    "commands/next.md",
    "commands/resume.md",
    "commands/status.md",
    "commands/abort.md"
  ],

  "hooks": "hooks/hooks.json",

  "mcp": ".mcp.json",

  "assets": [
    "workflows/*.yaml"
  ]
}
```

## Commands

### commands/start.md

```markdown
---
name: start
description: Start a new Goldfish workflow
arguments:
  - name: task
    description: Task description
    required: true
  - name: workflow
    description: Workflow to use (default, adversarial-review, tdd-loop, etc.)
    required: false
    default: default
---

# Start Goldfish Workflow

You are starting a new workflow-managed task.

1. Call the `goldfish_create_session` tool with:
   - task: The task description provided by the user
   - workflow: "{{workflow}}" (or "default" if not specified)

2. The tool will return the initial phase context. Display it prominently.

3. Begin working on the task according to the phase instructions.

4. When the phase is complete, the user will run /goldfish:next
```

### commands/next.md

```markdown
---
name: next
description: Complete current phase and advance workflow
---

# Advance Goldfish Workflow

The user wants to complete the current phase and move to the next.

1. Summarize what was accomplished in this phase.

2. Call `goldfish_phase_complete` with:
   - summary: A concise summary of what was done
   - outputs: Any data that should be captured for the next phase
     (Check the phase definition for what to capture)

3. Based on the response:
   - If there are more phases:
     Tell the user: "Phase complete! To continue with fresh context:
     1. Run /clear (or open a new terminal)
     2. Run /goldfish:resume"

   - If the workflow is complete:
     Display a completion summary showing what was accomplished
     across all phases.
```

### commands/resume.md

```markdown
---
name: resume
description: Resume workflow in fresh session
---

# Resume Goldfish Workflow

You are resuming a workflow in a fresh context.

IMPORTANT: You have NO memory of previous phases. This is intentional.
Only use information explicitly provided by the context.

1. Call `goldfish_get_context` to get the current phase information.

2. Display the context block prominently using a clear visual separator.

3. Follow the phase instructions exactly.

4. Do NOT assume anything about previous work beyond what the context tells you.
   - If reviewing code, assume you did NOT write it
   - If fixing issues, focus on the issues listed, not imagined ones
   - If verifying, check against the stated requirements only
```

### commands/status.md

```markdown
---
name: status
description: Show current workflow status
---

# Goldfish Status

Call `goldfish_get_status` and display the result:

- If no active workflow: "No active workflow. Use /goldfish:start to begin."
- If active: Show task, current phase, and progress (e.g., "Phase 2 of 4")
```

### commands/abort.md

```markdown
---
name: abort
description: Cancel current workflow
---

# Abort Goldfish Workflow

Call `goldfish_abort` to cancel the current workflow.

Confirm with the user that the workflow has been cancelled.
They can start a new workflow with /goldfish:start
```

## Hooks

### hooks/hooks.json

```json
{
  "hooks": [
    {
      "event": "SessionStart",
      "type": "command",
      "command": "${CLAUDE_PLUGIN_ROOT}/hooks/session-check.sh"
    }
  ]
}
```

### hooks/session-check.sh

```bash
#!/bin/bash
# Check for active goldfish workflow on session start

# Get status from MCP server (via CLI wrapper)
STATUS=$(goldfish-cli status --json 2>/dev/null)

if [ $? -eq 0 ] && [ "$(echo "$STATUS" | jq -r '.active')" = "true" ]; then
  TASK=$(echo "$STATUS" | jq -r '.task')
  PHASE=$(echo "$STATUS" | jq -r '.phase')
  WORKFLOW=$(echo "$STATUS" | jq -r '.workflow')

  echo ""
  echo "🐠 Active Goldfish workflow detected"
  echo "   Task: $TASK"
  echo "   Workflow: $WORKFLOW"
  echo "   Current phase: $PHASE"
  echo ""
  echo "   Run /goldfish:resume to continue"
  echo "   Run /goldfish:status for details"
  echo "   Run /goldfish:abort to cancel"
  echo ""
fi
```

## MCP Server

### .mcp.json

```json
{
  "mcpServers": {
    "goldfish": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/dist/index.js"]
    }
  }
}
```

### mcp/src/index.ts

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StateManager } from "./state.js";
import { WorkflowLoader } from "./workflows.js";
import { registerTools } from "./tools.js";

const server = new Server(
  { name: "goldfish", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Project-local state and workflows (in current working directory)
const projectRoot = process.cwd();
const stateDir = `${projectRoot}/.goldfish`;
const workflowsDir = `${projectRoot}/.goldfish/workflows`;

const state = new StateManager(stateDir);
const workflows = new WorkflowLoader(workflowsDir);

registerTools(server, state, workflows);

const transport = new StdioServerTransport();
server.connect(transport);
```

### mcp/src/tools.ts

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StateManager } from "./state.js";
import { WorkflowLoader } from "./workflows.js";
import { renderTemplate } from "./templates.js";

export function registerTools(
  server: Server,
  state: StateManager,
  workflows: WorkflowLoader
) {
  server.setRequestHandler("tools/list", async () => ({
    tools: [
      {
        name: "goldfish_create_session",
        description: "Create a new workflow session",
        inputSchema: {
          type: "object",
          properties: {
            task: { type: "string", description: "Task description" },
            workflow: { type: "string", description: "Workflow name", default: "default" }
          },
          required: ["task"]
        }
      },
      {
        name: "goldfish_get_context",
        description: "Get current phase context",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "goldfish_phase_complete",
        description: "Complete current phase and advance",
        inputSchema: {
          type: "object",
          properties: {
            summary: { type: "string", description: "Phase summary" },
            outputs: { type: "object", description: "Captured outputs" }
          },
          required: ["summary"]
        }
      },
      {
        name: "goldfish_get_status",
        description: "Get workflow status",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "goldfish_abort",
        description: "Abort current workflow",
        inputSchema: { type: "object", properties: {} }
      }
    ]
  }));

  server.setRequestHandler("tools/call", async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "goldfish_create_session": {
        const workflow = workflows.load(args.workflow || "default");
        const session = state.createSession(args.task, workflow);
        const phase = workflow.phases[0];
        const context = renderTemplate(phase.context, {
          task: { title: args.task, body: args.task, id: session.id },
          phase: { name: phase.name, index: 0, total: workflow.phases.length },
          phases: {}
        });
        return { content: [{ type: "text", text: JSON.stringify({
          session_id: session.id,
          phase: phase.name,
          context
        })}]};
      }

      case "goldfish_get_context": {
        const session = state.getActiveSession();
        if (!session) {
          return { content: [{ type: "text", text: JSON.stringify({
            error: "No active workflow"
          })}]};
        }
        const workflow = workflows.load(session.workflow);
        const phase = workflow.phases[session.current_phase];
        const outputs = state.getPhaseOutputs(session.id);
        const context = renderTemplate(phase.context, {
          task: { title: session.task, body: session.task, id: session.id },
          phase: { name: phase.name, index: session.current_phase, total: workflow.phases.length },
          phases: outputs
        });
        return { content: [{ type: "text", text: JSON.stringify({
          session_id: session.id,
          task: session.task,
          phase: phase.name,
          phase_index: session.current_phase,
          total_phases: workflow.phases.length,
          context,
          previous_outputs: outputs
        })}]};
      }

      case "goldfish_phase_complete": {
        const session = state.getActiveSession();
        if (!session) {
          return { content: [{ type: "text", text: JSON.stringify({
            error: "No active workflow"
          })}]};
        }
        const workflow = workflows.load(session.workflow);
        const currentPhase = workflow.phases[session.current_phase];

        // Store outputs
        state.storePhaseOutput(session.id, currentPhase.name, session.current_phase, {
          summary: args.summary,
          ...args.outputs
        });

        // Advance to next phase
        const nextIndex = session.current_phase + 1;
        const hasNext = nextIndex < workflow.phases.length;

        if (hasNext) {
          state.advancePhase(session.id, nextIndex);
          const nextPhase = workflow.phases[nextIndex];
          return { content: [{ type: "text", text: JSON.stringify({
            completed_phase: currentPhase.name,
            next_phase: nextPhase.name,
            workflow_complete: false,
            reset_required: nextPhase.reset !== false
          })}]};
        } else {
          state.completeSession(session.id);
          return { content: [{ type: "text", text: JSON.stringify({
            completed_phase: currentPhase.name,
            next_phase: null,
            workflow_complete: true
          })}]};
        }
      }

      case "goldfish_get_status": {
        const session = state.getActiveSession();
        if (!session) {
          return { content: [{ type: "text", text: JSON.stringify({
            active: false
          })}]};
        }
        const workflow = workflows.load(session.workflow);
        return { content: [{ type: "text", text: JSON.stringify({
          active: true,
          session_id: session.id,
          task: session.task,
          workflow: session.workflow,
          phase: workflow.phases[session.current_phase].name,
          phase_index: session.current_phase,
          total_phases: workflow.phases.length,
          started_at: session.created_at
        })}]};
      }

      case "goldfish_abort": {
        const session = state.getActiveSession();
        if (session) {
          state.abortSession(session.id);
        }
        return { content: [{ type: "text", text: JSON.stringify({
          aborted: !!session
        })}]};
      }

      default:
        return { content: [{ type: "text", text: JSON.stringify({
          error: `Unknown tool: ${name}`
        })}]};
    }
  });
}
```

## Distribution

### package.json (root)

```json
{
  "name": "@goldfish/plugin",
  "version": "1.0.0",
  "description": "Goldfish - Workflow orchestration for Claude Code",
  "author": "goldfish-ai",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/goldfish-ai/goldfish"
  },
  "bin": {
    "goldfish": "./bin/goldfish.js",
    "goldfish-cli": "./bin/goldfish-cli.js"
  },
  "scripts": {
    "build": "cd mcp && npm run build",
    "postinstall": "node scripts/setup.js"
  },
  "files": [
    ".claude-plugin/",
    "commands/",
    "hooks/",
    "mcp/dist/",
    "workflows/",
    ".mcp.json",
    "bin/",
    "scripts/"
  ]
}
```

### Installation Methods

#### Via Plugin Marketplace

```bash
# Add goldfish marketplace (one-time)
/plugin marketplace add goldfish-ai/goldfish

# Install plugin
/plugin install goldfish
```

#### Via NPM

```bash
# Global install
npm install -g @goldfish/plugin

# Setup (adds to Claude Code)
goldfish setup
```

#### Manual

```bash
# Clone repo
git clone https://github.com/goldfish-ai/goldfish

# Install to Claude Code
claude /plugin install ./goldfish
```
