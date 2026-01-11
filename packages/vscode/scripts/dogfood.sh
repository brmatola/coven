#!/bin/bash
#
# Dogfood script - rebuild and reinstall extension + daemon for local development
#
# Usage: npm run dogfood (from packages/vscode or repo root)
#
set -e

# Get repo root (script is in packages/vscode/scripts/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VSCODE_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$VSCODE_DIR/../.." && pwd)"

SOCKET="$REPO_ROOT/.coven/covend.sock"
VSIX="$VSCODE_DIR/coven-0.0.1.vsix"

echo "==> Building daemon..."
cd "$REPO_ROOT" && make build

echo "==> Stopping daemon (if running)..."
if [ -S "$SOCKET" ]; then
  curl -s --unix-socket "$SOCKET" -X POST http://localhost/shutdown 2>/dev/null || true
  # Wait for daemon to stop
  for i in {1..10}; do
    if [ ! -S "$SOCKET" ]; then
      break
    fi
    sleep 0.2
  done
fi

echo "==> Building extension..."
cd "$VSCODE_DIR"
npm run build

# Note: For dogfooding, the daemon binary is used directly from build/covend
# via the coven.binaryPath setting in .vscode/settings.json.
# No copying needed - single source of truth.

echo "==> Packaging VSIX..."
npm run package

echo "==> Installing extension..."
code --install-extension "$VSIX" --force

echo ""
echo "Done! Run 'Developer: Reload Window' in VS Code (Cmd+Shift+P)"
