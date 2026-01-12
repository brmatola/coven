# Goldfish Workflow DSL

## Overview

Workflows are YAML files that define multi-phase processes. Each phase specifies:
- Context to inject
- Data to capture
- Whether to reset context before the phase

## File Locations

```
.goldfish/workflows/         # Project-local workflows
```

Workflows are project-local for MVP. Global workflows may be added in a future version.

## Schema

```yaml
# Required
name: string                 # Unique workflow identifier
phases: Phase[]              # List of phases (minimum 1)

# Optional
description: string          # Human-readable description
version: string              # Semver version (default: "1.0.0")
```

### Phase Schema

```yaml
# Required
name: string                 # Phase identifier (used in templates)
context: string              # Template injected at phase start

# Optional
description: string          # Human-readable description
reset: boolean               # Reset context before phase (default: false)
capture: Capture[]           # Data to capture from this phase
skip_if: string              # Condition to skip this phase
```

### Capture Schema

```yaml
name: string                 # Variable name for captured data
description: string          # Tells Claude what to capture
```

## Template Syntax

Context templates use Handlebars-style `{{variable}}` syntax.

### Available Variables

```
{{task.title}}               # Task title (first line or explicit)
{{task.body}}                # Full task description
{{task.id}}                  # Session ID

{{phase.name}}               # Current phase name
{{phase.index}}              # Current phase index (0-based)
{{phase.total}}              # Total number of phases

{{phases.<name>.<capture>}}  # Output from a previous phase
{{phases.implement.summary}} # Example: summary from implement phase
```

### Examples

```yaml
context: |
  # {{phase.name | titlecase}} Phase ({{phase.index + 1}}/{{phase.total}})

  Task: {{task.title}}

  Previous summary: {{phases.implement.summary}}
```

## Built-in Workflows

### default

Simple single-phase workflow for basic tasks.

```yaml
name: default
description: Simple single-phase task execution

phases:
  - name: execute
    context: |
      # Task

      {{task.title}}

      {{task.body}}

      Complete this task. When done, run /goldfish:next
```

### adversarial-review

Four-phase workflow with adversarial code review.

```yaml
name: adversarial-review
description: Implement, review adversarially, fix, verify

phases:
  - name: implement
    description: Implement the task
    context: |
      # Implementation Phase

      {{task.title}}

      {{task.body}}

      Implement this task. Focus on correctness and clarity.
      When complete, run /goldfish:next
    capture:
      - name: summary
        description: Brief summary of implementation approach and changes
      - name: files_changed
        description: List of files modified

  - name: review
    description: Adversarial code review
    reset: true
    context: |
      # Code Review Phase

      You are reviewing code you did NOT write.
      Your job is to find problems. Be adversarial and thorough.

      ## Task Being Reviewed
      {{task.title}}

      ## Implementation Summary
      {{phases.implement.summary}}

      ## Files Changed
      {{phases.implement.files_changed}}

      Review the implementation:
      1. Read each changed file
      2. Look for bugs, edge cases, security issues
      3. Check for code quality problems
      4. Verify the implementation matches the task

      Do NOT assume the implementation is correct.
      When complete, run /goldfish:next
    capture:
      - name: findings
        description: List of issues found with severity and location
      - name: severity
        description: Overall severity (none, low, medium, high, critical)

  - name: fix
    description: Address review findings
    reset: true
    skip_if: "{{phases.review.severity}} == 'none'"
    context: |
      # Fix Phase

      Address the issues found during code review.

      ## Original Task
      {{task.title}}

      ## Review Findings
      {{phases.review.findings}}

      Fix each issue. Be thorough.
      When complete, run /goldfish:next
    capture:
      - name: summary
        description: Summary of fixes applied

  - name: verify
    description: Verify and complete
    reset: true
    context: |
      # Verification Phase

      Verify the task is complete and working.

      ## Original Task
      {{task.title}}

      ## What Was Done
      Implementation: {{phases.implement.summary}}
      {{#if phases.fix.summary}}
      Fixes: {{phases.fix.summary}}
      {{/if}}

      1. Run any relevant tests
      2. Verify the changes work as expected
      3. Confirm the task requirements are met

      When verified, run /goldfish:next to complete the workflow.
```

### tdd-loop

Test-driven development cycle.

```yaml
name: tdd-loop
description: Test-driven development (red-green-refactor)

phases:
  - name: test
    description: Write failing tests first
    context: |
      # TDD: Write Tests First

      {{task.title}}

      {{task.body}}

      Write tests that define the expected behavior.
      Tests should FAIL initially (red phase).

      Do NOT implement the feature yet.
      When tests are written, run /goldfish:next
    capture:
      - name: test_files
        description: Test files created
      - name: test_cases
        description: Brief description of test cases

  - name: implement
    description: Make tests pass
    reset: true
    context: |
      # TDD: Make Tests Pass

      ## Task
      {{task.title}}

      ## Tests Written
      {{phases.test.test_cases}}

      ## Test Files
      {{phases.test.test_files}}

      Implement the minimum code to make tests pass (green phase).
      Run the tests to verify they pass.

      When tests pass, run /goldfish:next
    capture:
      - name: implementation_summary
        description: What was implemented

  - name: refactor
    description: Improve code quality
    reset: true
    context: |
      # TDD: Refactor

      ## Task
      {{task.title}}

      ## Implementation
      {{phases.implement.implementation_summary}}

      Refactor the code for clarity and quality.
      Keep tests passing throughout.

      When satisfied with code quality, run /goldfish:next
```

