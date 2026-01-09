# Change: Add CLI for Coven Daemon (coven)

**STATUS: DEFERRED** - Punted for post-MVP. Focus is on extension + daemon.

## Why

Power users may want CLI access to:
- Start/stop sessions from terminal
- Check status without opening VS Code
- Script automation around coven

## What Changes

- **NEW**: `coven` CLI binary (Go, separate from `covend`)
- **NEW**: CLI commands: init, start, stop, status, tasks, agents, logs, questions, respond

## Deferred Scope

This is captured for future reference but not prioritized for MVP. The extension provides all necessary UI for the target use case.

## Future API

```bash
coven init                    # Create .coven/ in current repo
coven start --branch feature  # Start session
coven stop                    # Stop session
coven status                  # Show state (--json for scripting)
coven tasks                   # List tasks
coven agents                  # List running agents
coven logs                    # Stream agent output
coven questions               # Show pending questions
coven respond <id>            # Answer a question
coven daemon status           # Check daemon health
coven daemon stop             # Stop daemon
coven daemon logs             # View daemon logs
```
