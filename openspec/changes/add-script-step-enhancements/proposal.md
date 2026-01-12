# Change: Add Script Step Enhancements

## Why

Script steps currently only support `command` and `timeout`. Common use cases require:
1. **Environment variables** - Deploy scripts need `NODE_ENV`, API keys, etc.
2. **Working directory** - Some commands must run from a specific subdirectory
3. **Secrets management** - Sensitive values shouldn't be hardcoded in grimoires

Without these, users must wrap commands in shell scripts or use workarounds.

## What Changes

### Script Step Fields
- **ADDED** `env` field - Map of environment variables to set for the command
- **ADDED** `workdir` field - Working directory for command execution (relative to worktree root)
- **ADDED** Template rendering in `env` values - Access workflow context like `{{.secrets.api_key}}`

### Secrets Context
- **ADDED** `{{.secrets}}` template variable - Loaded from `.coven/secrets.yaml` (gitignored)
- **ADDED** Environment variable fallback - `{{.secrets.API_KEY}}` falls back to `$API_KEY` env var
- **ADDED** Secret redaction in logs - Values from secrets context are masked in workflow logs

## Impact

- **Affected specs:** agent-orchestration
- **Affected code:**
  - `packages/daemon/internal/workflow/script.go` - Add env and workdir handling
  - `packages/daemon/internal/workflow/context.go` - Add secrets loading
  - `packages/daemon/internal/workflow/logging.go` - Add secret redaction
  - `packages/daemon/internal/grimoire/validate.go` - Validate new fields
- **Breaking changes:** None (additive only)

## Security Considerations

- Secrets file (`.coven/secrets.yaml`) MUST be in `.gitignore` by default
- Secrets are never written to workflow logs (redacted as `***`)
- Environment-sourced secrets inherit process security model
