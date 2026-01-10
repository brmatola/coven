# Workflow API

REST API for managing workflows and troubleshooting.

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/workflows` | List active/blocked workflows |
| GET | `/workflows/{id}` | Get workflow state |
| POST | `/workflows/{id}/cancel` | Cancel running workflow |
| POST | `/workflows/{id}/approve-merge` | Approve pending merge |
| POST | `/workflows/{id}/reject-merge` | Reject pending merge |
| POST | `/workflows/{id}/retry` | Retry blocked workflow |
| GET | `/workflows/{id}/log` | Get execution log |

## List Workflows

```bash
GET /workflows
```

Response:
```json
{
  "workflows": [
    {
      "id": "beads-abc123",
      "grimoire": "implement-feature",
      "status": "running",
      "currentStep": 1,
      "startedAt": "2024-01-15T10:30:00Z"
    },
    {
      "id": "beads-def456",
      "grimoire": "bugfix-workflow",
      "status": "pending_merge",
      "currentStep": 3,
      "startedAt": "2024-01-15T09:00:00Z"
    }
  ]
}
```

## Get Workflow

```bash
GET /workflows/{id}
```

Response:
```json
{
  "id": "beads-abc123",
  "grimoire": "implement-feature",
  "status": "pending_merge",
  "currentStep": 2,
  "totalSteps": 3,
  "startedAt": "2024-01-15T10:30:00Z",
  "steps": [
    {"name": "implement", "status": "completed", "duration": "45s"},
    {"name": "test-loop", "status": "completed", "duration": "120s"},
    {"name": "merge", "status": "pending", "duration": null}
  ],
  "actions": ["approve-merge", "reject-merge", "cancel"],
  "mergeReview": {
    "additions": 150,
    "deletions": 23,
    "filesChanged": 5
  }
}
```

### Workflow Statuses

| Status | Description |
|--------|-------------|
| `running` | Workflow is executing |
| `pending_merge` | Waiting for merge approval |
| `blocked` | Blocked due to failure or max iterations |
| `completed` | Finished successfully |
| `cancelled` | Cancelled by user |
| `failed` | Failed with error |

## Cancel Workflow

```bash
POST /workflows/{id}/cancel
```

Cancels a running workflow. The worktree is cleaned up and the bead returns to `open` status.

Response:
```json
{
  "status": "cancelled",
  "message": "Workflow cancelled"
}
```

## Approve Merge

```bash
POST /workflows/{id}/approve-merge
```

Approves a pending merge. Checks for conflicts first.

**Success response:**
```json
{
  "status": "merged",
  "message": "Changes merged successfully"
}
```

**Conflict response:**
```json
{
  "status": "conflicts",
  "hasConflicts": true,
  "conflictFiles": ["src/auth.ts", "src/config.ts"],
  "message": "Merge conflicts detected"
}
```

When conflicts exist, the workflow remains blocked. Resolve conflicts manually or cancel the workflow.

## Reject Merge

```bash
POST /workflows/{id}/reject-merge
```

Rejects a pending merge. The workflow becomes blocked.

Response:
```json
{
  "status": "rejected",
  "message": "Merge rejected, workflow blocked"
}
```

## Retry Workflow

```bash
POST /workflows/{id}/retry
```

Retries a blocked workflow from the failed step.

Response:
```json
{
  "status": "running",
  "message": "Workflow resumed"
}
```

## Get Execution Log

```bash
GET /workflows/{id}/log
```

Returns the JSONL execution log.

Response:
```jsonl
{"event":"workflow_start","workflow_id":"beads-abc123","grimoire":"implement-feature","timestamp":"2024-01-15T10:30:00Z"}
{"event":"step_start","step":"implement","type":"agent","timestamp":"2024-01-15T10:30:01Z"}
{"event":"step_end","step":"implement","success":true,"duration":"45s","timestamp":"2024-01-15T10:30:46Z"}
{"event":"step_start","step":"merge","type":"merge","timestamp":"2024-01-15T10:30:47Z"}
{"event":"workflow_blocked","reason":"pending_merge","timestamp":"2024-01-15T10:30:48Z"}
```

---

# Troubleshooting

## Workflow Stuck at Blocked

Check the workflow status:
```bash
curl http://localhost:8080/workflows/{id}
```

Common causes:
- **Loop hit max_iterations** with `on_max_iterations: block`
- **Merge step waiting** for review (`require_review: true`)
- **Step failed** with default `on_fail: block`

Solutions:
- For loops: increase `max_iterations` or change to `on_max_iterations: exit`
- For merges: approve or reject via API
- For failures: fix the issue and retry

## Agent Output Not Parsed

Ensure the agent outputs valid JSON with the required schema:

```json
{"success": true, "summary": "...", "outputs": {...}}
```

Common issues:
- JSON not at the end of output
- Invalid JSON syntax
- Missing required fields

## Spell Template Errors

Check that:
- All referenced variables exist in context
- Template syntax is valid Go templates
- Spell file exists in `.coven/spells/`

Example error:
```
failed to render spell template "implement": variable "nonexistent" not found
```

## Timeout Exceeded

If steps consistently timeout:
- Increase the `timeout` value
- Break into smaller steps
- Check if the agent/script is hanging

## Merge Conflicts

When `approve-merge` returns conflicts:

1. Check conflict files in the response
2. Options:
   - Cancel workflow and resolve manually
   - Fix conflicts in worktree, then retry
   - Rebase worktree on main

## Resume After Daemon Restart

Workflows automatically resume. Check state files:
```bash
ls .coven/state/workflows/
```

If a workflow didn't resume:
- Check daemon logs for errors
- Verify state file exists and is valid JSON
- Check if the worktree still exists

## Debugging Steps

1. **Check workflow status:**
   ```bash
   curl http://localhost:8080/workflows/{id}
   ```

2. **Read execution log:**
   ```bash
   curl http://localhost:8080/workflows/{id}/log
   ```

3. **Check daemon logs:**
   ```bash
   tail -f .coven/logs/daemon.log
   ```

4. **Inspect state file:**
   ```bash
   cat .coven/state/workflows/{id}.json | jq
   ```

5. **Check worktree:**
   ```bash
   ls .coven/worktrees/
   git -C .coven/worktrees/{id} status
   ```
