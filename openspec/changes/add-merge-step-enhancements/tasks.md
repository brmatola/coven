## 1. Custom Commit Messages

- [ ] 1.1 Add `commit_message` field to merge step schema
- [ ] 1.2 Implement template rendering for commit message
- [ ] 1.3 Support multi-line messages (first line = title, rest = body)
- [ ] 1.4 Default to auto-generated message if not specified
- [ ] 1.5 Write unit tests for commit message templating

## 2. Rebase Action

- [ ] 2.1 Implement `POST /workflows/:id/rebase` API endpoint
- [ ] 2.2 Add git rebase logic (rebase worktree onto latest target)
- [ ] 2.3 Handle rebase conflicts (return conflict state)
- [ ] 2.4 Add "Rebase" button to review panel UI
- [ ] 2.5 Add `auto_rebase: true` option on merge step
- [ ] 2.6 Write unit tests for rebase logic
- [ ] 2.7 Write E2E test for rebase flow

## 3. Pre-Merge Checks

- [ ] 3.1 Add `pre_merge` field to merge step schema (list of commands)
- [ ] 3.2 Execute pre-merge checks before commit
- [ ] 3.3 Collect check results (pass/fail, output)
- [ ] 3.4 Block merge if any check fails
- [ ] 3.5 Display check results in review panel
- [ ] 3.6 Write unit tests for pre-merge checks
- [ ] 3.7 Write E2E test for pre-merge check failure

## 4. Documentation

- [ ] 4.1 Update steps.md with commit_message documentation
- [ ] 4.2 Document rebase workflow in workflows.md
- [ ] 4.3 Add pre-merge checks to examples
