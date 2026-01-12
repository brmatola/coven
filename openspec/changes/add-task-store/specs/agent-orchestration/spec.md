# Agent Orchestration Spec Delta

## MODIFIED Requirements

### Requirement: Grimoire Selection
The system SHALL select grimoires using a configurable matcher pipeline with rich matching criteria.

#### Scenario: Selection precedence order
- **WHEN** scheduler needs to select a grimoire for a task
- **THEN** selection follows this precedence (highest to lowest):
  1. `grimoire_hint` field on the task (if set, skip all matchers)
  2. `grimoire:X` tag on the task (legacy, takes priority over matcher pipeline)
  3. Matcher pipeline evaluation (first match wins)
  4. Built-in default grimoire (implement-bead)

#### Scenario: Matcher pipeline evaluation
- **GIVEN** a list of matchers in `.coven/grimoire-matchers.yaml`
- **WHEN** scheduler needs to select a grimoire for a task
- **AND** no grimoire_hint or grimoire:X tag is present
- **THEN** matchers are evaluated in order
- **AND** the first fully matching grimoire is used

#### Scenario: Tag matching with any_tags (OR)
- **GIVEN** a matcher with `any_tags: ["security", "auth*"]`
- **WHEN** a task has tag "authentication"
- **THEN** the matcher matches (glob pattern via doublestar, OR semantics)

#### Scenario: Glob pattern syntax for tags
- **GIVEN** tag patterns use doublestar syntax (github.com/bmatcuk/doublestar)
- **WHEN** pattern `auth*` is evaluated
- **THEN** it matches "auth", "authentication", "auth-service"
- **WHEN** pattern `area/**` is evaluated
- **THEN** it matches "area/frontend", "area/backend/api"
- **WHEN** pattern `{bug,fix}*` is evaluated
- **THEN** it matches "bug", "bugfix", "fix", "fix-auth"

#### Scenario: Tag matching with all_tags (AND)
- **GIVEN** a matcher with `all_tags: ["frontend", "performance"]`
- **WHEN** a task has both tags "frontend" AND "performance"
- **THEN** the matcher matches
- **WHEN** a task has only "frontend" but not "performance"
- **THEN** the matcher does NOT match

#### Scenario: Tag exclusion with not_tags
- **GIVEN** a matcher with `priority: [0, 1]` and `not_tags: ["wip", "draft"]`
- **WHEN** a task has priority 0 and tag "wip"
- **THEN** the matcher does NOT match (exclusion takes priority)
- **WHEN** a task has priority 0 and no excluded tags
- **THEN** the matcher matches

#### Scenario: Priority matching
- **GIVEN** a matcher with `priority: [0, 1]`
- **WHEN** a task has priority 0 (P0/critical)
- **THEN** the matcher matches

#### Scenario: Priority range matching
- **GIVEN** a matcher with `priority_range: [1, 3]`
- **WHEN** a task has priority 2
- **THEN** the matcher matches
- **WHEN** a task has priority 0 or 4
- **THEN** the matcher does NOT match

#### Scenario: Body content matching
- **GIVEN** a matcher with `body_contains: ["CVE-", "security"]`
- **WHEN** a task body contains "CVE-2024-1234"
- **THEN** the matcher matches (case-insensitive substring)

#### Scenario: Type matching
- **GIVEN** a matcher with `type: ["bug", "security"]`
- **WHEN** a task has type "bug"
- **THEN** the matcher matches

#### Scenario: Parent inheritance - successful
- **GIVEN** a matcher with `inherit: true` and `match: { has_parent: true }`
- **WHEN** a subtask is evaluated
- **AND** the parent task was previously assigned grimoire "security-audit"
- **THEN** the subtask uses "security-audit" grimoire

#### Scenario: Parent inheritance - parent has no assignment
- **GIVEN** a matcher with `inherit: true` and `match: { has_parent: true }`
- **WHEN** a subtask is evaluated
- **AND** the parent task has never been assigned a grimoire (never ran)
- **THEN** this matcher does NOT match
- **AND** evaluation continues to next matcher in the pipeline

#### Scenario: Parent inheritance - no parent
- **GIVEN** a matcher with `inherit: true` and `match: { has_parent: true }`
- **WHEN** a root task (no parent) is evaluated
- **THEN** the `has_parent: true` condition fails
- **AND** this matcher does NOT match

#### Scenario: Explicit grimoire hint
- **GIVEN** a task with grimoire_hint = "custom-workflow"
- **WHEN** scheduler selects grimoire
- **THEN** the grimoire_hint takes highest priority
- **AND** matcher pipeline is skipped

#### Scenario: Empty match block
- **GIVEN** a matcher with `match: {}` (no conditions)
- **WHEN** any task is evaluated against this matcher
- **THEN** the matcher ALWAYS matches
- **NOTE** Use as catch-all at end of matcher list

