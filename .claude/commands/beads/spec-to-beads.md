---
name: Beads: Spec to Beads
description: Convert an OpenSpec change proposal into self-contained beads with dependencies.
category: Beads
tags: [beads, openspec, planning]
---

**Purpose**
Convert an OpenSpec change proposal into a structured set of beads that can be worked on by agents autonomously. Each bead represents a deliverable, testable unit of work.

**Guardrails**
- Each bead must be self-contained: an agent with fresh context should be able to complete it with only the bead description.
- Embed relevant spec content directly in bead descriptions, don't just reference file paths.
- Include acceptance criteria with testing requirements (unit tests always, E2E tests when the work is E2E testable).
- Focus on deliverable units, not arbitrary task groupings.
- Do not specify time estimates.

**Steps**

1. **Load the OpenSpec**
   - Read `openspec/changes/<id>/proposal.md` for overview and architecture
   - Read all `openspec/changes/<id>/specs/*/spec.md` for detailed requirements
   - Read `openspec/changes/<id>/tasks.md` for implementation breakdown
   - Understand the full scope before creating any beads

2. **Identify Epics**
   - Group related work into epics based on major deliverable areas
   - Each epic should represent a cohesive chunk of functionality
   - Create epic beads using: `bd create --title="Epic: <name>" --type=feature --priority=2`
   - The number of epics depends on the spec—use your judgment for appropriate grouping

3. **Create Implementation Beads**
   For each epic, create child beads that are deliverable, testable units. Each bead description MUST include:

   ```markdown
   ## Context
   [Embed the relevant spec sections verbatim—requirements, scenarios, constraints]
   [Include relevant architecture context from proposal.md if needed]

   ## Scope
   [List specific files to create or modify]
   [Reference existing code patterns to follow]
   [Clarify what is OUT of scope for this bead]

   ## Acceptance Criteria
   - [ ] Implementation complete per spec
   - [ ] Unit tests written and passing
   - [ ] E2E tests written and passing (when applicable)
   - [ ] 80% code coverage maintained
   - [ ] No regressions in existing tests
   ```

   Use: `bd create --title="<descriptive title>" --type=task --priority=2`

4. **Bundle Testing Appropriately**
   - Unit tests belong in the same bead as the implementation
   - E2E tests belong in the same bead when they directly validate that bead's functionality
   - Create separate E2E beads only for integration tests that span multiple implementation beads

5. **Establish Dependencies**
   - Infrastructure beads come first (no dependencies)
   - Implementation beads depend on their infrastructure
   - Beads that modify the same files should be sequenced
   - Use: `bd dep add <child-bead> <parent-bead>` (child depends on parent)

6. **Cleanup and Migration Beads**
   - Create beads for removing deprecated code
   - These depend on all beads that replace the deprecated functionality
   - Include verification that nothing references the deleted code

7. **Output Summary**
   After creating all beads, run `bd list --status=open` and provide:
   - List of epics created
   - List of implementation beads per epic
   - Dependency relationships (what blocks what)
   - Any concerns about scope or unclear requirements

**Bead Description Template**
```markdown
## Context

### From Spec: <spec-name>
[Paste relevant requirement and scenario blocks]

### Architecture Notes
[Relevant details from proposal.md]

## Scope

### Files to Create
- `path/to/new/file.ts` - [purpose]

### Files to Modify
- `path/to/existing.ts` - [what changes]

### Out of Scope
- [Explicitly list what this bead does NOT cover]

## Implementation Notes
[Reference existing patterns in the codebase]
[Mention any dependencies or imports needed]

## Acceptance Criteria
- [ ] [Specific, verifiable criterion]
- [ ] Unit tests cover new code paths
- [ ] E2E test validates [specific flow] (if applicable)
- [ ] `npm test` passes
- [ ] `npm run build` succeeds
```

**Reference**
- Run `bd ready` to see beads ready for work (no blockers)
- Run `bd show <id>` to see bead details including dependencies
- Run `bd blocked` to see the dependency graph
- Run `bd stats` for project health overview
