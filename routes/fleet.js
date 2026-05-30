// /api/fleet/* — Multi-machine fleet status and coordination
// Probes Anvil (M3 Ultra) and reports unified fleet health
const { execSync } = require('child_process');
const http = require('http');
const os = require('os');

const ANVIL_LAN = '192.168.1.105';
const ANVIL_TS = '100.80.178.111'; // Updated from 100.116.17.120
const ANVIL_OLLAMA = 11434;
const ANVIL_DASHBOARD = 3000;
const LITELLM_PORT = 4000;

const BEHEMOTH_TS = '100.120.103.42';
const KOROVIEV_TS = '100.93.56.61';

function run(cmd, timeout = 5000) {
  try {
    return execSync(cmd, { timeout, encoding: 'utf8' }).trim();
  } catch { return null; }
}

// Quick HTTP probe — returns { ok, latencyMs, data? }
function probe(host, port, path, timeout = 3000) {
  return new Promise(resolve => {
    const start = Date.now();
    const req = http.get({ host, port, path, timeout }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        const latencyMs = Date.now() - start;
        try {
          resolve({ ok: true, latencyMs, status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ ok: true, latencyMs, status: res.statusCode, data: body.slice(0, 500) });
        }
      });
    });
    req.on('error', () => resolve({ ok: false, latencyMs: Date.now() - start }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, latencyMs: timeout, timeout: true }); });
  });
}

// Get Anvil system info via SSH (cached, fast)
function getAnvilSystem() {
  const info = run('ssh -o ConnectTimeout=3 -o StrictHostKeyChecking=no anvil "export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH && echo HOSTNAME=$(hostname) && echo UPTIME=$(uptime) && echo MEM=$(vm_stat | head -5) && echo DISK=$(df -h / | tail -1)" 2>/dev/null', 8000);
  if (!info) return null;

  const hostname = (info.match(/HOSTNAME=(.+)/) || [])[1] || 'unknown';
  const uptime = (info.match(/UPTIME=(.+)/) || [])[1] || 'unknown';
  const disk = (info.match(/DISK=(.+)/) || [])[1] || 'unknown';

  return { hostname, uptime: uptime.replace(/.*up/, 'up'), disk };
}

// Get Hearth (local) system info
function getHearthSystem() {
  return {
    hostname: os.hostname(),
    uptime: run('uptime')?.replace(/.*up/, 'up') || 'unknown',
    disk: run("df -h / | tail -1") || 'unknown',
    cpus: os.cpus().length,
    totalMemGB: Math.round(os.totalmem() / 1073741824),
    freeMemGB: Math.round(os.freemem() / 1073741824 * 10) / 10,
    loadAvg: os.loadavg(),
  };
}

