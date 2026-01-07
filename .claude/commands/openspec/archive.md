---
name: OpenSpec: Archive
description: Archive a deployed OpenSpec change and update specs.
category: OpenSpec
tags: [openspec, archive]
---
<!-- OPENSPEC:START -->
**Guardrails**
- Favor straightforward, minimal implementations first and add complexity only when it is requested or clearly required.
- Keep changes tightly scoped to the requested outcome.
- Refer to `openspec/AGENTS.md` (located inside the `openspec/` directory—run `ls openspec` or `openspec update` if you don't see it) if you need additional OpenSpec conventions or clarifications.

**Steps**
1. Determine the change ID to archive:
   - If this prompt already includes a specific change ID (for example inside a `<ChangeId>` block populated by slash-command arguments), use that value after trimming whitespace.
   - If the conversation references a change loosely (for example by title or summary), run `openspec list` to surface likely IDs, share the relevant candidates, and confirm which one the user intends.
   - Otherwise, review the conversation, run `openspec list`, and ask the user which change to archive; wait for a confirmed change ID before proceeding.
   - If you still cannot identify a single change ID, stop and tell the user you cannot archive anything yet.
2. Validate the change ID by running `openspec list` (or `openspec show <id>`) and stop if the change is missing, already archived, or otherwise not ready to archive.
3. Check for associated beads epic:
   ```bash
   bd list --label "openspec:<change-id>" --type epic
   ```
   If an epic exists, verify all child beads are closed:
   ```bash
   bd epic status <epic-id>
   ```
   If any beads remain open, list them and ask before proceeding—archiving with incomplete work may indicate missing tasks.
4. Run `openspec archive <id> --yes` so the CLI moves the change and applies spec updates without prompts (use `--skip-specs` only for tooling-only work).
5. Close the epic bead (if one exists):
   ```bash
   bd close <epic-id>
   ```
6. Review the command output to confirm the target specs were updated and the change landed in `changes/archive/`.
7. Validate with `openspec validate --strict` and inspect with `openspec show <id>` if anything looks off.

**Reference**
- Use `openspec list` to confirm change IDs before archiving.
- Use `bd list --label openspec:<change-id>` to find all beads associated with this change.
- Inspect refreshed specs with `openspec list --specs` and address any validation issues before handing off.
<!-- OPENSPEC:END -->