### research-implement

Research before implementing.

```yaml
name: research-implement
description: Research the codebase, then implement

phases:
  - name: research
    description: Understand the codebase
    context: |
      # Research Phase

      ## Task
      {{task.title}}

      {{task.body}}

      Before implementing, understand the codebase:
      1. Find similar existing code
      2. Understand the patterns and conventions
      3. Identify integration points
      4. Note any potential challenges

      Do NOT implement yet.
      When research is complete, run /goldfish:next
    capture:
      - name: findings
        description: What you learned about the codebase
      - name: relevant_files
        description: Key files to understand/modify
      - name: approach
        description: Recommended implementation approach

  - name: implement
    description: Implement based on research
    reset: true
    context: |
      # Implementation Phase

      ## Task
      {{task.title}}

      ## Research Findings
      {{phases.research.findings}}

      ## Relevant Files
      {{phases.research.relevant_files}}

      ## Recommended Approach
      {{phases.research.approach}}

      Implement the task following the researched approach.
      Follow existing patterns and conventions.

      When complete, run /goldfish:next
```

## Custom Workflow Examples

### Security Audit

```yaml
name: security-audit
description: Security-focused code review

phases:
  - name: threat-model
    context: |
      # Threat Modeling

      Analyze: {{task.title}}

      {{task.body}}

      Identify:
      1. Trust boundaries
      2. Data flows
      3. Potential attack vectors
      4. Assets at risk

      When complete, run /goldfish:next
    capture:
      - name: threats
        description: Identified threats and attack vectors
      - name: assets
        description: Assets that need protection

  - name: code-review
    reset: true
    context: |
      # Security Code Review

      ## Identified Threats
      {{phases.threat-model.threats}}

      ## Protected Assets
      {{phases.threat-model.assets}}

      Review the code for:
      - OWASP Top 10 vulnerabilities
      - Input validation issues
      - Authentication/authorization flaws
      - Cryptographic weaknesses
      - Information disclosure

      When complete, run /goldfish:next
    capture:
      - name: vulnerabilities
        description: Security vulnerabilities found
      - name: recommendations
        description: Remediation recommendations

  - name: remediate
    reset: true
    context: |
      # Security Remediation

      ## Vulnerabilities
      {{phases.code-review.vulnerabilities}}

      ## Recommendations
      {{phases.code-review.recommendations}}

      Fix each vulnerability. Verify fixes don't introduce new issues.
```

### Documentation

```yaml
name: documentation
description: Research, draft, review, finalize documentation

phases:
  - name: research
    context: |
      # Documentation Research

      Document: {{task.title}}

      {{task.body}}

      Research:
      1. What needs to be documented
      2. Who is the audience
      3. What existing docs exist
      4. What examples/code to reference

      When complete, run /goldfish:next
    capture:
      - name: outline
        description: Documentation outline
      - name: audience
        description: Target audience
      - name: references
        description: Code/examples to reference

  - name: draft
    reset: true
    context: |
      # Write Draft

      ## Outline
      {{phases.research.outline}}

      ## Audience
      {{phases.research.audience}}

      ## References
      {{phases.research.references}}

      Write the first draft. Focus on completeness over polish.

      When draft is complete, run /goldfish:next
    capture:
      - name: draft_location
        description: Where the draft was written

  - name: review
    reset: true
    context: |
      # Documentation Review

      Review the draft at: {{phases.draft.draft_location}}

      Target audience: {{phases.research.audience}}

      Check for:
      - Accuracy
      - Clarity
      - Completeness
      - Examples working correctly
      - Proper formatting

      When review complete, run /goldfish:next
    capture:
      - name: issues
        description: Issues to fix

  - name: finalize
    reset: true
    context: |
      # Finalize Documentation

      ## Issues to Fix
      {{phases.review.issues}}

      Address each issue and finalize the documentation.
```

## Validation Rules

1. **Phase names must be unique** within a workflow
2. **Captured variables** must be referenced only after their phase
3. **At least one phase** required
4. **First phase** cannot reference previous phases
5. **skip_if** conditions must reference valid variables

## Error Handling

### Missing Capture

If a phase completes without providing a required capture:
- Warn user
- Store empty string for the variable
- Continue workflow

### Invalid Template Variable

If a template references undefined variable:
- Log warning
- Render as empty string
- Continue execution

### Workflow Parse Errors

If YAML is invalid:
- Report specific error location
- Refuse to load workflow
- Suggest fixes