#### Scenario: Default fallback
- **GIVEN** no matchers match a task
- **AND** no catch-all matcher with `match: {}` exists
- **THEN** the built-in default grimoire (implement-bead) is used

#### Scenario: Label-based selection (legacy)
- **GIVEN** a task with tag `grimoire:custom-flow`
- **WHEN** scheduler processes the task
- **THEN** the `custom-flow` grimoire SHALL be used
- **AND** this takes priority over matcher pipeline (but not grimoire_hint)

#### Scenario: Multiple conditions AND'd
- **GIVEN** a matcher with:
  ```yaml
  match:
    any_tags: ["backend"]
    priority: [0, 1]
    type: ["bug"]
  ```
- **WHEN** a task has tag "backend", priority 0, but type "feature"
- **THEN** the matcher does NOT match (all conditions must be true)

## ADDED Requirements

### Requirement: Grimoire Matcher Configuration
The system SHALL support configurable grimoire matching rules via YAML.

#### Scenario: Matcher config loading
- **WHEN** daemon starts
- **THEN** `.coven/grimoire-matchers.yaml` is loaded if present
- **AND** matchers are validated for correctness

#### Scenario: Invalid grimoire reference rejected
- **WHEN** a matcher references a non-existent grimoire
- **THEN** an error is logged at startup
- **AND** the invalid matcher is skipped

#### Scenario: Invalid matcher field rejected
- **WHEN** a matcher contains an unrecognized field
- **THEN** a warning is logged
- **AND** the unrecognized field is ignored

#### Scenario: Invalid glob pattern rejected
- **WHEN** a matcher contains an invalid glob pattern (e.g., unclosed bracket)
- **THEN** an error is logged at startup
- **AND** the invalid matcher is skipped

#### Scenario: Unreachable matcher warning
- **WHEN** a matcher with `match: {}` (catch-all) appears before other matchers
- **THEN** a warning is logged: "matcher 'X' will never be reached because 'Y' matches everything"
- **AND** matchers are still loaded (warning only, not error)

#### Scenario: Hot reload
- **WHEN** `.coven/grimoire-matchers.yaml` is modified
- **THEN** matchers are reloaded on next task evaluation
- **AND** no daemon restart is required

#### Scenario: Default matchers when no config
- **WHEN** no `.coven/grimoire-matchers.yaml` exists
- **THEN** built-in default matchers are used:
  1. `grimoire:X` tag → X grimoire
  2. type mapping (feature/bug/task → implement-bead)
  3. catch-all → implement-bead

### Requirement: Matcher Debugging
The system SHALL provide visibility into grimoire matching decisions.

#### Scenario: Match reasoning in logs
- **WHEN** a grimoire is selected for a task
- **THEN** debug log includes: task ID, matched rule name, grimoire name

#### Scenario: Dry-run matcher evaluation
- **WHEN** `GET /tasks/:id/grimoire-match` is called
- **THEN** response includes:
  - `selected_grimoire`: The grimoire that would be used
  - `matched_by`: Name of the matcher that matched (or "grimoire_hint", "grimoire:tag", "default")
  - `evaluation`: Array of all matchers with match status and reason
  - `task_properties`: The task fields used in matching

Example response:
```json
{
  "selected_grimoire": "security-audit",
  "matched_by": "security-review",
  "evaluation": [
    {
      "name": "security-review",
      "matched": true,
      "reason": "any_tags matched 'auth*' via tag 'authentication'"
    },
    {
      "name": "fast-track",
      "matched": false,
      "reason": "priority [2] not in [0, 1]"
    }
  ],
  "task_properties": {
    "tags": ["authentication", "backend"],
    "priority": 2,
    "type": "task",
    "has_parent": false
  }
}
```

#### Scenario: Match explanation in task details
- **WHEN** `GET /tasks/:id` is called on an in_progress task
- **THEN** response includes `matched_by` field with matcher name

### Requirement: Matcher Validation
The system SHALL validate matcher configuration for correctness.

#### Scenario: Validate matcher has grimoire or inherit
- **WHEN** a matcher has neither `grimoire` nor `inherit: true`
- **THEN** validation fails with "matcher must specify grimoire or inherit"

#### Scenario: Validate inherit requires has_parent
- **WHEN** a matcher has `inherit: true` but no `has_parent: true` condition
- **THEN** a warning is logged: "inherit matcher should include has_parent condition"

#### Scenario: Validate priority values
- **WHEN** a matcher has priority values outside 0-4
- **THEN** validation fails with "priority must be 0-4"

#### Scenario: Validate priority_range
- **WHEN** a matcher has `priority_range: [3, 1]` (min > max)
- **THEN** validation fails with "priority_range min must be <= max"
