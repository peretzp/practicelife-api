// PracticeLife API — Local-first personal API
// Unifies MemoryAtlas, Obsidian vault, system state, and agent coordination
//
// Port 3001 (life-dashboard is on 3000)

const http = require('http');
const { Router } = require('./lib/router');
const { close: closeDb } = require('./lib/db');

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '127.0.0.1';

// Set up router
const router = new Router();

// Register route modules
require('./routes/atlas').register(router);
require('./routes/vault').register(router);
require('./routes/system').register(router);
require('./routes/agents').register(router);

// Root endpoint — API index
router.get('/api', (req, params) => {
  return {
    status: 200,
    body: {
      name: 'PracticeLife API',
      version: '0.1.0',
      endpoints: {
        atlas: {
          'GET /api/atlas/assets': 'List assets (paginated: ?limit=50&offset=0&type=voice_memo)',
          'GET /api/atlas/assets/:id': 'Get single asset by ID',
          'GET /api/atlas/stats': 'MemoryAtlas statistics',
          'GET /api/atlas/search/:query': 'Search assets by title',
        },
        vault: {
          'GET /api/vault/stats': 'Vault note count and path',
          'GET /api/vault/notes': 'List notes in directory (?dir=Efforts/Active)',
          'GET /api/vault/note': 'Read a note (?path=Dashboards/Home.md)',
          'GET /api/vault/structure': 'Top-level vault structure',
        },
        system: {
          'GET /api/system/state': 'System metrics (CPU, memory, disk)',
          'GET /api/system/volumes': 'Mounted volumes',
          'GET /api/system/ollama': 'Ollama model list',
        },
        agents: {
          'GET /api/agents/protocol': 'Current agent coordination protocol',
          'GET /api/agents/sessions': 'List Claude session logs',
          'GET /api/agents/sessions/:name': 'Read specific session log',
          'GET /api/agents/collab-brief': 'Codex-Claude collaboration brief',
        },
      },
    },
  };
});

// Health check
router.get('/health', (req, params) => {
  return { status: 200, body: { ok: true, uptime: process.uptime() } };
});

// HTTP server
const server = http.createServer((req, res) => {
  // CORS for local development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const match = router.match(req.method, req.url);

  if (!match) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found', path: req.url }));
    return;
  }

  try {
    const result = match.handler(req, match.params);
    res.writeHead(result.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.body, null, 2));
  } catch (err) {
    console.error(`[${req.method} ${req.url}]`, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`PracticeLife API running at http://${HOST}:${PORT}`);
  console.log(`Endpoints index: http://${HOST}:${PORT}/api`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  closeDb();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDb();
  server.close();
  process.exit(0);
});
