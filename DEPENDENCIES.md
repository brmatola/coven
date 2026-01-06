  1. add-extension-scaffold       ← Foundation + test infrastructure
          ↓
  2. add-core-session             ← Core domain logic (.coven/ storage, logging, priority)
          ↓
     ┌────┼────────────────┐
     ↓    ↓                ↓
  3. add-git-worktree    4. add-sidebar-views    5. add-beads-integration
                               ↓                       ↓ (priority sync)
  6. add-claude-agent    7. add-task-detail-view ←····· (task edits sync to Beads)
     (MCP, profiles)           ↓
          ↓                    ↓
  8. add-agent-interaction ←───┘
          ↓
  9. add-review-workflow
          ↓
  10. add-conjure-pr

Legend:
  ↓ or ← = hard dependency (must be completed first)
  ←····· = soft integration (works without, better with)

Notes:
- add-task-detail-view has soft integration with add-beads-integration:
  task edits should sync back to Beads when available
- add-claude-agent includes MCP configuration and agent profiles
- add-core-session includes .coven/ storage, event logging, and priority support
