#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Install all workspace dependencies from root
npm install

# Build the client and server libraries (required by demo apps)
npm run build --workspace=packages/client
npm run build --workspace=packages/server
