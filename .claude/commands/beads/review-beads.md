---
name: Beads: Review Beads
description: Review beads created from a spec for completeness, self-containment, and correct dependencies.
category: Beads
tags: [beads, openspec, review]
---

**Purpose**
Review beads created by `/beads:spec-to-beads` (or manually) to ensure they are complete, self-contained, and correctly structured for autonomous agent work.

**Guardrails**
- This is a review with fresh context—approach as if you've never seen this spec before.
- Be critical: flag issues rather than assuming they're fine.
- Provide specific, actionable fixes using `bd` commands.
- Do not implement fixes without explicit approval.

**Steps**

1. **Load Context Fresh**
   - Read the original OpenSpec: `openspec/changes/<id>/proposal.md`, `specs/*/spec.md`, `tasks.md`
   - Run `bd list --status=open` to get all open beads
   - Identify which beads relate to this spec (by title, epic relationship, or description content)

2. **Coverage Audit**
   For each requirement and scenario in the spec:
   - Identify which bead(s) cover it
   - Flag requirements with no corresponding bead (gap)
   - Flag beads that don't map to any spec requirement (orphan or scope creep)

   Create a coverage matrix:
   ```
   | Requirement | Bead(s) | Status |
   |-------------|---------|--------|
   | Daemon Auto-Start | beads-xxx | Covered |
   | Connection Management | beads-yyy | Covered |
   | <requirement> | NONE | GAP |
   ```

3. **Self-Containment Audit**
   For each bead, verify the description includes:
   - [ ] **Embedded spec context**: Actual requirement/scenario text, not just "see spec"
   - [ ] **Specific file paths**: Which files to create/modify
   - [ ] **Clear scope boundaries**: What is explicitly out of scope
   - [ ] **Acceptance criteria**: Specific, verifiable conditions
   - [ ] **Testing requirements**: Unit tests, and E2E tests when applicable

   Flag beads missing any of these with specific gaps noted.

4. **Dependency Validation**
   Build the dependency graph:
   - Run `bd show <id>` for each bead to get dependencies
   - Check for cycles (error—must be fixed)
   - Check for missing dependencies:
     - Does bead A modify files that bead B creates? A should depend on B.
     - Does bead A use APIs that bead B implements? A should depend on B.
   - Check for over-constraining:
     - Are there dependencies that don't reflect actual code dependencies?

5. **Sizing Review**
   For each bead, assess whether it's appropriately scoped:
   - **Too large**: Multiple unrelated features, touches too many systems, would be hard to review as one PR
   - **Too small**: Trivial change that should be bundled with related work
   - **Just right**: Coherent deliverable that can be implemented, tested, and reviewed as a unit

6. **Generate Report**
   ```markdown
   ## Coverage Report

   ### Fully Covered Requirements
   - [list]

   ### Gaps (requirements with no bead)
   - [requirement]: [suggested fix]

   ### Orphan Beads (beads with no spec requirement)
   - [bead]: [is this valid or should it be removed?]

   ## Self-Containment Issues

   ### Missing Embedded Context
   - beads-xxx: Missing spec text for "Connection Management" requirement

   ### Missing File Paths
   - beads-yyy: Says "update the client" but doesn't specify which files

   ### Missing Acceptance Criteria
   - beads-zzz: No clear definition of done

   ## Dependency Issues

   ### Cycles Found
   - [none | describe cycle]

   ### Missing Dependencies
   - beads-xxx should depend on beads-yyy because [reason]

   ### Over-Constrained
   - beads-xxx depends on beads-yyy but there's no code dependency

   ## Sizing Concerns

   ### Consider Splitting
   - beads-xxx: Covers both [A] and [B] which are independent

   ### Consider Merging
   - beads-xxx and beads-yyy: Both touch the same file for related changes

   ## Recommended Fixes

   1. `bd update beads-xxx --description="..."` - Add missing context
   2. `bd dep add beads-xxx beads-yyy` - Add missing dependency
   3. `bd create --title="..." --type=task` - Create missing bead for [gap]
   4. `bd close beads-xxx --reason="merged into beads-yyy"` - Remove redundant bead
   ```

7. **Interactive Fixes (with approval)**
   After presenting the report, ask:
   > Should I apply these fixes? I can:
   > - Update bead descriptions to add missing context
   > - Add missing dependencies
   > - Create beads for coverage gaps
   > - Close/merge redundant beads

   Only proceed with explicit approval.

**Quality Checklist**
A well-structured set of beads should pass all of these:
- [ ] Every spec requirement maps to at least one bead
- [ ] Every bead maps to at least one spec requirement
- [ ] No bead requires reading external files to understand scope
- [ ] All beads have verifiable acceptance criteria
- [ ] Dependency graph has no cycles
- [ ] Dependencies reflect actual code dependencies
- [ ] No bead is so large it should be split
- [ ] No beads are so small they should be merged

**Reference**
- `bd show <id>` - View bead details and dependencies
- `bd update <id> --title="..." --description="..."` - Update bead
- `bd dep add <child> <parent>` - Add dependency
- `bd dep remove <child> <parent>` - Remove dependency
- `bd close <id> --reason="..."` - Close bead
