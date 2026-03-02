// /api/fleet/* — Multi-machine fleet status and coordination
// Probes Anvil (M3 Ultra) and reports unified fleet health
const { execSync } = require('child_process');
const http = require('http');
const os = require('os');

const ANVIL_LAN = '192.168.1.105';
const ANVIL_TS = '100.116.17.120';
const ANVIL_OLLAMA = 11434;
const LITELLM_PORT = 4000;

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
      anvilOllama,
      anvilOllamaTs,
      litellm,
      localOllama,
    ] = await Promise.all([
      probe(ANVIL_LAN, ANVIL_OLLAMA, '/api/tags'),
      probe(ANVIL_TS, ANVIL_OLLAMA, '/api/tags'),
      probe('127.0.0.1', LITELLM_PORT, '/health/readiness'),
      probe('127.0.0.1', ANVIL_OLLAMA, '/api/tags'),
    ]);

    // Parse Anvil models
    let anvilModels = [];
    if (anvilOllama.ok && anvilOllama.data?.models) {
      anvilModels = anvilOllama.data.models.map(m => ({
        name: m.name,
        size: m.size ? `${(m.size / 1073741824).toFixed(1)}GB` : 'unknown',
        family: m.details?.family || 'unknown',
        parameterSize: m.details?.parameter_size || 'unknown',
        quantization: m.details?.quantization_level || 'unknown',
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

    // Get Anvil system info (SSH — slower, do only if Ollama is reachable)
    let anvilSystem = null;
    if (anvilOllama.ok) {
      anvilSystem = getAnvilSystem();
    }

    const hearthSystem = getHearthSystem();

    // LiteLLM routes (needs auth header)
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
            lastSeen: p.LastSeen,
          }))
        ];
      } catch {}
    }

    const fleet = {
      timestamp: new Date().toISOString(),
      machines: {
        hearth: {
          name: 'Hearth',
          model: 'Mac Studio M2 Max',
          specs: { ram: '64GB', cpu: '12-core', gpu: '30-core', storage: '2TB' },
          role: 'Orchestration hub — services, agents, routing',
          ip: { lan: '192.168.1.113' },
          system: hearthSystem,
          services: {
            dashboard: { port: 3000, status: run('/usr/sbin/lsof -ti:3000') ? 'up' : 'down' },
            api: { port: 3001, status: 'up' }, // we're running right now
            promptBrowser: { port: 3002, status: run('/usr/sbin/lsof -ti:3002') ? 'up' : 'down' },
            contactVerify: { port: 3003, status: run('/usr/sbin/lsof -ti:3003') ? 'up' : 'down' },
            litellm: { port: 4000, status: litellm.ok ? 'up' : 'down', latencyMs: litellm.latencyMs },
            ollama: { port: 11434, status: localOllama.ok ? 'up' : 'down' },
          },
          models: localModels,
        },
        anvil: {
          name: 'Anvil',
          model: 'Mac Studio M3 Ultra',
          specs: { ram: '96GB', cpu: '28-core', gpu: '60-core', storage: '4TB', bandwidth: '819 GB/s' },
          role: 'Inference workhorse — local LLM serving',
          ip: { lan: ANVIL_LAN, tailscale: ANVIL_TS },
          system: anvilSystem,
          connectivity: {
            lan: { reachable: anvilOllama.ok, latencyMs: anvilOllama.latencyMs },
            tailscale: { reachable: anvilOllamaTs.ok, latencyMs: anvilOllamaTs.latencyMs },
          },
          ollama: {
            status: anvilOllama.ok ? 'up' : 'down',
            models: anvilModels,
            totalSizeGB: anvilModels.reduce((sum, m) => sum + parseFloat(m.size) || 0, 0).toFixed(1),
          },
        },
        nas: {
          name: 'Synology NAS (DS223j)',
          role: 'Storage, backups, web hosting',
          ip: { lan: '192.168.1.57', tailscale: '100.93.227.12' },
          specs: { ram: '1GB', storage: '16TB', arch: 'ARM64' },
          services: ['Time Machine', 'Caddy (web)', 'cloudflared (tunnel)'],
        },
        mobile: {
          ipad: {
            name: 'iPad Pro 13" M4',
            role: 'Mobile dashboard viewer, Obsidian sync, Shortcuts automation',
            capabilities: [
              'View dashboard at https://hearth.local:3000 (via Tailscale)',
              'Obsidian vault sync (iCloud)',
              'Shortcuts → LiteLLM API for quick AI queries',
              'VNC to Anvil for monitoring',
            ],
          },
          iphone: {
            name: 'iPhone Pro Max 17',
            role: 'Notifications, quick queries, voice capture',
            capabilities: [
              'Apple Voice Memos → MemoryAtlas pipeline',
              'Shortcuts → LiteLLM API queries',
              'Push notifications from services (planned)',
              'Tailscale mesh access to all machines',
            ],
          },
        },
      },
      routing: {
        litellm: {
          status: litellm.ok ? 'up' : 'down',
          port: LITELLM_PORT,
          models: litellmModels,
          description: 'Universal AI gateway — routes to local, Anvil, and cloud models',
        },
        flowDescription: [
          'Claude Code (Hearth) → LiteLLM :4000 → Anvil Ollama :11434 (inference)',
          'Claude Code (Hearth) → Direct HTTP → Anvil Ollama :11434 (low latency)',
          'iPad/iPhone → Tailscale → Hearth :4000 → Anvil (via LiteLLM)',
          'iPad/iPhone → Tailscale → Hearth :3000 (dashboard)',
          'Any device → Tailscale → Anvil VNC (Screen Sharing)',
        ],
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

    const models = result.data?.models?.map(m => ({
      name: m.name,
      size: m.size ? `${(m.size / 1073741824).toFixed(1)}GB` : 'unknown',
    })) || [];

    return {
      status: 200,
      body: {
        status: 'online',
        latencyMs: result.latencyMs,
        models,
        totalModels: models.length,
        timestamp: new Date().toISOString(),
      },
    };
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
        res.on('end', () => {
          try { resolve((JSON.parse(body).data || []).map(m => m.id)); }
          catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
    if (models === null) {
      return { status: 200, body: { status: 'litellm_unreachable', models: [] } };
    }

    // Categorize routes
    const anvil = models.filter(m => m.startsWith('anvil/'));
    const local = models.filter(m => m.startsWith('local/'));
    const cloud = models.filter(m => m.startsWith('claude/') || m.startsWith('gpt/') || m.startsWith('gemini/'));
    const gpu = models.filter(m => m.startsWith('gpu/'));

    return {
      status: 200,
      body: {
        status: 'ok',
        total: models.length,
        routes: { anvil, local, cloud, gpu },
        all: models,
        timestamp: new Date().toISOString(),
      },
    };
  });
}

module.exports = { register };
