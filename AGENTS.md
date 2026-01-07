<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

## Issue Tracking

This project uses **bd (beads)** for issue tracking. Run `bd prime` for full workflow context.

**Quick reference:**
- `bd ready` - Find unblocked work
- `bd create "Title" --type task --priority 2` - Create issue
- `bd show <id>` - View issue details
- `bd close <id>` - Complete work
- `bd sync` - Sync with git

**When to use beads vs TodoWrite:**
- **Beads**: Multi-session work, dependencies, discovered issues, architectural debt
- **TodoWrite**: Simple single-session execution tracking

## OpenSpec + Beads Workflow

OpenSpec and Beads serve complementary roles:
- **OpenSpec** = Planning ("what" and "why") — proposals, specs, approval gates
- **Beads** = Execution ("doing") — task tracking, dependencies, progress

### The Gate: No Beads Before Approval

**Critical Rule:** Do NOT create beads for an OpenSpec change until the proposal is approved.

```
┌─────────────────────────────────────────────────────┐
│  PLANNING (OpenSpec only)                           │
│  - /openspec:proposal creates proposal.md, tasks.md │
│  - openspec validate --strict                       │
│  - Human reviews and approves                       │
│                      ↓                              │
│               [APPROVAL GATE]                       │
│                      ↓                              │
├─────────────────────────────────────────────────────┤
│  EXECUTION (Beads takes over)                       │
│  - /openspec:apply creates epic + child beads       │
│  - Work tracked via bd commands                     │
│  - New discoveries → new beads                      │
│                      ↓                              │
│              [ALL BEADS CLOSED]                     │
│                      ↓                              │
├─────────────────────────────────────────────────────┤
│  ARCHIVE                                            │
│  - /openspec:archive moves change + closes epic     │
└─────────────────────────────────────────────────────┘
```

### Linking Beads to OpenSpec Changes

Every bead for an OpenSpec change uses:
- **Label:** `openspec:<change-id>` (e.g., `openspec:add-core-session`)
- **Epic parent:** All task beads are children of the change's epic bead

**Find all beads for a change:**
```bash
bd list --label openspec:add-core-session
bd epic status <epic-id>
```

### Skill Reference

| Skill | When | Beads Action |
|-------|------|--------------|
| `/openspec:proposal` | Planning new change | None (no beads yet) |
| `/openspec:apply` | After approval | Create epic + task beads |
| `/openspec:archive` | After deployment | Close epic bead |

## Quality Gates

All code changes MUST pass these gates before completion:

```bash
npm run lint          # ESLint - no errors
npm test              # Unit tests with 80% coverage threshold
npm run build         # TypeScript compilation
npm run test:e2e      # E2E tests in VS Code
```

**Test Coverage Requirements:**
- Minimum 80% coverage for lines, functions, branches, and statements
- `npm test` will FAIL if coverage drops below threshold
- New code MUST include tests to maintain coverage
- Use `npm run test:no-coverage` only for quick iteration during development

**Writing Tests:**
- Place tests next to source: `foo.ts` → `foo.test.ts`
- Mock VS Code APIs using `src/__mocks__/vscode.ts`
- Test behavior, not implementation details

**Test Quality Standards (MANDATORY):**
- Tests MUST verify actual functionality, not just that functions exist
- BAD: `expect(typeof fn).toBe('function')` - useless, proves nothing
- GOOD: `expect(fn(input)).toBe(expectedOutput)` - verifies behavior
- Each test should answer: "What breaks if this code is wrong?"
- Test edge cases: empty inputs, error conditions, boundary values
- Test the contract: given X input, expect Y output or Z side effect
- If a test would still pass with the implementation deleted, it's worthless

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
