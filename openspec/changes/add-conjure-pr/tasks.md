# Tasks: Add PR Creation Flow

## 1. Conjure Panel
- [ ] 1.1 Create conjure webview panel
- [ ] 1.2 Display feature branch name and target branch
- [ ] 1.3 Display list of completed tasks with summaries
- [ ] 1.4 Display aggregate stats (files changed, lines added/removed, tests)
- [ ] 1.5 Show readiness checks (all tasks done, tests passing, no pending reviews)

## 2. PR Content Generation
- [ ] 2.1 Generate PR title from feature branch or task summaries
- [ ] 2.2 Generate PR description summarizing all completed tasks
- [ ] 2.3 Include test plan section in description
- [ ] 2.4 Add Coven attribution footer
- [ ] 2.5 Allow editing title and description before creation

## 3. GitHub CLI Integration
- [ ] 3.1 Implement `gh pr create` wrapper
- [ ] 3.2 Pass title, body, base, head parameters
- [ ] 3.3 Handle authentication errors gracefully
- [ ] 3.4 Return PR URL on success

## 4. Promotion Methods
- [ ] 4.1 Implement "Create Pull Request" option (default)
- [ ] 4.2 Implement "Merge directly" option with confirmation
- [ ] 4.3 Ensure branch is pushed before PR creation
- [ ] 4.4 Handle already-existing PR case

## 5. Post-Conjure
- [ ] 5.1 Display success message with PR URL
- [ ] 5.2 Offer to open PR in browser
- [ ] 5.3 Optionally end session after successful conjure
- [ ] 5.4 Clean up session state

## 6. Integration
- [ ] 6.1 Add "Conjure" button to session header
- [ ] 6.2 Disable conjure when tasks are pending
- [ ] 6.3 Register conjure command

## 7. E2E Tests
- [ ] 7.1 Test: Conjure panel shows completed tasks
- [ ] 7.2 Test: PR title/description generated from tasks
- [ ] 7.3 Test: PR creation via gh CLI succeeds
- [ ] 7.4 Test: Conjure disabled when tasks not all done
