# Coven Development Workflow

## Quick Reference

```bash
# After making daemon/extension changes
npm run dogfood

# Then in VS Code:
# Cmd+Shift+P -> "Developer: Reload Window"
```

## Understanding the Architecture

### Components
1. **Daemon (`packages/daemon/`)** - Go binary that orchestrates agents and workflows
2. **VS Code Extension (`packages/vscode/`)** - TypeScript extension that provides the UI

### Binary Location (Development)
For local development, the daemon binary is used directly from `build/covend`.

This is configured in `.vscode/settings.json`:
```json
{
  "coven.binaryPath": "/Users/bmatola/repos/coven/build/covend"
}
```

**Important**: Use an absolute path. VS Code's config API does not expand `${workspaceFolder}`.

## Development Workflows

### Making Daemon Changes

1. Edit Go files in `packages/daemon/`
2. Build and restart:
   ```bash
   make build && npm run dogfood
   ```
3. Reload VS Code: `Cmd+Shift+P` -> "Developer: Reload Window"

The `dogfood` script:
- Stops any running daemon
- Builds the extension
- Packages and installs the VSIX
- VS Code auto-starts the daemon on reload using `build/covend`

### Making Extension Changes

1. Edit TypeScript files in `packages/vscode/`
2. Rebuild and reinstall:
   ```bash
   npm run dogfood
   ```
3. Reload VS Code: `Cmd+Shift+P` -> "Developer: Reload Window"

### Making Both Daemon and Extension Changes

```bash
make build && npm run dogfood
# Then reload VS Code
```

## Debugging

### Check Which Daemon is Running
```bash
# Find the daemon process
lsof /Users/bmatola/repos/coven/.coven/covend.sock 2>/dev/null | grep covend

# Check which binary
ps -p <PID> -o command=
```

### Check Daemon Health
```bash
curl -s --unix-socket .coven/covend.sock http://localhost/health | jq .
```

### View Daemon Logs
```bash
tail -f .coven/covend.log
```

### Test API Endpoints
```bash
# List workflows
curl -s --unix-socket .coven/covend.sock http://localhost/workflows | jq .

# Get workflow details
curl -s --unix-socket .coven/covend.sock http://localhost/workflows/<task-id> | jq .

# List agents
curl -s --unix-socket .coven/covend.sock http://localhost/agents | jq .
```

### Force Restart Daemon
```bash
# Stop daemon
curl -s --unix-socket .coven/covend.sock -X POST http://localhost/shutdown

# Clean up
rm -f .coven/covend.sock

# Start fresh (VS Code will auto-start on reload, or manually):
./build/covend --workspace $(pwd) &
```

## Common Issues

### Daemon Running from Wrong Binary
**Symptom**: Changes not taking effect after rebuild

**Diagnosis**:
```bash
lsof .coven/covend.sock | grep covend
ps -p <PID> -o command=
# Should show: /Users/.../coven/build/covend
```

**Fix**:
1. Stop daemon: `curl -s --unix-socket .coven/covend.sock -X POST http://localhost/shutdown`
2. Delete old binary: `rm -f ~/.coven/bin/covend`
3. Run `npm run dogfood` and reload VS Code

### Zombie Daemon Processes
**Symptom**: `ps aux | grep covend` shows processes in `UE` state

**Fix**: These can only be cleared with a system reboot. They don't interfere with new daemons.

### Steps Not Showing in UI
**Symptom**: Workflow detail shows "No steps to display"

**Check**:
1. Verify API returns steps:
   ```bash
   curl -s --unix-socket .coven/covend.sock http://localhost/workflows/<task-id> | jq .steps
   ```
2. If API has steps but UI doesn't, rebuild extension: `npm run dogfood`

### Make Not Rebuilding
**Symptom**: `make build` says "Nothing to be done"

**Fix**: Touch a source file to update timestamp:
```bash
touch packages/daemon/cmd/covend/main.go && make build
```

## File Locations

| What | Path |
|------|------|
| Daemon binary (dev) | `build/covend` |
| Daemon logs | `.coven/covend.log` |
| Daemon socket | `.coven/covend.sock` |
| Workflow state | `.coven/workflows/*.json` |
| Grimoires | `.coven/grimoires/*.yaml` |
| VS Code settings | `.vscode/settings.json` |
