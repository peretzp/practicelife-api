# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**PracticeLife API** — A local-first personal API that unifies data from MemoryAtlas (voice memos), the Obsidian vault, system state, and the life dashboard into a single HTTP interface. Runs on Peretz's Mac Studio Pro.

## Commands

```bash
npm install               # Install dependencies
npm run dev               # Start with file watching
npm start                 # Production start
npm test                  # Run test suite
```

**Server runs at `https://localhost:3001` (HTTPS only with self-signed cert).**
- Health check: `https://localhost:3001/health`
- API index: `https://localhost:3001/api`
- Use `curl -k` for testing (ignores certificate warnings)
- Port 3001 avoids conflict with life-dashboard on 3000

## Architecture

**Stack**: Node.js, zero or minimal external dependencies (mirrors life-dashboard philosophy). SQLite via `better-sqlite3` for MemoryAtlas data access.

**Structure**:
```
api/
├── server.js             # HTTP server, router, middleware
├── routes/               # Route handlers by domain
│   ├── atlas.js          # /api/atlas/* — MemoryAtlas voice memo data
│   ├── vault.js          # /api/vault/* — Obsidian vault queries
│   ├── system.js         # /api/system/* — System state (from life-dashboard logic)
│   └── agents.js         # /api/agents/* — Agent coordination state
├── lib/                  # Shared utilities
│   ├── db.js             # SQLite connection to atlas.db
│   ├── vault.js          # Vault filesystem helpers
│   └── router.js         # Minimal router (no framework)
├── test/                 # Tests
├── package.json
└── CLAUDE.md
```

## Data Sources

| Source | Location | Access Method |
|--------|----------|---------------|
| MemoryAtlas DB | `~/tools/memoryatlas/data/atlas.db` | SQLite (read-only) |
| Obsidian vault | `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/PracticeLife/` | Filesystem |
| Agent protocol | `~/agent-protocol.md` | Filesystem |
| System metrics | Shell commands (`df`, `uptime`, etc.) | `child_process.execSync` |

## Multi-Agent Ownership

See `~/agent-protocol.md` for file ownership rules. This directory (`~/api/`) is collaboratively owned — check the ledger before editing files claimed by another agent.
