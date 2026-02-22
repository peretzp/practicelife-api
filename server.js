// PracticeLife API — Local-first personal API
// Unifies MemoryAtlas, Obsidian vault, system state, and agent coordination
//
// Port 3001 (life-dashboard is on 3000)

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
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
require('./routes/ecosystem').register(router);

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
        ecosystem: {
          'GET /api/ecosystem': 'Complete PracticeLife OS map — services, agents, schedulers, infrastructure (?format=json|text)',
        },
      },
    },
  };
});

// Health check
router.get('/health', (req, params) => {
  return { status: 200, body: { ok: true, uptime: process.uptime() } };
});

function renderLandingPage() {
  const uptime = process.uptime();
  const hrs = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);
  const uptimeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>PracticeLife API</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0a0a0a;color:#e0e0e0;font-family:'SF Mono','Fira Code','Cascadia Code',monospace;padding:0}
  a{color:#00ff88;text-decoration:none}
  a:hover{text-decoration:underline}

  .topbar{background:#111;border-bottom:1px solid #222;padding:16px 32px;display:flex;align-items:center;justify-content:space-between}
  .topbar h1{color:#00ff88;font-size:20px}
  .topbar .meta{color:#555;font-size:12px;display:flex;gap:16px;align-items:center}
  .topbar .meta .dot{width:8px;height:8px;border-radius:50%;background:#00ff88;display:inline-block;box-shadow:0 0 6px #00ff88}
  .services-bar{display:flex;gap:8px;padding:12px 32px;background:#0d0d0d;border-bottom:1px solid #1a1a1a}
  .svc-chip{background:#151515;border:1px solid #222;border-radius:6px;padding:6px 14px;font-size:11px;color:#888;display:flex;align-items:center;gap:6px}
  .svc-chip .sdot{width:6px;height:6px;border-radius:50%;display:inline-block}
  .svc-chip .sdot.on{background:#00ff88;box-shadow:0 0 4px #00ff88}
  .svc-chip .sdot.off{background:#555}
  .svc-chip a{color:#ccc}

  .page{max-width:1100px;margin:0 auto;padding:24px 32px}
  .stat-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px}
  .stat{background:#111;border:1px solid #1e1e1e;border-radius:8px;padding:14px 16px}
  .stat h3{color:#555;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
  .stat .val{color:#00ff88;font-size:24px;font-weight:bold}
  .stat .sub{color:#444;font-size:10px;margin-top:2px}

  .section{margin-bottom:28px}
  .section-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;border-bottom:1px solid #1a1a1a;padding-bottom:8px}
  .section-header h2{color:#888;font-size:13px;text-transform:uppercase;letter-spacing:1px}
  .section-header .raw-link{color:#333;font-size:11px}
  .section-header .raw-link:hover{color:#00ff88}

  .panel{background:#111;border:1px solid #1e1e1e;border-radius:8px;padding:16px;margin-bottom:12px}
  .panel-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
  .panel-item{background:#0d0d0d;border:1px solid #1a1a1a;border-radius:6px;padding:10px 14px}
  .panel-item .label{color:#555;font-size:10px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
  .panel-item .value{color:#e0e0e0;font-size:14px;font-weight:bold}
  .panel-item .value.green{color:#00ff88}
  .panel-item .value.blue{color:#00aaff}
  .panel-item .value.orange{color:#ffaa00}

  .endpoint-row{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #0d0d0d;font-size:12px}
  .endpoint-row:last-child{border:none}
  .method-badge{color:#00aaff;font-size:10px;font-weight:bold;background:#00aaff12;padding:2px 8px;border-radius:4px;flex-shrink:0}
  .endpoint-row .path{color:#ccc;flex:1}
  .endpoint-row .path a{color:#00ff88}
  .endpoint-row .desc{color:#444;font-size:11px;flex-shrink:0}

  .data-table{width:100%;font-size:12px;margin-top:8px}
  .data-table th{text-align:left;color:#444;font-size:10px;text-transform:uppercase;padding:4px 8px;border-bottom:1px solid #1a1a1a}
  .data-table td{padding:4px 8px;color:#aaa;border-bottom:1px solid #0d0d0d}

  .loading{color:#333;font-size:11px;padding:12px;text-align:center}
  .tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;margin-right:4px}
  .tag.green{background:#00ff8815;color:#00ff88}
  .tag.blue{background:#00aaff15;color:#00aaff}
  .tag.purple{background:#aa88ff15;color:#aa88ff}
  .tag.orange{background:#ffaa0015;color:#ffaa00}

  .footer{color:#333;font-size:10px;text-align:center;padding:20px;border-top:1px solid #111;margin-top:20px}

  .vol-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
  .vol-chip{background:#1a2a1a;color:#00ff88;padding:4px 10px;border-radius:4px;font-size:11px;border:1px solid #00ff8822}

  .session-item{padding:6px 0;border-bottom:1px solid #0d0d0d;font-size:12px;display:flex;justify-content:space-between}
  .session-item:last-child{border:none}
  .session-item .name{color:#aaa}
  .session-item .date{color:#444}
</style>
</head><body>

<div class="topbar">
  <h1>PracticeLife API</h1>
  <div class="meta">
    <span class="dot"></span> LIVE
    <span>v0.1.0</span>
    <span>uptime ${uptimeStr}</span>
    <span>14 routes</span>
  </div>
</div>

<div class="services-bar">
  <div class="svc-chip"><span class="sdot on"></span><a href="https://localhost:3000">Dashboard</a> :3000</div>
  <div class="svc-chip"><span class="sdot on"></span><a href="https://localhost:3001">API</a> :3001</div>
  <div class="svc-chip" id="svc-prompts"><span class="sdot off"></span><a href="https://localhost:3002">Prompts</a> :3002</div>
</div>

<div class="page">

<!-- Digital Vitals / Wallet -->
<div class="stat-row" id="wallet-row">
  <div class="stat" style="border-color:#00ff8830"><h3>Total Tokens</h3><div class="val" id="w-tokens">...</div><div class="sub" id="w-tokens-sub"></div></div>
  <div class="stat" style="border-color:#ffaa0030"><h3>Cloud Spend</h3><div class="val" id="w-cost" style="color:#ffaa00">...</div><div class="sub" id="w-cost-sub"></div></div>
  <div class="stat" style="border-color:#00aaff30"><h3>Cache Savings</h3><div class="val" id="w-saved" style="color:#00aaff">...</div><div class="sub" id="w-saved-sub"></div></div>
  <div class="stat"><h3>Prompts</h3><div class="val" id="w-prompts">...</div><div class="sub" id="w-prompts-sub"></div></div>
</div>

<!-- System stats row -->
<div class="stat-row" id="stats-row">
  <div class="stat"><h3>Voice Memos</h3><div class="val" id="s-memos">...</div><div class="sub" id="s-memos-sub"></div></div>
  <div class="stat"><h3>Vault Notes</h3><div class="val" id="s-notes">...</div></div>
  <div class="stat"><h3>Disk</h3><div class="val" id="s-disk">...</div></div>
  <div class="stat"><h3>Volumes</h3><div class="val" id="s-vols">...</div></div>
  <div class="stat"><h3>Sessions</h3><div class="val" id="s-sessions">...</div></div>
  <div class="stat"><h3>Uptime</h3><div class="val">${uptimeStr}</div></div>
</div>

<!-- ATLAS -->
<div class="section">
  <div class="section-header">
    <h2>Atlas (MemoryAtlas)</h2>
    <a href="/api/atlas/stats" class="raw-link">raw json →</a>
  </div>
  <div class="panel" id="atlas-panel"><div class="loading">loading atlas data...</div></div>
  <div class="panel">
    <div class="endpoint-row"><span class="method-badge">GET</span><span class="path"><a href="/api/atlas/assets">/api/atlas/assets</a></span><span class="desc">paginated list (?limit=50&offset=0)</span></div>
    <div class="endpoint-row"><span class="method-badge">GET</span><span class="path">/api/atlas/assets/:id</span><span class="desc">single asset by ID</span></div>
    <div class="endpoint-row"><span class="method-badge">GET</span><span class="path"><a href="/api/atlas/stats">/api/atlas/stats</a></span><span class="desc">statistics overview</span></div>
    <div class="endpoint-row"><span class="method-badge">GET</span><span class="path">/api/atlas/search/:query</span><span class="desc">search by title</span></div>
  </div>
</div>

<!-- VAULT -->
<div class="section">
  <div class="section-header">
    <h2>Vault (Obsidian)</h2>
    <a href="/api/vault/structure" class="raw-link">raw json →</a>
  </div>
  <div class="panel" id="vault-panel"><div class="loading">loading vault data...</div></div>
  <div class="panel">
    <div class="endpoint-row"><span class="method-badge">GET</span><span class="path"><a href="/api/vault/stats">/api/vault/stats</a></span><span class="desc">note count and path</span></div>
    <div class="endpoint-row"><span class="method-badge">GET</span><span class="path"><a href="/api/vault/structure">/api/vault/structure</a></span><span class="desc">top-level structure</span></div>
    <div class="endpoint-row"><span class="method-badge">GET</span><span class="path">/api/vault/notes?dir=...</span><span class="desc">list notes in directory</span></div>
    <div class="endpoint-row"><span class="method-badge">GET</span><span class="path">/api/vault/note?path=...</span><span class="desc">read a note</span></div>
  </div>
</div>

<!-- SYSTEM -->
<div class="section">
  <div class="section-header">
    <h2>System</h2>
    <a href="/api/system/state" class="raw-link">raw json →</a>
  </div>
  <div class="panel" id="system-panel"><div class="loading">loading system data...</div></div>
  <div class="panel">
    <div class="endpoint-row"><span class="method-badge">GET</span><span class="path"><a href="/api/system/state">/api/system/state</a></span><span class="desc">CPU, memory, disk</span></div>
    <div class="endpoint-row"><span class="method-badge">GET</span><span class="path"><a href="/api/system/volumes">/api/system/volumes</a></span><span class="desc">mounted volumes</span></div>
    <div class="endpoint-row"><span class="method-badge">GET</span><span class="path"><a href="/api/system/ollama">/api/system/ollama</a></span><span class="desc">Ollama models</span></div>
  </div>
</div>

<!-- AGENTS -->
<div class="section">
  <div class="section-header">
    <h2>Agents</h2>
    <a href="/api/agents/sessions" class="raw-link">raw json →</a>
  </div>
  <div class="panel" id="agents-panel"><div class="loading">loading agent data...</div></div>
  <div class="panel">
    <div class="endpoint-row"><span class="method-badge">GET</span><span class="path"><a href="/api/agents/protocol">/api/agents/protocol</a></span><span class="desc">coordination protocol</span></div>
    <div class="endpoint-row"><span class="method-badge">GET</span><span class="path"><a href="/api/agents/sessions">/api/agents/sessions</a></span><span class="desc">session log list</span></div>
    <div class="endpoint-row"><span class="method-badge">GET</span><span class="path">/api/agents/sessions/:name</span><span class="desc">specific session log</span></div>
    <div class="endpoint-row"><span class="method-badge">GET</span><span class="path"><a href="/api/agents/collab-brief">/api/agents/collab-brief</a></span><span class="desc">collaboration brief</span></div>
  </div>
</div>

</div>

<div class="footer">PracticeLife API · <a href="/health">/health</a> · <a href="/api">/api (JSON index)</a> · Auto-refreshes data every 30s</div>

<script>
const api = (path) => fetch(path).then(r => r.json()).catch(() => null);

async function loadAll() {
  const [atlas, vaultStats, vaultStruct, system, volumes, ollama, sessions, usage] = await Promise.all([
    api('/api/atlas/stats'),
    api('/api/vault/stats'),
    api('/api/vault/structure'),
    api('/api/system/state'),
    api('/api/system/volumes'),
    api('/api/system/ollama'),
    api('/api/agents/sessions'),
    api('/api/system/usage'),
  ]);

  // Wallet row
  if (usage && usage.total_tokens) {
    document.getElementById('w-tokens').textContent = (usage.total_tokens / 1e6).toFixed(1) + 'M';
    document.getElementById('w-tokens-sub').textContent = (usage.input_tokens / 1e3).toFixed(0) + 'K in / ' + (usage.output_tokens / 1e3).toFixed(0) + 'K out';
    document.getElementById('w-cost').textContent = '$' + usage.cost.total.toFixed(0);
    document.getElementById('w-cost-sub').textContent = 'Opus · ' + usage.sessions + ' sessions';
    document.getElementById('w-saved').textContent = '$' + usage.saved_by_cache.toFixed(0);
    document.getElementById('w-saved-sub').textContent = (usage.cache_read_tokens / 1e6).toFixed(0) + 'M cached tokens';
  }

  // Prompts (from prompt browser)
  try {
    const pb = await fetch('https://localhost:3002/api/stats');
    if (pb.ok) {
      const pbd = await pb.json();
      document.getElementById('w-prompts').textContent = pbd.total;
      document.getElementById('w-prompts-sub').textContent = pbd.sessions + ' sessions';
    }
  } catch {}

  // Stats row
  if (atlas) {
    document.getElementById('s-memos').textContent = atlas.total || '0';
    document.getElementById('s-memos-sub').textContent = (atlas.total_hours || '0') + 'h recorded';
  }
  if (vaultStats) document.getElementById('s-notes').textContent = vaultStats.total_notes || '0';
  if (system) {
    document.getElementById('s-disk').textContent = system.disk_usage || '--';
  }
  if (volumes) {
    document.getElementById('s-vols').textContent = (volumes.volumes || []).length;
  }
  if (sessions) document.getElementById('s-sessions').textContent = (sessions.logs || []).length;

  // Check prompt browser
  try {
    const pr = await fetch('https://localhost:3002/api/stats');
    if (pr.ok) {
      document.querySelector('#svc-prompts .sdot').classList.replace('off','on');
    }
  } catch {}

  // Atlas panel
  if (atlas) {
    const ap = document.getElementById('atlas-panel');
    ap.innerHTML = '<div class="panel-grid">' +
      '<div class="panel-item"><div class="label">Total Assets</div><div class="value green">' + (atlas.total || 0) + '</div></div>' +
      '<div class="panel-item"><div class="label">Hours Recorded</div><div class="value blue">' + (atlas.total_hours || 0) + 'h</div></div>' +
      '<div class="panel-item"><div class="label">Transcribed</div><div class="value">' + (atlas.transcribed || 0) + '</div></div>' +
      '<div class="panel-item"><div class="label">Published</div><div class="value">' + (atlas.published || 0) + '</div></div>' +
      '</div>';
  }

  // Vault panel
  if (vaultStats && vaultStruct) {
    const vp = document.getElementById('vault-panel');
    const dirs = (vaultStruct.directories || []).map(d => '<span class="tag green">' + d + '</span>').join('');
    vp.innerHTML = '<div class="panel-grid">' +
      '<div class="panel-item"><div class="label">Total Notes</div><div class="value green">' + (vaultStats.total_notes || 0) + '</div></div>' +
      '<div class="panel-item" style="grid-column:span 2"><div class="label">Structure</div><div style="margin-top:6px">' + dirs + '</div></div>' +
      '</div>';
  }

  // System panel
  if (system && volumes) {
    const sp = document.getElementById('system-panel');
    const vols = (volumes.volumes || []).map(v => '<span class="vol-chip">' + v + '</span>').join('');
    const models = ollama && ollama.models ? ollama.models.map(m => '<span class="tag purple">' + (m.name || m) + '</span>').join('') : '<span class="tag orange">offline</span>';
    sp.innerHTML = '<div class="panel-grid">' +
      '<div class="panel-item"><div class="label">Disk Usage</div><div class="value">' + (system.disk_usage || '--') + '</div></div>' +
      '<div class="panel-item"><div class="label">Memory Pressure</div><div class="value">' + (system.memory_pressure || '--') + '</div></div>' +
      '<div class="panel-item"><div class="label">CPU Load</div><div class="value">' + (system.load_avg || '--') + '</div></div>' +
      '</div>' +
      '<div style="margin-top:12px"><div style="color:#555;font-size:10px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Volumes</div><div class="vol-chips">' + vols + '</div></div>' +
      '<div style="margin-top:12px"><div style="color:#555;font-size:10px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Ollama Models</div><div>' + models + '</div></div>';
  }

  // Agents panel
  if (sessions) {
    const agp = document.getElementById('agents-panel');
    const logs = (sessions.logs || []).slice(0, 6);
    const rows = logs.map(s =>
      '<div class="session-item"><span class="name">' + s.name + '</span><span class="date">' + (s.modified || '').slice(0,10) + '</span></div>'
    ).join('');
    agp.innerHTML = '<div style="color:#555;font-size:10px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Recent Sessions</div>' +
      (rows || '<div style="color:#444;font-size:11px">No sessions found</div>');
  }
}

loadAll();
setInterval(loadAll, 30000);
</script>

</body></html>`;
}

// HTTP server

// SSL certificate options
const sslOptions = {
  key: fs.readFileSync(path.join(process.env.HOME, '.ssl/localhost.key')),
  cert: fs.readFileSync(path.join(process.env.HOME, '.ssl/localhost.crt'))
};

const server = https.createServer(sslOptions, (req, res) => {
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

  // Landing page at /
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(renderLandingPage());
    return;
  }

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
  console.log(`PracticeLife API running at https://${HOST}:${PORT}`);
  console.log(`Endpoints index: https://${HOST}:${PORT}/api`);
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