function register(router) {
  // GET /api/fleet — Full fleet status
  router.get('/api/fleet', async (req, params) => {
    // Probe all endpoints in parallel
    const [
      anvilDashboard,
      anvilOllama,
      anvilOllamaTs,
      litellm,
      localOllama,
      behemothOllama,
      korovievOllama,
    ] = await Promise.all([
      probe(ANVIL_LAN, ANVIL_DASHBOARD, '/api/status'),
      probe(ANVIL_LAN, ANVIL_OLLAMA, '/api/tags'),
      probe(ANVIL_TS, ANVIL_OLLAMA, '/api/tags'),
      probe('127.0.0.1', LITELLM_PORT, '/health/readiness'),
      probe('127.0.0.1', ANVIL_OLLAMA, '/api/tags'),
      probe(BEHEMOTH_TS, ANVIL_OLLAMA, '/api/tags'),
      probe(KOROVIEV_TS, ANVIL_OLLAMA, '/api/tags'),
    ]);

    // Parse Anvil models
    let anvilModels = [];
    if (anvilDashboard.ok && anvilDashboard.data?.ollama?.available) {
      anvilModels = anvilDashboard.data.ollama.available.map(m => ({
        name: m.name,
        size: m.sizeGB + 'GB',
        family: m.family || 'unknown',
      }));
    } else if (anvilOllama.ok && anvilOllama.data?.models) {
      anvilModels = anvilOllama.data.models.map(m => ({
        name: m.name,
        size: m.size ? `${(m.size / 1073741824).toFixed(1)}GB` : 'unknown',
        family: m.details?.family || 'unknown',
      }));
    }

    // Parse local models
    let localModels = [];
    if (localOllama.ok && localOllama.data?.models) {
      localModels = localOllama.data.models.map(m => ({
        name: m.name,
        size: m.size ? `${(m.size / 1073741824).toFixed(1)}GB` : 'unknown',
        family: m.details?.family || 'unknown',
      }));
    }

    const hearthSystem = getHearthSystem();

    // LiteLLM routes
    let litellmModels = [];
    if (litellm.ok) {
      litellmModels = await new Promise(resolve => {
        const req = http.get({
          host: '127.0.0.1', port: LITELLM_PORT, path: '/v1/models', timeout: 3000,
          headers: { 'Authorization': 'Bearer sk-litellm-local' },
        }, res => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => {
            try { resolve((JSON.parse(body).data || []).map(m => m.id)); }
            catch { resolve([]); }
          });
        });
        req.on('error', () => resolve([]));
        req.on('timeout', () => { req.destroy(); resolve([]); });
      });
    }

    // Tailscale status
    const tailscaleStatus = run('tailscale status --json 2>/dev/null', 5000);
    let tailscaleDevices = [];
    if (tailscaleStatus) {
      try {
        const ts = JSON.parse(tailscaleStatus);
        const peers = ts.Peer || {};
        tailscaleDevices = [
          { name: ts.Self?.HostName || 'self', ip: ts.Self?.TailscaleIPs?.[0], online: true, os: ts.Self?.OS },
          ...Object.values(peers).map(p => ({
            name: p.HostName,
            ip: p.TailscaleIPs?.[0],
            online: p.Online,
            os: p.OS,
          }))
        ];
      } catch {}
    }

    const fleet = {
      timestamp: new Date().toISOString(),
      machines: {
        behemoth: {
          name: 'Behemoth',
          model: 'MacBook Pro M4 Max',
          specs: { ram: '64GB', cpu: '16-core', gpu: '40-core' },
          role: 'Primary dashboard, Concord agent, Boris workstation',
          ip: { tailscale: BEHEMOTH_TS },
          status: behemothOllama.ok ? 'online' : 'unreachable',
          latencyMs: behemothOllama.latencyMs,
        },
        koroviev: {
          name: 'Koroviev',
          model: 'MacBook Pro M4 Pro',
          specs: { ram: '48GB', cpu: '14-core' },
          role: 'Mission Control, Fleet Watch, Voice daemon',
          ip: { tailscale: KOROVIEV_TS },
          status: korovievOllama.ok ? 'online' : 'unreachable',
          latencyMs: korovievOllama.latencyMs,
        },
        hearth: {
          name: 'Hearth',
          model: 'Mac Studio M2 Max',
          specs: { ram: '64GB', cpu: '12-core', storage: '2TB' },
          role: 'Orchestration hub — services, agents, routing',
          ip: { lan: '192.168.1.113' },
          system: hearthSystem,
          models: localModels,
        },
        anvil: {
          name: 'Anvil',
          model: 'Mac Studio M3 Ultra',
          specs: { ram: '96GB', cpu: '28-core', gpu: '60-core', bandwidth: '819 GB/s' },
          role: 'Inference workhorse — local LLM serving',
          ip: { lan: ANVIL_LAN, tailscale: ANVIL_TS },
          ollama: {
            status: anvilOllama.ok ? 'up' : 'down',
            models: anvilModels,
          },
        },
        nas: {
          name: 'Synology NAS (DS223j)',
          role: 'Storage, backups, web hosting',
          ip: { lan: '192.168.1.57', tailscale: '100.93.227.12' },
          specs: { ram: '1GB', storage: '16TB' },
        },
      },
      tailscale: {
        devices: tailscaleDevices,
        meshSize: tailscaleDevices.length,
      },
    };

    return { status: 200, body: fleet };
  });

  // GET /api/fleet/anvil — Quick Anvil-only health check
  router.get('/api/fleet/anvil', async (req, params) => {
    const result = await probe(ANVIL_LAN, ANVIL_OLLAMA, '/api/tags');
    if (!result.ok) {
      return { status: 200, body: { status: 'unreachable', latencyMs: result.latencyMs } };
    }
    const models = result.data?.models?.map(m => ({ name: m.name, size: m.size })) || [];
    return { status: 200, body: { status: 'online', latencyMs: result.latencyMs, models } };
  });

  // GET /api/fleet/search — Semantic search over vault embeddings
  router.get('/api/fleet/search', async (req, params) => {
    const url = new URL(req.url, 'http://localhost');
    const q = url.searchParams.get('q');
    const result = await probe(ANVIL_LAN, 3100, `/search?q=${encodeURIComponent(q)}`);
    return { status: result.ok ? 200 : 502, body: result.data || { error: 'unreachable' } };
  });

  // GET /api/fleet/routes — LiteLLM routing table
  router.get('/api/fleet/routes', async (req, params) => {
    const models = await new Promise(resolve => {
      const req = http.get({
        host: '127.0.0.1', port: LITELLM_PORT, path: '/v1/models', timeout: 3000,
        headers: { 'Authorization': 'Bearer sk-litellm-local' },
      }, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => { try { resolve(JSON.parse(body).data.map(m => m.id)); } catch { resolve([]); } });
      });
      req.on('error', () => resolve([]));
    });
    return { status: 200, body: { status: 'ok', routes: models } };
  });
}

module.exports = { register };
