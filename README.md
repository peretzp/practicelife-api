# PracticeLife API

Local-first API for MemoryAtlas (`asset` table), Obsidian vault data, machine state, and agent coordination files.

## Runtime
- Node: `>=20`
- Default host/port: `127.0.0.1:3001`

## Boot
```bash
cd /Users/peretz_1/api
npm install
npm run dev
```

Production-style start:
```bash
cd /Users/peretz_1/api
npm start
```

Bind to all interfaces:
```bash
cd /Users/peretz_1/api
HOST=0.0.0.0 PORT=3001 npm run dev
```

## Verification
Health:
```bash
curl -s http://127.0.0.1:3001/health
```

API index:
```bash
curl -s http://127.0.0.1:3001/api
```

Atlas assets (sample):
```bash
curl -s "http://127.0.0.1:3001/api/atlas/assets?limit=5&offset=0&type=voice_memo"
```

Vault stats:
```bash
curl -s http://127.0.0.1:3001/api/vault/stats
```

System state:
```bash
curl -s http://127.0.0.1:3001/api/system/state
```

Agent protocol:
```bash
curl -s http://127.0.0.1:3001/api/agents/protocol
```

## Tests
Run smoke tests with Node built-in test runner:
```bash
cd /Users/peretz_1/api
npm test
```

Test file: `/Users/peretz_1/api/test/smoke.test.js`

## Contract
OpenAPI contract:
- `/Users/peretz_1/api/openapi.json`

## Endpoint Groups
- `/api/atlas/*`: MemoryAtlas data (SQLite table: `asset`)
- `/api/vault/*`: Obsidian vault operations
- `/api/system/*`: host metrics and inventory
- `/api/agents/*`: collaboration protocol and session logs

## Notes
- `npm run dev` uses file watching and can hit file-descriptor limits on some machines.
- If that happens, use `npm start` or increase `ulimit -n`.
- In restricted sandboxes, server bind may fail with `EPERM`; run on local terminal.

---
Timestamp: 2026-02-08T15:18:54-0800
Location: N/A
Signed By: Peretz Partensky
AI: Codex (GPT-5)
Chat/Project: Multi-agent API wiring
Conversation Link: Codex desktop thread (local)
Artifact Path: /Users/peretz_1/api/README.md
---
