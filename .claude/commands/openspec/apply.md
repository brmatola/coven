---
name: OpenSpec: Apply
description: Implement an approved OpenSpec change and keep tasks in sync.
category: OpenSpec
tags: [openspec, apply]
---
<!-- OPENSPEC:START -->
**Guardrails**
- Favor straightforward, minimal implementations first and add complexity only when it is requested or clearly required.
- Keep changes tightly scoped to the requested outcome.
- Refer to `openspec/AGENTS.md` (located inside the `openspec/` directory—run `ls openspec` or `openspec update` if you don't see it) if you need additional OpenSpec conventions or clarifications.
- Do NOT create beads until the proposal is approved. The apply skill assumes approval has been granted.

**Steps**
Track these steps as TODOs and complete them one by one.

### Phase 1: Setup Execution Tracking
1. Read `changes/<id>/proposal.md`, `design.md` (if present), and `tasks.md` to confirm scope and acceptance criteria.
2. Create an epic bead for the change:
   ```bash
   bd create "<change-id>" --type epic --labels "openspec:<change-id>" \
     --description "OpenSpec change: <brief description from proposal.md>"
   ```
3. Parse `tasks.md` and create child beads for each task item:
   ```bash
   bd create "<task title>" --parent <epic-id> --labels "openspec:<change-id>" \
     --priority 2 --type task
   ```
4. Set up dependencies between beads using `bd dep <blocker-id> --blocks <blocked-id>` based on task ordering and explicit dependencies in tasks.md.
5. Update `tasks.md` to reference the epic:
   ```markdown
   ## Implementation
   Epic: `<epic-id>` (<change-id>)
   Track progress: `bd epic status <epic-id>`
   List tasks: `bd list --parent <epic-id>`
   ```

### Phase 2: Implementation
6. Use `bd ready` or `bd list --parent <epic-id> --status open` to find unblocked work.
7. Before starting a task, mark it in progress: `bd update <bead-id> --status in_progress`
8. Work through tasks, keeping edits minimal and focused on the requested change.
9. When a task is complete, close it: `bd close <bead-id>`
10. If you discover additional work during implementation, create new beads with `--parent <epic-id>` and appropriate dependencies.

### Phase 3: Completion
11. Verify all beads are closed: `bd epic status <epic-id>` should show 100% complete.
12. Run validation: `npm run lint && npm test && npm run build && npm run test:e2e`
13. Reference `openspec list` or `openspec show <item>` when additional context is required.

**Reference**
- Use `openspec show <id> --json --deltas-only` if you need additional context from the proposal while implementing.
- Use `bd list --label openspec:<change-id>` to see all beads for this change.
- Use `bd dep tree <epic-id>` to visualize task dependencies.
<!-- OPENSPEC:END -->
