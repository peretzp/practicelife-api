#!/bin/bash
set -euo pipefail
# Bootstrap dependencies so tests/linters work in Claude Code on the web sessions.
cd "$CLAUDE_PROJECT_DIR"
npm install
